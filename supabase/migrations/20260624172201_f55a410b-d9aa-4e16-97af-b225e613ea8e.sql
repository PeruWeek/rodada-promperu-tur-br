-- Companies: add inactivity flag and auto-recalc when profile membership changes
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS inactivated_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS inactivated_reason text NULL;

CREATE INDEX IF NOT EXISTS companies_is_active_idx
  ON public.companies (is_active) WHERE is_active = true;

-- Backfill: empresas sem nenhum profile ativo viram órfãs
UPDATE public.companies c
   SET is_active = false,
       inactivated_at = now(),
       inactivated_reason = 'no_active_users'
 WHERE c.is_active = true
   AND NOT EXISTS (
     SELECT 1 FROM public.profiles p
      WHERE p.company_id = c.id
        AND p.is_active = true
        AND p.pending_signup = false
   );

-- Função de recálculo
CREATE OR REPLACE FUNCTION public.recalc_company_active(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_company record;
BEGIN
  IF p_company_id IS NULL THEN RETURN; END IF;

  SELECT id, is_active, inactivated_reason
    INTO v_company
    FROM public.companies
   WHERE id = p_company_id
   FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT count(*) INTO v_count
    FROM public.profiles
   WHERE company_id = p_company_id
     AND is_active = true
     AND pending_signup = false;

  IF v_count > 0 THEN
    -- Reativa apenas se foi inativada por falta de usuários
    IF v_company.is_active = false
       AND v_company.inactivated_reason = 'no_active_users' THEN
      UPDATE public.companies
         SET is_active = true,
             inactivated_at = NULL,
             inactivated_reason = NULL
       WHERE id = p_company_id;
    END IF;
  ELSE
    IF v_company.is_active = true THEN
      UPDATE public.companies
         SET is_active = false,
             inactivated_at = now(),
             inactivated_reason = 'no_active_users'
       WHERE id = p_company_id;
    END IF;
  END IF;
END;
$$;

-- Trigger em profiles
CREATE OR REPLACE FUNCTION public.trg_profiles_recalc_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.recalc_company_active(NEW.company_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.recalc_company_active(OLD.company_id);
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.company_id IS DISTINCT FROM OLD.company_id
       OR NEW.is_active IS DISTINCT FROM OLD.is_active
       OR NEW.pending_signup IS DISTINCT FROM OLD.pending_signup THEN
      IF OLD.company_id IS NOT NULL THEN
        PERFORM public.recalc_company_active(OLD.company_id);
      END IF;
      IF NEW.company_id IS NOT NULL
         AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN
        PERFORM public.recalc_company_active(NEW.company_id);
      ELSIF NEW.company_id IS NOT NULL THEN
        PERFORM public.recalc_company_active(NEW.company_id);
      END IF;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_recalc_company ON public.profiles;
CREATE TRIGGER trg_profiles_recalc_company
AFTER INSERT OR UPDATE OR DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.trg_profiles_recalc_company();

-- Atualiza catálogo público para esconder empresas inativas
CREATE OR REPLACE FUNCTION public.public_exhibitor_catalog(_event_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(profile_id uuid, full_name text, trade_name text, country_code text, city text, segments text[], services text[], destinations text[], table_number integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    AND p.company_id IS NOT NULL
    AND c.is_active = true;
END;
$function$;