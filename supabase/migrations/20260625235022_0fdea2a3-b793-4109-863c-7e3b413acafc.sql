-- Causa raiz: o cadastro de visitante/comprador podia ser persistido como
-- "completo" sem os dois dados obrigatórios:
--   - networking_lunch_participation
--   - image_authorization  (campo não existia no schema)
--
-- Esta migration:
--   1) cria a coluna `image_authorization` em visitor_profiles (nullable
--      para preservar registros legados).
--   2) instala um trigger que torna ambos os campos obrigatórios sempre
--      que `signup_completed_at` for marcado, em qualquer caminho de
--      escrita (RPC, upsert direto, staff dialog, edição de perfil).
--   3) impede regressão: depois que `signup_completed_at` está marcado,
--      os dois campos não podem ser apagados para NULL.
--   4) atualiza a RPC `complete_buyer_signup` para exigir
--      `image_authorization` no payload e persisti-lo.

ALTER TABLE public.visitor_profiles
  ADD COLUMN IF NOT EXISTS image_authorization boolean;

COMMENT ON COLUMN public.visitor_profiles.image_authorization IS
  'Autorização de uso de imagem do visitante. Obrigatório (junto com networking_lunch_participation) em qualquer signup novo: trigger enforce_visitor_signup_completion_fields bloqueia signup_completed_at sem ambos.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger de integridade: enforça obrigatoriedade na conclusão do signup
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_visitor_signup_completion_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- Se o registro está sendo marcado como completo (signup_completed_at
  -- saindo de NULL para NOT NULL, ou inserido já com valor), exigir os dois
  -- campos. Não usar default — ausência tem que falhar explicitamente.
  IF NEW.signup_completed_at IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.signup_completed_at IS NULL) THEN
    IF NEW.networking_lunch_participation IS NULL THEN
      RAISE EXCEPTION 'networking_lunch_participation_required'
        USING HINT = 'Visitor signup cannot be completed without networking_lunch_participation.';
    END IF;
    IF NEW.image_authorization IS NULL THEN
      RAISE EXCEPTION 'image_authorization_required'
        USING HINT = 'Visitor signup cannot be completed without image_authorization.';
    END IF;
  END IF;

  -- Defesa em profundidade: depois de completo, não permitir apagar esses
  -- campos para NULL sem nova escolha explícita (qualquer valor boolean
  -- continua aceito).
  IF TG_OP = 'UPDATE'
     AND OLD.signup_completed_at IS NOT NULL THEN
    IF OLD.networking_lunch_participation IS NOT NULL
       AND NEW.networking_lunch_participation IS NULL THEN
      RAISE EXCEPTION 'networking_lunch_participation_cannot_be_cleared'
        USING HINT = 'Once provided, networking_lunch_participation can be changed but not cleared.';
    END IF;
    IF OLD.image_authorization IS NOT NULL
       AND NEW.image_authorization IS NULL THEN
      RAISE EXCEPTION 'image_authorization_cannot_be_cleared'
        USING HINT = 'Once provided, image_authorization can be changed but not cleared.';
    END IF;
    -- E não desfazer a conclusão.
    IF NEW.signup_completed_at IS NULL THEN
      RAISE EXCEPTION 'signup_completed_at_cannot_be_cleared';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_visitor_signup_completion
  ON public.visitor_profiles;

