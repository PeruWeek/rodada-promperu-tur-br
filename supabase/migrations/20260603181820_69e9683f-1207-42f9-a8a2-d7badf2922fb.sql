
-- 1) Hide profiles.email from authenticated/anon roles (column-level)
REVOKE SELECT ON public.profiles FROM anon, authenticated;
GRANT SELECT (id, auth_user_id, company_id, full_name, preferred_language, is_active, created_at)
  ON public.profiles TO authenticated;
GRANT SELECT (id, auth_user_id, company_id, full_name, preferred_language, is_active, created_at)
  ON public.profiles TO anon;
GRANT INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

-- 2) Drop the over-permissive visitor UPDATE policy on meetings.
--    Visitor cancellations are handled server-side via supabaseAdmin in the cancelMeeting server function.
DROP POLICY IF EXISTS "meetings update visitor own" ON public.meetings;

-- 3) Atomic onboarding function to prevent duplicate company creation race.
CREATE OR REPLACE FUNCTION public.onboard_company(
  p_trade_name text,
  p_country_code text,
  p_city text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
  v_company_id uuid;
  v_existing_company uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_trade_name IS NULL OR length(btrim(p_trade_name)) = 0 THEN
    RAISE EXCEPTION 'trade_name required';
  END IF;
  IF p_country_code IS NULL OR length(btrim(p_country_code)) = 0 THEN
    RAISE EXCEPTION 'country_code required';
  END IF;

  -- Lock the caller's profile row to serialize concurrent onboarding requests.
  SELECT id, company_id
    INTO v_profile_id, v_existing_company
  FROM public.profiles
  WHERE auth_user_id = auth.uid()
  FOR UPDATE;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF v_existing_company IS NOT NULL THEN
    RETURN v_existing_company;
  END IF;

  INSERT INTO public.companies (trade_name, country_code, city)
  VALUES (btrim(p_trade_name), btrim(p_country_code), NULLIF(btrim(coalesce(p_city, '')), ''))
  RETURNING id INTO v_company_id;

  UPDATE public.profiles
     SET company_id = v_company_id
   WHERE id = v_profile_id;

  RETURN v_company_id;
END;
$$;

REVOKE ALL ON FUNCTION public.onboard_company(text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.onboard_company(text, text, text) TO authenticated;

-- Remove the racey direct-insert policy; force onboarding through the function.
DROP POLICY IF EXISTS "companies insert onboarding" ON public.companies;
