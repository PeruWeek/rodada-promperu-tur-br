
-- Audit logging: triggers + helper
CREATE OR REPLACE FUNCTION public.log_audit(p_action text, p_payload jsonb, p_event_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid;
BEGIN
  SELECT id INTO v_actor FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;
  INSERT INTO public.audit_logs (event_id, actor_profile_id, action, payload)
  VALUES (p_event_id, v_actor, p_action, COALESCE(p_payload, '{}'::jsonb));
END $$;

-- companies
CREATE OR REPLACE FUNCTION public.trg_audit_companies() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit('company.created', jsonb_build_object(
      'company_id', NEW.id, 'trade_name', NEW.trade_name,
      'country_code', NEW.country_code, 'city', NEW.city));
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.log_audit('company.deleted', jsonb_build_object(
      'company_id', OLD.id, 'trade_name', OLD.trade_name));
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS audit_companies_ins ON public.companies;
DROP TRIGGER IF EXISTS audit_companies_del ON public.companies;
CREATE TRIGGER audit_companies_ins AFTER INSERT ON public.companies FOR EACH ROW EXECUTE FUNCTION public.trg_audit_companies();
CREATE TRIGGER audit_companies_del AFTER DELETE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.trg_audit_companies();

-- profiles (linking to company / role-relevant fields)
CREATE OR REPLACE FUNCTION public.trg_audit_profiles() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit('profile.created', jsonb_build_object(
      'profile_id', NEW.id, 'email', NEW.email, 'full_name', NEW.full_name,
      'company_id', NEW.company_id));
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
      PERFORM public.log_audit('profile.company_linked', jsonb_build_object(
        'profile_id', NEW.id, 'email', NEW.email,
        'old_company_id', OLD.company_id, 'new_company_id', NEW.company_id));
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS audit_profiles_iu ON public.profiles;
CREATE TRIGGER audit_profiles_iu AFTER INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.trg_audit_profiles();

-- user_roles
CREATE OR REPLACE FUNCTION public.trg_audit_user_roles() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_email text;
BEGIN
  SELECT email INTO v_email FROM public.profiles WHERE auth_user_id = COALESCE(NEW.user_id, OLD.user_id);
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit('role.assigned', jsonb_build_object('user_id', NEW.user_id, 'email', v_email, 'role', NEW.role));
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.log_audit('role.removed', jsonb_build_object('user_id', OLD.user_id, 'email', v_email, 'role', OLD.role));
  ELSIF TG_OP = 'UPDATE' AND NEW.role IS DISTINCT FROM OLD.role THEN
    PERFORM public.log_audit('role.changed', jsonb_build_object('user_id', NEW.user_id, 'email', v_email, 'old_role', OLD.role, 'new_role', NEW.role));
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS audit_user_roles ON public.user_roles;
CREATE TRIGGER audit_user_roles AFTER INSERT OR UPDATE OR DELETE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.trg_audit_user_roles();

-- pipeline status / responsible
CREATE OR REPLACE FUNCTION public.trg_audit_pipeline() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit('pipeline.created', jsonb_build_object(
      'company_id', NEW.company_id, 'registration_status', NEW.registration_status), NEW.event_id);
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.registration_status IS DISTINCT FROM OLD.registration_status THEN
      PERFORM public.log_audit('pipeline.registration_status', jsonb_build_object(
        'company_id', NEW.company_id, 'old', OLD.registration_status, 'new', NEW.registration_status), NEW.event_id);
    END IF;
    IF NEW.scheduling_status IS DISTINCT FROM OLD.scheduling_status THEN
      PERFORM public.log_audit('pipeline.scheduling_status', jsonb_build_object(
        'company_id', NEW.company_id, 'old', OLD.scheduling_status, 'new', NEW.scheduling_status), NEW.event_id);
    END IF;
    IF NEW.owner_staff_profile_id IS DISTINCT FROM OLD.owner_staff_profile_id THEN
      PERFORM public.log_audit('pipeline.owner_changed', jsonb_build_object(
        'company_id', NEW.company_id, 'old_owner', OLD.owner_staff_profile_id, 'new_owner', NEW.owner_staff_profile_id), NEW.event_id);
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS audit_pipeline ON public.company_event_pipeline;
CREATE TRIGGER audit_pipeline AFTER INSERT OR UPDATE ON public.company_event_pipeline FOR EACH ROW EXECUTE FUNCTION public.trg_audit_pipeline();

-- exhibitor_requests status changes
CREATE OR REPLACE FUNCTION public.trg_audit_exh_req() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit('exhibitor_request.created', jsonb_build_object(
      'profile_id', NEW.profile_id, 'status', NEW.status));
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.log_audit('exhibitor_request.reviewed', jsonb_build_object(
      'profile_id', NEW.profile_id, 'old', OLD.status, 'new', NEW.status));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS audit_exh_req ON public.exhibitor_requests;
CREATE TRIGGER audit_exh_req AFTER INSERT OR UPDATE ON public.exhibitor_requests FOR EACH ROW EXECUTE FUNCTION public.trg_audit_exh_req();
