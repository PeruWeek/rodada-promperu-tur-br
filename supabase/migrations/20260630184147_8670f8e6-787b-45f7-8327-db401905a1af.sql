CREATE OR REPLACE FUNCTION public.enforce_visitor_signup_completion_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_profile record;
  v_company record;
BEGIN
  -- Quando o registro está sendo PROMOVIDO para completo:
  IF NEW.signup_completed_at IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.signup_completed_at IS NULL) THEN

    -- Operacionais / consentimentos
    IF NEW.networking_lunch_participation IS NULL THEN
      RAISE EXCEPTION 'networking_lunch_participation_required'
        USING HINT = 'Visitor signup cannot be completed without networking_lunch_participation.';
    END IF;
    IF NEW.image_authorization IS NULL THEN
      RAISE EXCEPTION 'image_authorization_required'
        USING HINT = 'Visitor signup cannot be completed without image_authorization.';
    END IF;
    IF NEW.consent_data_sharing IS NOT TRUE THEN
      RAISE EXCEPTION 'consent_data_sharing_required'
        USING HINT = 'Visitor signup requires consent_data_sharing = true.';
    END IF;

    -- Contato (profile)
    SELECT id, company_id, full_name, job_title, whatsapp, preferred_language
      INTO v_profile
      FROM public.profiles
     WHERE id = NEW.profile_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'profile_not_found_for_visitor_completion';
    END IF;
    IF coalesce(btrim(v_profile.full_name), '') = '' THEN
      RAISE EXCEPTION 'full_name_required';
    END IF;
    IF coalesce(btrim(v_profile.job_title), '') = '' THEN
      RAISE EXCEPTION 'job_title_required';
    END IF;
    IF coalesce(btrim(v_profile.whatsapp), '') = '' THEN
      RAISE EXCEPTION 'whatsapp_required';
    END IF;

    -- Empresa
    IF v_profile.company_id IS NULL THEN
      RAISE EXCEPTION 'company_required';
    END IF;
    SELECT trade_name, city, state_code, tax_id
      INTO v_company
      FROM public.companies
     WHERE id = v_profile.company_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'company_not_found_for_visitor_completion';
    END IF;
    IF coalesce(btrim(v_company.trade_name), '') = '' THEN
      RAISE EXCEPTION 'trade_name_required';
    END IF;
    IF coalesce(btrim(v_company.city), '') = '' THEN
      RAISE EXCEPTION 'city_required';
    END IF;
    IF coalesce(btrim(v_company.state_code), '') = '' THEN
      RAISE EXCEPTION 'state_code_required';
    END IF;
    IF regexp_replace(coalesce(v_company.tax_id, ''), '\\D', '', 'g') = '' THEN
      RAISE EXCEPTION 'tax_id_required';
    END IF;
  END IF;

  -- Defesa em profundidade: depois de completo, não permitir apagar campos
  -- já preenchidos nem desfazer signup_completed_at.
  IF TG_OP = 'UPDATE'
     AND OLD.signup_completed_at IS NOT NULL THEN
    IF OLD.networking_lunch_participation IS NOT NULL
       AND NEW.networking_lunch_participation IS NULL THEN
      RAISE EXCEPTION 'networking_lunch_participation_cannot_be_cleared';
    END IF;
    IF OLD.image_authorization IS NOT NULL
       AND NEW.image_authorization IS NULL THEN
      RAISE EXCEPTION 'image_authorization_cannot_be_cleared';
    END IF;
    IF NEW.signup_completed_at IS NULL THEN
      RAISE EXCEPTION 'signup_completed_at_cannot_be_cleared';
    END IF;
    IF NEW.consent_data_sharing IS NOT TRUE THEN
      RAISE EXCEPTION 'consent_data_sharing_cannot_be_cleared';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;