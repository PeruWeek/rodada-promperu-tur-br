-- Restrict SELECT on companies and profiles to avoid leaking sensitive columns
-- (tax_id, phone, whatsapp, email, address, etc.) to meeting partners or to any
-- authenticated user simply because the row belongs to an exhibitor.
-- Cross-user discovery (catalog, agenda partner names) is moved to two
-- SECURITY DEFINER functions that expose only safe columns.

-- 1) Tighten companies SELECT: drop is_exhibitor_company / has_meeting_with_company
DROP POLICY IF EXISTS "companies select scoped" ON public.companies;
CREATE POLICY "companies select scoped"
  ON public.companies
  FOR SELECT
  TO authenticated
  USING (
    id = (
      SELECT profiles.company_id
      FROM public.profiles
      WHERE profiles.auth_user_id = auth.uid()
      LIMIT 1
    )
    OR public.is_admin_or_staff(auth.uid())
  );

-- 2) Tighten profiles SELECT: drop is_exhibitor_profile / has_meeting_with_profile
DROP POLICY IF EXISTS "profiles select scoped" ON public.profiles;
CREATE POLICY "profiles select scoped"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    auth_user_id = auth.uid()
    OR public.is_admin_or_staff(auth.uid())
  );

-- 3) Safe-column projection for cross-user reads (catalog, meeting partners)
CREATE OR REPLACE FUNCTION public.public_profiles(_ids uuid[])
RETURNS TABLE (
  id uuid,
  full_name text,
  company_id uuid,
  job_title text,
  preferred_language app_language,
  is_active boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.full_name, p.company_id, p.job_title, p.preferred_language, p.is_active
  FROM public.profiles p
  WHERE p.id = ANY(_ids);
$$;

REVOKE ALL ON FUNCTION public.public_profiles(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_profiles(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.public_companies(_ids uuid[])
RETURNS TABLE (
  id uuid,
  trade_name text,
  legal_name text,
  country_code text,
  state_code text,
  city text,
  website text,
  linkedin text,
  instagram text,
  specialty text,
  import_profile text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.trade_name, c.legal_name, c.country_code, c.state_code, c.city,
         c.website, c.linkedin, c.instagram, c.specialty, c.import_profile
  FROM public.companies c
  WHERE c.id = ANY(_ids);
$$;

REVOKE ALL ON FUNCTION public.public_companies(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_companies(uuid[]) TO authenticated;