CREATE TRIGGER trg_enforce_visitor_signup_completion
  BEFORE INSERT OR UPDATE ON public.visitor_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_visitor_signup_completion_fields();

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC complete_buyer_signup: exigir image_authorization explicitamente e
-- persisti-lo junto com networking_lunch_participation.
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_found_company uuid;
  v_trade_name text;
  v_legal_name text;
  v_tax_id text;
  v_tax_digits text;
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
  v_extra_reasons text[] := ARRAY[]::text[];
  v_existing_reasons text[];
  v_merged_reasons text[];
  v_unique boolean;
  v_lunch boolean;
  v_image_auth boolean;
  v_current_email text;
  v_has_claimed boolean;
  v_has_pending boolean;
  v_has_pending_same_email boolean;
  v_has_pending_other_email boolean;
  v_reused_company boolean := false;
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

  -- Obrigatórios duros: rejeitar payloads parciais com erro explícito.
  IF p_payload ? 'networking_lunch_participation'
     AND jsonb_typeof(p_payload->'networking_lunch_participation') = 'boolean' THEN
    v_lunch := (p_payload->>'networking_lunch_participation')::boolean;
  ELSE
    RAISE EXCEPTION 'networking_lunch_participation_required';
  END IF;

  IF p_payload ? 'image_authorization'
     AND jsonb_typeof(p_payload->'image_authorization') = 'boolean' THEN
    v_image_auth := (p_payload->>'image_authorization')::boolean;
  ELSE
    RAISE EXCEPTION 'image_authorization_required';
  END IF;

  IF v_trade_name IS NULL THEN RAISE EXCEPTION 'trade_name required'; END IF;
  IF v_full_name IS NULL THEN RAISE EXCEPTION 'full_name required'; END IF;
  IF COALESCE((p_payload->>'consent_data_sharing')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'consent_data_sharing required';
  END IF;

  SELECT id, company_id INTO v_profile_id, v_existing_company
  FROM public.profiles WHERE auth_user_id = auth.uid() FOR UPDATE;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'profile not found'; END IF;

  SELECT email::text INTO v_current_email FROM public.profiles WHERE id = v_profile_id;

  SELECT public.pre_reg_match_quality(
    v_current_email, v_tax_id, v_country, v_trade_name, v_legal_name
  ) INTO v_quality;

  v_unique := COALESCE((v_quality->>'unique')::boolean, true);
  v_reasons := ARRAY(SELECT jsonb_array_elements_text(coalesce(v_quality->'reasons', '[]'::jsonb)));
  IF NOT v_unique THEN
    v_extra_reasons := v_extra_reasons || v_reasons;
  END IF;

  IF v_existing_company IS NULL AND v_tax_id IS NOT NULL THEN
    v_tax_digits := regexp_replace(v_tax_id, '\D', '', 'g');
    IF length(coalesce(v_tax_digits, '')) > 0 THEN
      SELECT id INTO v_found_company
      FROM public.companies
      WHERE regexp_replace(coalesce(tax_id, ''), '\D', '', 'g') = v_tax_digits
      LIMIT 1;

      IF v_found_company IS NOT NULL THEN
        SELECT EXISTS (
          SELECT 1 FROM public.profiles
          WHERE company_id = v_found_company
            AND auth_user_id IS NOT NULL
            AND id <> v_profile_id
        ) INTO v_has_claimed;

        IF v_has_claimed THEN
          RAISE EXCEPTION 'cnpj_already_claimed';
        END IF;

        SELECT
          COUNT(*) > 0,
          bool_or(lower(coalesce(email::text,'')) = lower(coalesce(v_current_email,''))),
          bool_or(lower(coalesce(email::text,'')) <> lower(coalesce(v_current_email,'')))
        INTO v_has_pending, v_has_pending_same_email, v_has_pending_other_email
        FROM public.profiles
        WHERE company_id = v_found_company
          AND auth_user_id IS NULL
          AND id <> v_profile_id;

        v_has_pending := COALESCE(v_has_pending, false);
        v_has_pending_same_email := COALESCE(v_has_pending_same_email, false);
        v_has_pending_other_email := COALESCE(v_has_pending_other_email, false);

        IF v_has_pending AND NOT v_has_pending_same_email AND v_has_pending_other_email THEN
          v_extra_reasons := v_extra_reasons || ARRAY['cnpj_pre_reg_email_mismatch']::text[];
        END IF;

        v_company_id := v_found_company;
        v_reused_company := true;

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
    END IF;
  END IF;

  IF v_company_id IS NULL THEN
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
  END IF;

  IF array_length(v_extra_reasons, 1) > 0 THEN
    SELECT COALESCE(review_reasons, ARRAY[]::text[]) INTO v_existing_reasons
    FROM public.profiles WHERE id = v_profile_id;

    SELECT ARRAY(SELECT DISTINCT x FROM unnest(v_existing_reasons || v_extra_reasons) AS x WHERE x IS NOT NULL AND x <> '')
    INTO v_merged_reasons;

    UPDATE public.profiles
    SET review_status = 'needs_review',
        review_reasons = v_merged_reasons,
        review_created_at = COALESCE(review_created_at, now()),
        review_payload = jsonb_build_object(
          'source', 'complete_buyer_signup',
          'submitted', p_payload,
          'quality', v_quality,
          'reused_company_id', CASE WHEN v_reused_company THEN v_company_id ELSE NULL END
        )
    WHERE id = v_profile_id;
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
    consent_data_sharing, consent_marketing, signup_completed_at,
    networking_lunch_participation, image_authorization
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
    v_lunch,
    v_image_auth
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
    image_authorization = EXCLUDED.image_authorization,
    signup_completed_at = COALESCE(public.visitor_profiles.signup_completed_at, EXCLUDED.signup_completed_at);

  RETURN v_company_id;
END $function$;