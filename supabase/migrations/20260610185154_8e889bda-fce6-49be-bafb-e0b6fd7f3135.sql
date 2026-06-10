-- =============================================================
-- Exhibitor catalog + orphan/unpublished admin workflows
-- =============================================================

-- 1) public_exhibitor_catalog: single source of truth for /explore
CREATE OR REPLACE FUNCTION public.public_exhibitor_catalog(_event_id uuid DEFAULT NULL)
RETURNS TABLE (
  profile_id     uuid,
  full_name      text,
  trade_name     text,
  country_code   text,
  city           text,
  segments       text[],
  services       text[],
  destinations   text[],
  table_number   int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING HINT = 'Sign in to view exhibitors.';
  END IF;

  v_event := COALESCE(_event_id, public.pipeline_active_event_id());

  IF v_event IS NULL THEN
    RAISE EXCEPTION 'no_active_event' USING HINT = 'Configure an active event in admin.';
  END IF;

  RETURN QUERY
  SELECT
    p.id          AS profile_id,
    p.full_name,
    c.trade_name,
    c.country_code,
    c.city,
    COALESCE(ep.segments,    '{}'::text[]) AS segments,
    COALESCE(ep.services,    '{}'::text[]) AS services,
    COALESCE(ep.destinations,'{}'::text[]) AS destinations,
    et.table_number
  FROM public.exhibitor_profiles ep
  JOIN public.profiles    p  ON p.id = ep.profile_id
  JOIN public.companies   c  ON c.id = p.company_id
  JOIN public.user_roles  ur ON ur.user_id = p.auth_user_id AND ur.role = 'exhibitor'::app_role
  JOIN public.event_tables et
    ON et.exhibitor_profile_id = p.id
   AND et.event_id = v_event
  WHERE p.is_active = true
    AND p.company_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.public_exhibitor_catalog(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_exhibitor_catalog(uuid) TO authenticated;

COMMENT ON FUNCTION public.public_exhibitor_catalog(uuid) IS
'Catálogo público de expositores publicáveis no evento (ativo por padrão).
Regra central: exhibitor_profile + role exhibitor + profile.is_active + company vinculada + mesa alocada no evento.
Não retorna email/telefone. Levanta no_active_event quando não há evento configurado.';

-- 2) admin_list_orphan_exhibitors: exhibitors with no company linked
CREATE OR REPLACE FUNCTION public.admin_list_orphan_exhibitors()
RETURNS TABLE (
  profile_id            uuid,
  email                 text,
  full_name             text,
  is_active             boolean,
  has_exhibitor_request boolean,
  request_status        text,
  table_number          int,
  created_at            timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.email,
    p.full_name,
    p.is_active,
    (er.id IS NOT NULL) AS has_exhibitor_request,
    er.status::text     AS request_status,
    et.table_number,
    p.created_at
  FROM public.exhibitor_profiles ep
  JOIN public.profiles p ON p.id = ep.profile_id
  LEFT JOIN LATERAL (
    SELECT id, status FROM public.exhibitor_requests
     WHERE profile_id = p.id
     ORDER BY created_at DESC
     LIMIT 1
  ) er ON true
  LEFT JOIN public.event_tables et
         ON et.exhibitor_profile_id = p.id
        AND et.event_id = public.pipeline_active_event_id()
  WHERE p.company_id IS NULL
  ORDER BY p.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_orphan_exhibitors() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_orphan_exhibitors() TO authenticated;

-- 3) admin_list_unpublished_exhibitors: exhibitors that satisfy 1-5 but miss something for publication
CREATE OR REPLACE FUNCTION public.admin_list_unpublished_exhibitors()
RETURNS TABLE (
  profile_id   uuid,
  email        text,
  full_name    text,
  trade_name   text,
  reason       text,
  created_at   timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event uuid := public.pipeline_active_event_id();
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.email,
    p.full_name,
    c.trade_name,
    CASE
      WHEN v_event IS NULL                                       THEN 'no_active_event'
      WHEN p.company_id IS NULL                                  THEN 'no_company'
      WHEN c.id IS NULL                                          THEN 'no_company'
      WHEN p.is_active IS NOT TRUE                               THEN 'inactive'
      WHEN ur.user_id IS NULL                                    THEN 'missing_role'
      WHEN et.id IS NULL                                         THEN 'no_table'
      ELSE 'unknown'
    END AS reason,
    p.created_at
  FROM public.exhibitor_profiles ep
  JOIN public.profiles p ON p.id = ep.profile_id
  LEFT JOIN public.companies  c  ON c.id = p.company_id
  LEFT JOIN public.user_roles ur ON ur.user_id = p.auth_user_id AND ur.role = 'exhibitor'::app_role
  LEFT JOIN public.event_tables et
         ON et.exhibitor_profile_id = p.id
        AND et.event_id = v_event
  WHERE
    v_event IS NULL
    OR p.is_active IS NOT TRUE
    OR ur.user_id IS NULL
    OR et.id IS NULL
    -- (no_company is already covered by orphan panel; exclude from this panel)
  ORDER BY p.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_unpublished_exhibitors() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_unpublished_exhibitors() TO authenticated;

-- 4) admin_link_orphan_to_company: safe link with force + audit
CREATE OR REPLACE FUNCTION public.admin_link_orphan_to_company(
  p_profile_id   uuid,
  p_company_id   uuid,
  p_force        boolean DEFAULT false,
  p_force_reason text    DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_company uuid;
  v_has_visitor  boolean;
  v_has_exhibitor boolean;
  v_actor_profile uuid;
  v_reason text := btrim(COALESCE(p_force_reason, ''));
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT company_id INTO v_existing_company
    FROM public.profiles WHERE id = p_profile_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;
  IF v_existing_company IS NOT NULL THEN
    RAISE EXCEPTION 'profile_already_linked';
  END IF;

  -- Confirm target company exists
  PERFORM 1 FROM public.companies WHERE id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'company_not_found';
  END IF;

  -- Detect roles of profiles currently linked to the target company
  SELECT
    bool_or(ur.role = 'visitor'::app_role),
    bool_or(ur.role = 'exhibitor'::app_role)
  INTO v_has_visitor, v_has_exhibitor
  FROM public.profiles cp
  LEFT JOIN public.user_roles ur ON ur.user_id = cp.auth_user_id
  WHERE cp.company_id = p_company_id;

  v_has_visitor   := COALESCE(v_has_visitor,   false);
  v_has_exhibitor := COALESCE(v_has_exhibitor, false);

  -- Default-block link to any non-pure-exhibitor company
  IF (v_has_visitor AND NOT v_has_exhibitor) OR (v_has_visitor AND v_has_exhibitor) THEN
    IF NOT p_force THEN
      RAISE EXCEPTION 'link_blocked_company_role'
        USING HINT = 'Use force=true with a justification to override.';
    END IF;
    IF length(v_reason) < 10 THEN
      RAISE EXCEPTION 'force_reason_required'
        USING HINT = 'Provide a justification with at least 10 characters.';
    END IF;
  END IF;

  UPDATE public.profiles SET company_id = p_company_id WHERE id = p_profile_id;

  SELECT id INTO v_actor_profile FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;

  IF p_force AND (v_has_visitor) THEN
    INSERT INTO public.audit_logs (actor_profile_id, action, payload)
    VALUES (
      v_actor_profile,
      'exhibitor.orphan_linked_forced',
      jsonb_build_object(
        'profile_id', p_profile_id,
        'company_id', p_company_id,
        'detected_roles', jsonb_build_object('visitor', v_has_visitor, 'exhibitor', v_has_exhibitor),
        'force_reason', v_reason
      )
    );
  ELSE
    INSERT INTO public.audit_logs (actor_profile_id, action, payload)
    VALUES (
      v_actor_profile,
      'exhibitor.orphan_linked',
      jsonb_build_object(
        'profile_id', p_profile_id,
        'company_id', p_company_id
      )
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_link_orphan_to_company(uuid, uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_link_orphan_to_company(uuid, uuid, boolean, text) TO authenticated;

-- 5) admin_create_company_for_orphan: atomic create + link + audit
CREATE OR REPLACE FUNCTION public.admin_create_company_for_orphan(
  p_profile_id   uuid,
  p_trade_name   text,
  p_country_code text,
  p_city         text DEFAULT NULL,
  p_legal_name   text DEFAULT NULL,
  p_state_code   text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_company uuid;
  v_company_id uuid;
  v_actor_profile uuid;
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_trade_name IS NULL OR length(btrim(p_trade_name)) < 2 THEN
    RAISE EXCEPTION 'trade_name_required';
  END IF;
  IF p_country_code IS NULL OR length(btrim(p_country_code)) < 2 THEN
    RAISE EXCEPTION 'country_code_required';
  END IF;

  SELECT company_id INTO v_existing_company
    FROM public.profiles WHERE id = p_profile_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;
  IF v_existing_company IS NOT NULL THEN
    RAISE EXCEPTION 'profile_already_linked';
  END IF;

  INSERT INTO public.companies (trade_name, legal_name, country_code, state_code, city)
  VALUES (
    btrim(p_trade_name),
    nullif(btrim(coalesce(p_legal_name, '')), ''),
    upper(btrim(p_country_code)),
    nullif(upper(btrim(coalesce(p_state_code, ''))), ''),
    nullif(btrim(coalesce(p_city, '')), '')
  )
  RETURNING id INTO v_company_id;

  UPDATE public.profiles SET company_id = v_company_id WHERE id = p_profile_id;

  SELECT id INTO v_actor_profile FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;
  INSERT INTO public.audit_logs (actor_profile_id, action, payload)
  VALUES (
    v_actor_profile,
    'exhibitor.orphan_company_created',
    jsonb_build_object('profile_id', p_profile_id, 'company_id', v_company_id, 'trade_name', btrim(p_trade_name))
  );

  RETURN v_company_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_company_for_orphan(uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_company_for_orphan(uuid, text, text, text, text, text) TO authenticated;

-- 6) Backfill: idempotent audit of pre-existing orphans
INSERT INTO public.audit_logs (actor_profile_id, action, payload)
SELECT
  NULL,
  'exhibitor.orphan_detected',
  jsonb_build_object('profile_id', p.id, 'email', p.email, 'full_name', p.full_name)
FROM public.exhibitor_profiles ep
JOIN public.profiles p ON p.id = ep.profile_id
WHERE p.company_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.audit_logs al
     WHERE al.action = 'exhibitor.orphan_detected'
       AND al.payload->>'profile_id' = p.id::text
  );