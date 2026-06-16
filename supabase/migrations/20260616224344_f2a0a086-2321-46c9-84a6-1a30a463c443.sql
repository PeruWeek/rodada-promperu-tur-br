-- Enable pg_trgm for similarity scoring on trade/legal names
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1) Review columns on profiles
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'profile_review_status') THEN
    CREATE TYPE public.profile_review_status AS ENUM ('none','needs_review','resolved');
  END IF;
END $$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS review_status public.profile_review_status NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS review_reasons text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS review_payload jsonb,
  ADD COLUMN IF NOT EXISTS review_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_resolved_by uuid REFERENCES public.profiles(id);

CREATE INDEX IF NOT EXISTS profiles_review_status_idx
  ON public.profiles(review_status)
  WHERE review_status = 'needs_review';

-- 2) Helper: detect duplicates and divergence
CREATE OR REPLACE FUNCTION public.pre_reg_match_quality(
  p_email text,
  p_tax_id text DEFAULT NULL,
  p_country_code text DEFAULT NULL,
  p_trade_name text DEFAULT NULL,
  p_legal_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email_count int := 0;
  v_email_candidates uuid[] := '{}';
  v_email_match_id uuid;
  v_tax_count int := 0;
  v_tax_candidates uuid[] := '{}';
  v_reasons text[] := '{}';
  v_unique boolean := true;
  v_pre_company record;
  v_email_norm text;
  v_tax_norm text;
  v_country text;
BEGIN
  v_email_norm := lower(btrim(coalesce(p_email,'')));
  v_tax_norm := nullif(btrim(coalesce(p_tax_id,'')), '');
  v_country := nullif(upper(btrim(coalesce(p_country_code,''))), '');

  IF v_email_norm = '' THEN
    RETURN jsonb_build_object('unique', false, 'reasons', ARRAY['dado_critico_ausente'], 'candidate_profile_ids', '{}'::uuid[]);
  END IF;

  -- Count pending pre-registrations by email
  SELECT count(*), array_agg(id)
    INTO v_email_count, v_email_candidates
  FROM public.profiles
  WHERE pending_signup = true
    AND auth_user_id IS NULL
    AND lower(btrim(email::text)) = v_email_norm;

  IF v_email_count > 1 THEN
    v_unique := false;
    v_reasons := v_reasons || 'email_duplicado';
  ELSIF v_email_count = 1 THEN
    v_email_match_id := v_email_candidates[1];
  END IF;

  -- Count pending pre-registrations by CNPJ/tax_id (via company)
  IF v_tax_norm IS NOT NULL THEN
    SELECT count(*), array_agg(p.id)
      INTO v_tax_count, v_tax_candidates
    FROM public.profiles p
    JOIN public.companies c ON c.id = p.company_id
    WHERE p.pending_signup = true
      AND p.auth_user_id IS NULL
      AND c.tax_id = v_tax_norm;

    IF v_tax_count > 1 THEN
      v_unique := false;
      v_reasons := v_reasons || 'cnpj_duplicado';
    END IF;
  END IF;

  -- Divergence check: only when we have a single email match with company data
  IF v_email_match_id IS NOT NULL THEN
    SELECT c.tax_id, c.country_code, c.trade_name, c.legal_name
      INTO v_pre_company
    FROM public.profiles p
    LEFT JOIN public.companies c ON c.id = p.company_id
    WHERE p.id = v_email_match_id;

    -- CNPJ conflict
    IF v_tax_norm IS NOT NULL AND v_pre_company.tax_id IS NOT NULL
       AND v_pre_company.tax_id <> v_tax_norm THEN
      v_unique := false;
      v_reasons := v_reasons || 'dados_divergentes';
    END IF;

    -- Country conflict
    IF v_country IS NOT NULL AND v_pre_company.country_code IS NOT NULL
       AND upper(v_pre_company.country_code) <> v_country THEN
      v_unique := false;
      IF NOT ('dados_divergentes' = ANY(v_reasons)) THEN
        v_reasons := v_reasons || 'dados_divergentes';
      END IF;
    END IF;

    -- Legal/trade name similarity
    IF p_trade_name IS NOT NULL OR p_legal_name IS NOT NULL THEN
      DECLARE
        v_sim_trade numeric := 0;
        v_sim_legal numeric := 0;
      BEGIN
        IF p_trade_name IS NOT NULL AND coalesce(v_pre_company.trade_name,'') <> '' THEN
          v_sim_trade := similarity(lower(btrim(p_trade_name)), lower(btrim(v_pre_company.trade_name)));
        END IF;
        IF p_legal_name IS NOT NULL AND coalesce(v_pre_company.legal_name,'') <> '' THEN
          v_sim_legal := similarity(lower(btrim(p_legal_name)), lower(btrim(v_pre_company.legal_name)));
        END IF;
        IF v_sim_trade < 0.80 AND v_sim_legal < 0.80
           AND (p_trade_name IS NOT NULL OR p_legal_name IS NOT NULL)
           AND (coalesce(v_pre_company.trade_name,'') <> '' OR coalesce(v_pre_company.legal_name,'') <> '') THEN
          v_unique := false;
          IF NOT ('dados_divergentes' = ANY(v_reasons)) THEN
            v_reasons := v_reasons || 'dados_divergentes';
          END IF;
        END IF;
      END;
    END IF;
  END IF;

  -- Critical missing data: BR company with no tax_id anywhere
  IF v_country = 'BR' AND v_tax_norm IS NULL
     AND (v_pre_company.tax_id IS NULL OR v_pre_company.tax_id = '') THEN
    v_unique := false;
    v_reasons := v_reasons || 'dado_critico_ausente';
  END IF;

  RETURN jsonb_build_object(
    'unique', v_unique,
    'reasons', v_reasons,
    'email_match_id', v_email_match_id,
    'email_count', v_email_count,
    'tax_count', v_tax_count,
    'candidate_profile_ids',
      (SELECT array_agg(DISTINCT x) FROM unnest(v_email_candidates || v_tax_candidates) x WHERE x IS NOT NULL)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.pre_reg_match_quality(text, text, text, text, text) TO authenticated, service_role;

-- 3) Update handle_new_user to detect duplicate-email pre-regs
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_full_name text;
  v_lang app_language;
  v_pending_id uuid;
  v_pending_count int := 0;
  v_email_norm text;
begin
  v_full_name := coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1));
  v_lang := case when (new.raw_user_meta_data->>'preferred_language') = 'es' then 'es'::app_language else 'pt-BR'::app_language end;
  v_email_norm := lower(btrim(new.email));

  -- How many pending pre-registrations share this email?
  SELECT count(*) INTO v_pending_count
  FROM public.profiles
  WHERE pending_signup = true
    AND auth_user_id IS NULL
    AND email IS NOT NULL
    AND lower(btrim(email::text)) = v_email_norm;

  IF v_pending_count = 1 THEN
    -- Unique pre-registration → claim it (current behaviour)
    SELECT id INTO v_pending_id
    FROM public.profiles
    WHERE pending_signup = true
      AND auth_user_id IS NULL
      AND email IS NOT NULL
      AND lower(btrim(email::text)) = v_email_norm
    FOR UPDATE
    LIMIT 1;

    UPDATE public.profiles
    SET auth_user_id = new.id,
        pending_signup = false,
        full_name = COALESCE(NULLIF(btrim(full_name), ''), v_full_name),
        preferred_language = COALESCE(preferred_language, v_lang)
    WHERE id = v_pending_id;
  ELSIF v_pending_count > 1 THEN
    -- Ambiguous → create a brand-new profile in review queue, leave pendings untouched
    INSERT INTO public.profiles (
      auth_user_id, full_name, email, preferred_language,
      review_status, review_reasons, review_created_at, review_payload
    )
    VALUES (
      new.id, v_full_name, new.email, v_lang,
      'needs_review',
      ARRAY['email_duplicado']::text[],
      now(),
      jsonb_build_object(
        'source', 'signup_trigger',
        'email', new.email,
        'pending_email_count', v_pending_count
      )
    )
    ON CONFLICT (auth_user_id) DO NOTHING;
  ELSE
    -- No pending → fresh profile
    INSERT INTO public.profiles (auth_user_id, full_name, email, preferred_language)
    VALUES (new.id, v_full_name, new.email, v_lang)
    ON CONFLICT (auth_user_id) DO NOTHING;
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (new.id, 'visitor')
  ON CONFLICT (user_id) DO NOTHING;

  RETURN new;
