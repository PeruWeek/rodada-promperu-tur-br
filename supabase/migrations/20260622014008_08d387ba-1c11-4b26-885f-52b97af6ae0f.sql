CREATE OR REPLACE FUNCTION public.pre_reg_match_quality(p_email text, p_tax_id text DEFAULT NULL::text, p_country_code text DEFAULT NULL::text, p_trade_name text DEFAULT NULL::text, p_legal_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_email_count int := 0;
  v_email_candidates uuid[] := '{}';
  v_email_match_id uuid;
  v_tax_count int := 0;
  v_tax_candidates uuid[] := '{}';
  v_reasons text[] := '{}';
  v_unique boolean := true;
  v_pre_tax_id text;
  v_pre_country text;
  v_pre_trade text;
  v_pre_legal text;
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

  IF v_email_match_id IS NOT NULL THEN
    SELECT c.tax_id, c.country_code, c.trade_name, c.legal_name
      INTO v_pre_tax_id, v_pre_country, v_pre_trade, v_pre_legal
    FROM public.profiles p
    LEFT JOIN public.companies c ON c.id = p.company_id
    WHERE p.id = v_email_match_id;

    IF v_tax_norm IS NOT NULL AND v_pre_tax_id IS NOT NULL
       AND v_pre_tax_id <> v_tax_norm THEN
      v_unique := false;
      v_reasons := v_reasons || 'dados_divergentes';
    END IF;

    IF v_country IS NOT NULL AND v_pre_country IS NOT NULL
       AND upper(v_pre_country) <> v_country THEN
      v_unique := false;
      IF NOT ('dados_divergentes' = ANY(v_reasons)) THEN
        v_reasons := v_reasons || 'dados_divergentes';
      END IF;
    END IF;

    IF p_trade_name IS NOT NULL OR p_legal_name IS NOT NULL THEN
      DECLARE
        v_sim_trade numeric := 0;
        v_sim_legal numeric := 0;
      BEGIN
        IF p_trade_name IS NOT NULL AND coalesce(v_pre_trade,'') <> '' THEN
          v_sim_trade := similarity(lower(btrim(p_trade_name)), lower(btrim(v_pre_trade)));
        END IF;
        IF p_legal_name IS NOT NULL AND coalesce(v_pre_legal,'') <> '' THEN
          v_sim_legal := similarity(lower(btrim(p_legal_name)), lower(btrim(v_pre_legal)));
        END IF;
        IF v_sim_trade < 0.80 AND v_sim_legal < 0.80
           AND (p_trade_name IS NOT NULL OR p_legal_name IS NOT NULL)
           AND (coalesce(v_pre_trade,'') <> '' OR coalesce(v_pre_legal,'') <> '') THEN
          v_unique := false;
          IF NOT ('dados_divergentes' = ANY(v_reasons)) THEN
            v_reasons := v_reasons || 'dados_divergentes';
          END IF;
        END IF;
      END;
    END IF;
  END IF;

  -- Critical missing data: BR company with no tax_id anywhere.
  -- Use the scalar v_pre_tax_id (NULL when no pre-registration matched),
  -- which avoids the "record not assigned yet" failure that used to abort
  -- the whole RPC for fresh signups with no pre-registration.
  IF v_country = 'BR' AND v_tax_norm IS NULL
     AND (v_pre_tax_id IS NULL OR v_pre_tax_id = '') THEN
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
END $function$;