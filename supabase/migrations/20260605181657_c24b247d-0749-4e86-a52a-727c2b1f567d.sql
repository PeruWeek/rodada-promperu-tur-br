
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS tax_id text,
  ADD COLUMN IF NOT EXISTS state_code text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS job_title text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS whatsapp text;

ALTER TABLE public.visitor_profiles
  ADD COLUMN IF NOT EXISTS demand_profile text,
  ADD COLUMN IF NOT EXISTS interests_destinations_free text,
  ADD COLUMN IF NOT EXISTS consent_data_sharing boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consent_data_sharing_at timestamptz,
  ADD COLUMN IF NOT EXISTS consent_marketing boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.complete_buyer_signup(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
  v_company_id uuid;
  v_existing_company uuid;
  v_lang app_language;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF coalesce(btrim(p_payload->>'trade_name'), '') = '' THEN
    RAISE EXCEPTION 'trade_name required';
  END IF;
  IF coalesce(btrim(p_payload->>'city'), '') = '' THEN
    RAISE EXCEPTION 'city required';
  END IF;
  IF coalesce(btrim(p_payload->>'state_code'), '') = '' THEN
    RAISE EXCEPTION 'state_code required';
  END IF;
  IF coalesce(btrim(p_payload->>'full_name'), '') = '' THEN
    RAISE EXCEPTION 'full_name required';
  END IF;
  IF (p_payload->>'consent_data_sharing')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'consent_data_sharing required';
  END IF;

  v_lang := CASE WHEN (p_payload->>'preferred_language') = 'es' THEN 'es'::app_language ELSE 'pt-BR'::app_language END;

  SELECT id, company_id INTO v_profile_id, v_existing_company
  FROM public.profiles WHERE auth_user_id = auth.uid() FOR UPDATE;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF v_existing_company IS NULL THEN
    INSERT INTO public.companies (
      trade_name, legal_name, tax_id, country_code, state_code, city, website, instagram, linkedin
    ) VALUES (
      btrim(p_payload->>'trade_name'),
      nullif(btrim(coalesce(p_payload->>'legal_name','')), ''),
      nullif(btrim(coalesce(p_payload->>'tax_id','')), ''),
      'BR',
      upper(btrim(p_payload->>'state_code')),
      btrim(p_payload->>'city'),
      nullif(btrim(coalesce(p_payload->>'website','')), ''),
      nullif(btrim(coalesce(p_payload->>'instagram','')), ''),
      nullif(btrim(coalesce(p_payload->>'linkedin','')), '')
    ) RETURNING id INTO v_company_id;
  ELSE
    v_company_id := v_existing_company;
    UPDATE public.companies SET
      trade_name = btrim(p_payload->>'trade_name'),
      legal_name = nullif(btrim(coalesce(p_payload->>'legal_name','')), ''),
      tax_id = nullif(btrim(coalesce(p_payload->>'tax_id','')), ''),
      country_code = 'BR',
      state_code = upper(btrim(p_payload->>'state_code')),
      city = btrim(p_payload->>'city'),
      website = nullif(btrim(coalesce(p_payload->>'website','')), ''),
      instagram = nullif(btrim(coalesce(p_payload->>'instagram','')), ''),
      linkedin = nullif(btrim(coalesce(p_payload->>'linkedin','')), '')
    WHERE id = v_company_id;
  END IF;

  UPDATE public.profiles SET
    full_name = btrim(p_payload->>'full_name'),
    job_title = nullif(btrim(coalesce(p_payload->>'job_title','')), ''),
    phone = nullif(btrim(coalesce(p_payload->>'phone','')), ''),
    whatsapp = nullif(btrim(coalesce(p_payload->>'whatsapp','')), ''),
    preferred_language = v_lang,
    company_id = v_company_id
  WHERE id = v_profile_id;

  INSERT INTO public.visitor_profiles (
    profile_id, buyer_type, interests_segments, interests_destinations,
    interests_destinations_free, interests_services, demand_profile, notes,
    portfolio_pt, portfolio_es,
    consent_data_sharing, consent_data_sharing_at, consent_marketing
  ) VALUES (
    v_profile_id,
    nullif(btrim(coalesce(p_payload->>'buyer_type','')), ''),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload->'interests_segments','[]'::jsonb))), '{}'),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload->'interests_destinations','[]'::jsonb))), '{}'),
    nullif(btrim(coalesce(p_payload->>'interests_destinations_free','')), ''),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload->'interests_services','[]'::jsonb))), '{}'),
    nullif(btrim(coalesce(p_payload->>'demand_profile','')), ''),
    nullif(btrim(coalesce(p_payload->>'notes','')), ''),
    nullif(btrim(coalesce(p_payload->>'portfolio_pt','')), ''),
    nullif(btrim(coalesce(p_payload->>'portfolio_es','')), ''),
    true, now(),
    coalesce((p_payload->>'consent_marketing')::boolean, false)
  )
  ON CONFLICT (profile_id) DO UPDATE SET
    buyer_type = EXCLUDED.buyer_type,
    interests_segments = EXCLUDED.interests_segments,
    interests_destinations = EXCLUDED.interests_destinations,
    interests_destinations_free = EXCLUDED.interests_destinations_free,
    interests_services = EXCLUDED.interests_services,
    demand_profile = EXCLUDED.demand_profile,
    notes = EXCLUDED.notes,
    portfolio_pt = EXCLUDED.portfolio_pt,
    portfolio_es = EXCLUDED.portfolio_es,
    consent_data_sharing = true,
    consent_data_sharing_at = now(),
    consent_marketing = EXCLUDED.consent_marketing;

  RETURN v_company_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_buyer_signup(jsonb) TO authenticated;