end;
$function$;

-- 4) Update complete_buyer_signup to flag divergences instead of overwriting silently
CREATE OR REPLACE FUNCTION public.complete_buyer_signup(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
  v_existing_company uuid;
  v_company_id uuid;
  v_trade_name text;
  v_legal_name text;
  v_tax_id text;
  v_registration_id text;
  v_country text;
  v_state text;
  v_city text;
  v_full_name text;
  v_job_title text;
  v_phone text;
  v_whatsapp text;
  v_lang public.app_language;
  v_quality jsonb;
  v_reasons text[];
  v_unique boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  v_trade_name := nullif(btrim(coalesce(p_payload->>'trade_name','')), '');
  v_legal_name := nullif(btrim(coalesce(p_payload->>'legal_name','')), '');
  v_tax_id := nullif(btrim(coalesce(p_payload->>'tax_id','')), '');
  v_registration_id := nullif(btrim(coalesce(p_payload->>'registration_id','')), '');
  v_country := upper(coalesce(nullif(btrim(p_payload->>'country_code'),''), 'BR'));
  v_state := nullif(upper(btrim(coalesce(p_payload->>'state_code',''))), '');
  v_city := nullif(btrim(coalesce(p_payload->>'city','')), '');
  v_full_name := nullif(btrim(coalesce(p_payload->>'full_name','')), '');
  v_job_title := nullif(btrim(coalesce(p_payload->>'job_title','')), '');
  v_phone := nullif(btrim(coalesce(p_payload->>'phone','')), '');
  v_whatsapp := nullif(btrim(coalesce(p_payload->>'whatsapp','')), '');
  v_lang := CASE WHEN (p_payload->>'preferred_language') = 'es' THEN 'es'::public.app_language ELSE 'pt-BR'::public.app_language END;

  IF v_trade_name IS NULL THEN RAISE EXCEPTION 'trade_name required'; END IF;
  IF v_full_name IS NULL THEN RAISE EXCEPTION 'full_name required'; END IF;
  IF COALESCE((p_payload->>'consent_data_sharing')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'consent_data_sharing required';
  END IF;

  SELECT id, company_id INTO v_profile_id, v_existing_company
  FROM public.profiles WHERE auth_user_id = auth.uid() FOR UPDATE;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'profile not found'; END IF;

  -- Evaluate match quality against pending pre-regs (excluding current profile).
  -- We only flag review if this profile was itself a claimed pre-reg (i.e. there was a pending profile with the same email) and the form data diverges.
  SELECT public.pre_reg_match_quality(
    (SELECT email::text FROM public.profiles WHERE id = v_profile_id),
    v_tax_id, v_country, v_trade_name, v_legal_name
  ) INTO v_quality;

  v_unique := COALESCE((v_quality->>'unique')::boolean, true);
  v_reasons := ARRAY(SELECT jsonb_array_elements_text(coalesce(v_quality->'reasons', '[]'::jsonb)));

  -- Always write the data the user submitted (so the user can move on),
  -- but flag for review when the match wasn't clean.
  IF NOT v_unique AND array_length(v_reasons, 1) > 0 THEN
    UPDATE public.profiles
    SET review_status = 'needs_review',
        review_reasons = v_reasons,
        review_created_at = COALESCE(review_created_at, now()),
        review_payload = jsonb_build_object(
          'source', 'complete_buyer_signup',
          'submitted', p_payload,
          'quality', v_quality
        )
    WHERE id = v_profile_id;
  END IF;

  IF v_existing_company IS NULL THEN
    INSERT INTO public.companies (
      trade_name, legal_name, tax_id, registration_id,
      country_code, state_code, city,
      website, instagram, linkedin, address, general_phone, specialty, import_profile
    )
    VALUES (
      v_trade_name, v_legal_name, v_tax_id, v_registration_id,
      v_country, v_state, v_city,
      nullif(btrim(coalesce(p_payload->>'website','')), ''),
      nullif(btrim(coalesce(p_payload->>'instagram','')), ''),
      nullif(btrim(coalesce(p_payload->>'linkedin','')), ''),
      nullif(btrim(coalesce(p_payload->>'address','')), ''),
      nullif(btrim(coalesce(p_payload->>'general_phone','')), ''),
      nullif(btrim(coalesce(p_payload->>'specialty','')), ''),
      nullif(btrim(coalesce(p_payload->>'import_profile','')), '')
    )
    RETURNING id INTO v_company_id;
  ELSE
    v_company_id := v_existing_company;
    UPDATE public.companies
    SET trade_name = v_trade_name,
        legal_name = COALESCE(v_legal_name, legal_name),
        tax_id = COALESCE(v_tax_id, tax_id),
        registration_id = COALESCE(v_registration_id, registration_id),
        country_code = v_country,
        state_code = COALESCE(v_state, state_code),
        city = COALESCE(v_city, city),
        website = COALESCE(nullif(btrim(coalesce(p_payload->>'website','')), ''), website),
        instagram = COALESCE(nullif(btrim(coalesce(p_payload->>'instagram','')), ''), instagram),
        linkedin = COALESCE(nullif(btrim(coalesce(p_payload->>'linkedin','')), ''), linkedin),
        address = COALESCE(nullif(btrim(coalesce(p_payload->>'address','')), ''), address),
        general_phone = COALESCE(nullif(btrim(coalesce(p_payload->>'general_phone','')), ''), general_phone),
        specialty = COALESCE(nullif(btrim(coalesce(p_payload->>'specialty','')), ''), specialty),
        import_profile = COALESCE(nullif(btrim(coalesce(p_payload->>'import_profile','')), ''), import_profile)
    WHERE id = v_company_id;
  END IF;

  UPDATE public.profiles
  SET full_name = v_full_name,
      job_title = COALESCE(v_job_title, job_title),
      phone = COALESCE(v_phone, phone),
      whatsapp = COALESCE(v_whatsapp, whatsapp),
      preferred_language = v_lang,
      company_id = v_company_id
  WHERE id = v_profile_id;

  INSERT INTO public.visitor_profiles (
    profile_id, buyer_type, buyer_types, interests_segments, interests_destinations, interests_services,
    consent_data_sharing, consent_marketing
  )
  VALUES (
    v_profile_id,
    p_payload->>'buyer_type',
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_payload->'buyer_types')), '{}'::text[]),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_payload->'interests_segments')), '{}'::text[]),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_payload->'interests_destinations')), '{}'::text[]),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_payload->'interests_services')), '{}'::text[]),
    true,
    COALESCE((p_payload->>'consent_marketing')::boolean, false)
  )
  ON CONFLICT (profile_id) DO UPDATE SET
    buyer_type = EXCLUDED.buyer_type,
    buyer_types = EXCLUDED.buyer_types,
    interests_segments = EXCLUDED.interests_segments,
    interests_destinations = EXCLUDED.interests_destinations,
    interests_services = EXCLUDED.interests_services,
    consent_data_sharing = EXCLUDED.consent_data_sharing,
    consent_marketing = EXCLUDED.consent_marketing;

  RETURN v_company_id;
END $$;

GRANT EXECUTE ON FUNCTION public.complete_buyer_signup(jsonb) TO authenticated;
