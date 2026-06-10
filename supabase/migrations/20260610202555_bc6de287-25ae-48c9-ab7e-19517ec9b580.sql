CREATE OR REPLACE FUNCTION public.admin_list_orphan_exhibitors()
RETURNS TABLE(
  profile_id uuid, email text, full_name text, is_active boolean,
  has_exhibitor_request boolean, request_status text,
  table_number integer, created_at timestamp with time zone
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    p.id::uuid                                              AS profile_id,
    p.email::text                                           AS email,
    p.full_name::text                                       AS full_name,
    p.is_active::boolean                                    AS is_active,
    (er.id IS NOT NULL)::boolean                            AS has_exhibitor_request,
    er.status::text                                         AS request_status,
    et.table_number::integer                                AS table_number,
    p.created_at::timestamp with time zone                  AS created_at
  FROM public.exhibitor_profiles ep
  JOIN public.profiles p ON p.id = ep.profile_id
  LEFT JOIN LATERAL (
    SELECT req.id, req.status
    FROM public.exhibitor_requests req
    WHERE req.profile_id = p.id
    ORDER BY req.created_at DESC
    LIMIT 1
  ) er ON true
  LEFT JOIN public.event_tables et
         ON et.exhibitor_profile_id = p.id
        AND et.event_id = public.pipeline_active_event_id()
  WHERE p.company_id IS NULL
  ORDER BY p.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_unpublished_exhibitors()
RETURNS TABLE(
  profile_id uuid, email text, full_name text, trade_name text,
  reason text, created_at timestamp with time zone
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event uuid := public.pipeline_active_event_id();
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    p.id::uuid                                              AS profile_id,
    p.email::text                                           AS email,
    p.full_name::text                                       AS full_name,
    c.trade_name::text                                      AS trade_name,
    (CASE
      WHEN v_event IS NULL THEN 'no_active_event'
      WHEN c.id IS NULL THEN 'no_company'
      WHEN p.is_active IS NOT TRUE THEN 'inactive'
      WHEN ur.user_id IS NULL THEN 'missing_role'
      WHEN et.id IS NULL THEN 'no_table'
      ELSE 'unknown'
    END)::text                                              AS reason,
    p.created_at::timestamp with time zone                  AS created_at
  FROM public.exhibitor_profiles ep
  JOIN public.profiles p ON p.id = ep.profile_id
  LEFT JOIN public.companies c ON c.id = p.company_id
  LEFT JOIN public.user_roles ur
         ON ur.user_id = p.auth_user_id
        AND ur.role = 'exhibitor'::app_role
  LEFT JOIN public.event_tables et
         ON et.exhibitor_profile_id = p.id
        AND et.event_id = v_event
  WHERE p.company_id IS NOT NULL
    AND (v_event IS NULL OR c.id IS NULL OR p.is_active IS NOT TRUE
         OR ur.user_id IS NULL OR et.id IS NULL)
  ORDER BY p.created_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_orphan_exhibitors() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_unpublished_exhibitors() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_orphan_exhibitors() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_unpublished_exhibitors() TO authenticated, service_role;

-- Dedupe Kronedesign duplicate (the empty one) with guard-rails
DO $$
DECLARE
  v_dup uuid := 'bb5dfd4f-5d54-40bc-8398-d16ca6eed8c5';
  v_refs int;
BEGIN
  SELECT
      (SELECT count(*) FROM public.profiles WHERE company_id = v_dup)
    + (SELECT count(*) FROM public.company_event_pipeline WHERE company_id = v_dup)
  INTO v_refs;

  IF v_refs = 0 THEN
    DELETE FROM public.companies WHERE id = v_dup;
    INSERT INTO public.audit_logs (actor_profile_id, action, payload)
    VALUES (NULL, 'company.dedupe_delete',
      jsonb_build_object('company_id', v_dup,
                         'reason', 'duplicate of 6d69e864 (Krone)',
                         'source', 'migration'));
  ELSE
    UPDATE public.companies
       SET trade_name = 'Kronedesign (duplicado — não usar)'
     WHERE id = v_dup;
    INSERT INTO public.audit_logs (actor_profile_id, action, payload)
    VALUES (NULL, 'company.dedupe_rename',
      jsonb_build_object('company_id', v_dup, 'refs', v_refs,
                         'source', 'migration'));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';