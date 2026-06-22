
ALTER TABLE public.visitor_profiles
  ADD COLUMN IF NOT EXISTS networking_lunch_participation boolean;

CREATE OR REPLACE FUNCTION public.complete_buyer_signup(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_lunch boolean;
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

  IF p_payload ? 'networking_lunch_participation'
     AND jsonb_typeof(p_payload->'networking_lunch_participation') = 'boolean' THEN
    v_lunch := (p_payload->>'networking_lunch_participation')::boolean;
  ELSE
    RAISE EXCEPTION 'networking_lunch_participation required';
  END IF;

  IF v_trade_name IS NULL THEN RAISE EXCEPTION 'trade_name required'; END IF;
  IF v_full_name IS NULL THEN RAISE EXCEPTION 'full_name required'; END IF;
  IF COALESCE((p_payload->>'consent_data_sharing')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'consent_data_sharing required';
  END IF;

  SELECT id, company_id INTO v_profile_id, v_existing_company
  FROM public.profiles WHERE auth_user_id = auth.uid() FOR UPDATE;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'profile not found'; END IF;

  SELECT public.pre_reg_match_quality(
    (SELECT email::text FROM public.profiles WHERE id = v_profile_id),
    v_tax_id, v_country, v_trade_name, v_legal_name
  ) INTO v_quality;

  v_unique := COALESCE((v_quality->>'unique')::boolean, true);
  v_reasons := ARRAY(SELECT jsonb_array_elements_text(coalesce(v_quality->'reasons', '[]'::jsonb)));

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
    consent_data_sharing, consent_marketing, signup_completed_at, networking_lunch_participation
  )
  VALUES (
    v_profile_id,
    p_payload->>'buyer_type',
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_payload->'buyer_types')), '{}'::text[]),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_payload->'interests_segments')), '{}'::text[]),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_payload->'interests_destinations')), '{}'::text[]),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_payload->'interests_services')), '{}'::text[]),
    true,
    COALESCE((p_payload->>'consent_marketing')::boolean, false),
    now(),
    v_lunch
  )
  ON CONFLICT (profile_id) DO UPDATE SET
    buyer_type = EXCLUDED.buyer_type,
    buyer_types = EXCLUDED.buyer_types,
    interests_segments = EXCLUDED.interests_segments,
    interests_destinations = EXCLUDED.interests_destinations,
    interests_services = EXCLUDED.interests_services,
    consent_data_sharing = EXCLUDED.consent_data_sharing,
    consent_marketing = EXCLUDED.consent_marketing,
    networking_lunch_participation = EXCLUDED.networking_lunch_participation,
    signup_completed_at = COALESCE(public.visitor_profiles.signup_completed_at, EXCLUDED.signup_completed_at);

  RETURN v_company_id;
END $function$;
