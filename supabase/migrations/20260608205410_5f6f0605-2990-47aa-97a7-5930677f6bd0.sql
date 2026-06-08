
-- ============= ENUMS =============
DO $$ BEGIN
  CREATE TYPE public.pipeline_company_role AS ENUM ('exhibitor','visitor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.pipeline_registration_status AS ENUM
    ('nao_iniciado','em_preenchimento','cadastro_concluido','aguardando_aprovacao','aprovado','bloqueado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.pipeline_scheduling_status AS ENUM
    ('sem_agendamento','agendamento_iniciado','agendado_parcial','agendado_ok','agenda_fechada');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.pipeline_next_action AS ENUM
    ('nenhuma','ligar_para_confirmar','cobrar_documentos','aguardar_retorno','aprovar_cadastro','ajustar_perfil','estimular_agendamento');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.pipeline_priority AS ENUM ('baixa','media','alta');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.pipeline_company_type AS ENUM
    ('agencia','operadora','corporativo','organizadora','associacao','hotel','dmc','centro_de_convencoes','transporte','tecnologia_eventos','outro');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.pipeline_company_category AS ENUM
    ('buyer_prioritario','buyer_secundario','fornecedor_mice','hotelaria','destino','parceiro_institucional','imprensa','outro');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============= REGION LABEL HELPER =============
CREATE OR REPLACE FUNCTION public.derive_region_label(p_country text, p_state text, p_city text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE c text := upper(coalesce(p_country,'')); s text := upper(coalesce(p_state,''));
BEGIN
  IF c = '' THEN RETURN 'Internacional'; END IF;
  IF c = 'BR' THEN
    IF s IN ('SP','RJ','MG','ES') THEN RETURN 'Brasil Sudeste';
    ELSIF s IN ('RS','SC','PR') THEN RETURN 'Brasil Sul';
    ELSIF s IN ('BA','PE','CE','MA','AL','SE','PB','RN','PI') THEN RETURN 'Brasil Nordeste';
    ELSIF s IN ('AM','PA','AC','RO','RR','AP','TO') THEN RETURN 'Brasil Norte';
    ELSIF s IN ('GO','MT','MS','DF') THEN RETURN 'Brasil Centro-Oeste';
    ELSE RETURN 'Brasil';
    END IF;
  ELSIF c = 'PE' THEN
    IF s <> '' THEN RETURN 'Peru ' || initcap(lower(s)); END IF;
    RETURN 'Peru';
  ELSE
    RETURN 'Internacional';
  END IF;
END $$;

-- ============= TABLE =============
CREATE TABLE IF NOT EXISTS public.company_event_pipeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  primary_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  owner_staff_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  company_role public.pipeline_company_role NOT NULL DEFAULT 'visitor',
  company_type public.pipeline_company_type,
  company_category public.pipeline_company_category,
  country_code text,
  state_code text,
  city text,
  region_label text,
  registration_status public.pipeline_registration_status NOT NULL DEFAULT 'em_preenchimento',
  scheduling_status public.pipeline_scheduling_status NOT NULL DEFAULT 'sem_agendamento',
  next_action public.pipeline_next_action NOT NULL DEFAULT 'nenhuma',
  next_action_due_at timestamptz,
  priority public.pipeline_priority NOT NULL DEFAULT 'media',
  notes text,
  last_contact_at timestamptz,
  last_contact_channel text,
  is_profile_complete boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, company_id)
);

CREATE INDEX IF NOT EXISTS cep_event_idx ON public.company_event_pipeline(event_id);
CREATE INDEX IF NOT EXISTS cep_owner_idx ON public.company_event_pipeline(owner_staff_profile_id);
CREATE INDEX IF NOT EXISTS cep_reg_idx ON public.company_event_pipeline(registration_status);
CREATE INDEX IF NOT EXISTS cep_sch_idx ON public.company_event_pipeline(scheduling_status);
CREATE INDEX IF NOT EXISTS cep_next_idx ON public.company_event_pipeline(next_action) WHERE next_action <> 'nenhuma';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_event_pipeline TO authenticated;
GRANT ALL ON public.company_event_pipeline TO service_role;

ALTER TABLE public.company_event_pipeline ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cep select admin or staff" ON public.company_event_pipeline FOR SELECT
  USING (public.is_admin_or_staff(auth.uid()));

CREATE POLICY "cep insert admin" ON public.company_event_pipeline FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "cep update admin" ON public.company_event_pipeline FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "cep update own staff" ON public.company_event_pipeline FOR UPDATE
  USING (public.has_role(auth.uid(), 'staff'::app_role) AND owner_staff_profile_id = public.current_profile_id())
  WITH CHECK (public.has_role(auth.uid(), 'staff'::app_role) AND owner_staff_profile_id = public.current_profile_id());

CREATE POLICY "cep delete admin" ON public.company_event_pipeline FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Block staff from changing the owner
CREATE OR REPLACE FUNCTION public.cep_guard_owner_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.owner_staff_profile_id IS DISTINCT FROM OLD.owner_staff_profile_id THEN
    IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN
      RAISE EXCEPTION 'Apenas admin pode reatribuir responsável.';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cep_guard_owner ON public.company_event_pipeline;
CREATE TRIGGER trg_cep_guard_owner BEFORE UPDATE ON public.company_event_pipeline
FOR EACH ROW EXECUTE FUNCTION public.cep_guard_owner_change();

-- ============= AUTOMATION FUNCTIONS =============

-- Get the (single) active event id. Falls back to the most recent.
CREATE OR REPLACE FUNCTION public.pipeline_active_event_id()
RETURNS uuid LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT id FROM public.events ORDER BY created_at DESC LIMIT 1;
$$;

-- Compute profile completeness snapshot
CREATE OR REPLACE FUNCTION public.pipeline_compute_complete(p_company_id uuid, p_profile_id uuid, p_role public.pipeline_company_role)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v_ok boolean := false; v_co record; v_pr record;
BEGIN
  SELECT trade_name, country_code, city, state_code INTO v_co FROM public.companies WHERE id = p_company_id;
  SELECT full_name, phone, whatsapp INTO v_pr FROM public.profiles WHERE id = p_profile_id;
  IF v_co.trade_name IS NULL OR v_co.country_code IS NULL OR v_co.city IS NULL THEN RETURN false; END IF;
  IF v_pr.full_name IS NULL OR coalesce(v_pr.phone, v_pr.whatsapp, '') = '' THEN RETURN false; END IF;
  IF p_role = 'visitor' THEN
    SELECT (consent_data_sharing AND coalesce(buyer_type,'') <> '') INTO v_ok
    FROM public.visitor_profiles WHERE profile_id = p_profile_id;
    RETURN coalesce(v_ok, false);
  ELSE
    SELECT (coalesce(array_length(segments,1),0) > 0) INTO v_ok
    FROM public.exhibitor_profiles WHERE profile_id = p_profile_id;
    RETURN coalesce(v_ok, false);
  END IF;
END $$;

-- Recalc scheduling status for a given pipeline row
CREATE OR REPLACE FUNCTION public.pipeline_recalc_scheduling(p_event_id uuid, p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int := 0; v_role public.pipeline_company_role; v_target int := 6; v_status public.pipeline_scheduling_status;
BEGIN
  SELECT company_role INTO v_role FROM public.company_event_pipeline
   WHERE event_id = p_event_id AND company_id = p_company_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_role = 'visitor' THEN
    SELECT count(*) INTO v_count
      FROM public.meetings m
      JOIN public.profiles p ON p.id = m.visitor_profile_id
     WHERE m.event_id = p_event_id AND m.status = 'scheduled' AND p.company_id = p_company_id;
  ELSE
    SELECT count(*) INTO v_count
      FROM public.meetings m
      JOIN public.event_tables et ON et.id = m.table_id
      JOIN public.profiles p ON p.id = et.exhibitor_profile_id
     WHERE m.event_id = p_event_id AND m.status = 'scheduled' AND p.company_id = p_company_id;
  END IF;

  IF v_count = 0 THEN v_status := 'sem_agendamento';
  ELSIF v_count < v_target THEN v_status := 'agendado_parcial';
  ELSE v_status := 'agendado_ok';
  END IF;

  UPDATE public.company_event_pipeline
     SET scheduling_status = v_status, updated_at = now()
   WHERE event_id = p_event_id AND company_id = p_company_id
     AND scheduling_status <> 'agenda_fechada';
END $$;

-- Ensure pipeline row exists for a company in the active event
CREATE OR REPLACE FUNCTION public.pipeline_ensure_row(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event_id uuid; v_profile_id uuid; v_role public.pipeline_company_role := 'visitor';
        v_country text; v_state text; v_city text; v_complete boolean;
BEGIN
  v_event_id := public.pipeline_active_event_id();
  IF v_event_id IS NULL THEN RETURN; END IF;

  SELECT id INTO v_profile_id FROM public.profiles
   WHERE company_id = p_company_id AND auth_user_id IS NOT NULL
   ORDER BY created_at ASC LIMIT 1;

  IF v_profile_id IS NOT NULL THEN
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.profiles pr ON pr.auth_user_id = ur.user_id
                    WHERE pr.id = v_profile_id AND ur.role = 'exhibitor'::app_role) THEN 'exhibitor'::public.pipeline_company_role
      ELSE 'visitor'::public.pipeline_company_role
    END INTO v_role;
  END IF;

  SELECT country_code, state_code, city INTO v_country, v_state, v_city
    FROM public.companies WHERE id = p_company_id;

  v_complete := false;
  IF v_profile_id IS NOT NULL THEN
    v_complete := public.pipeline_compute_complete(p_company_id, v_profile_id, v_role);
  END IF;

  INSERT INTO public.company_event_pipeline
    (event_id, company_id, primary_profile_id, company_role, country_code, state_code, city, region_label,
     registration_status, is_profile_complete)
  VALUES
    (v_event_id, p_company_id, v_profile_id, v_role, v_country, v_state, v_city,
     public.derive_region_label(v_country, v_state, v_city),
     CASE WHEN v_complete THEN 'cadastro_concluido'::public.pipeline_registration_status
          ELSE 'em_preenchimento'::public.pipeline_registration_status END,
     v_complete)
  ON CONFLICT (event_id, company_id) DO UPDATE
    SET primary_profile_id = COALESCE(public.company_event_pipeline.primary_profile_id, EXCLUDED.primary_profile_id),
        company_role = EXCLUDED.company_role,
        country_code = EXCLUDED.country_code,
        state_code = EXCLUDED.state_code,
        city = EXCLUDED.city,
        region_label = EXCLUDED.region_label,
        is_profile_complete = EXCLUDED.is_profile_complete,
        updated_at = now();
END $$;

-- Trigger functions
CREATE OR REPLACE FUNCTION public.trg_pipeline_after_company()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.pipeline_ensure_row(NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pipeline_after_company_insupd ON public.companies;
CREATE TRIGGER trg_pipeline_after_company_insupd
AFTER INSERT OR UPDATE OF country_code, state_code, city ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.trg_pipeline_after_company();

CREATE OR REPLACE FUNCTION public.trg_pipeline_after_profile_company()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.company_id IS NOT NULL AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    PERFORM public.pipeline_ensure_row(NEW.company_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pipeline_after_profile_company ON public.profiles;
CREATE TRIGGER trg_pipeline_after_profile_company
AFTER UPDATE OF company_id ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.trg_pipeline_after_profile_company();

CREATE OR REPLACE FUNCTION public.trg_pipeline_after_meeting()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_visitor_company uuid; v_exh_company uuid; v_event uuid;
BEGIN
  v_event := COALESCE(NEW.event_id, OLD.event_id);
  SELECT p.company_id INTO v_visitor_company FROM public.profiles p WHERE p.id = COALESCE(NEW.visitor_profile_id, OLD.visitor_profile_id);
  IF v_visitor_company IS NOT NULL THEN
    PERFORM public.pipeline_recalc_scheduling(v_event, v_visitor_company);
  END IF;
  SELECT p.company_id INTO v_exh_company
    FROM public.event_tables et JOIN public.profiles p ON p.id = et.exhibitor_profile_id
   WHERE et.id = COALESCE(NEW.table_id, OLD.table_id);
  IF v_exh_company IS NOT NULL THEN
    PERFORM public.pipeline_recalc_scheduling(v_event, v_exh_company);
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_pipeline_after_meeting ON public.meetings;
CREATE TRIGGER trg_pipeline_after_meeting
AFTER INSERT OR UPDATE OR DELETE ON public.meetings
FOR EACH ROW EXECUTE FUNCTION public.trg_pipeline_after_meeting();

CREATE OR REPLACE FUNCTION public.trg_pipeline_after_exh_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_company uuid; v_event uuid; v_new public.pipeline_registration_status;
BEGIN
  v_event := public.pipeline_active_event_id();
  SELECT company_id INTO v_company FROM public.profiles WHERE id = NEW.profile_id;
  IF v_company IS NULL OR v_event IS NULL THEN RETURN NEW; END IF;
  IF NEW.status = 'approved' THEN v_new := 'aprovado';
  ELSIF NEW.status = 'pending' THEN v_new := 'aguardando_aprovacao';
  ELSIF NEW.status = 'rejected' THEN v_new := 'bloqueado';
  ELSE RETURN NEW; END IF;
  UPDATE public.company_event_pipeline
     SET registration_status = v_new, updated_at = now()
   WHERE event_id = v_event AND company_id = v_company;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pipeline_after_exh_request ON public.exhibitor_requests;
CREATE TRIGGER trg_pipeline_after_exh_request
AFTER INSERT OR UPDATE OF status ON public.exhibitor_requests
FOR EACH ROW EXECUTE FUNCTION public.trg_pipeline_after_exh_request();

-- ============= VIEW =============
CREATE OR REPLACE VIEW public.v_company_event_pipeline AS
SELECT
  cep.id, cep.event_id, cep.company_id, cep.primary_profile_id, cep.owner_staff_profile_id,
  cep.company_role, cep.company_type, cep.company_category,
  cep.country_code, cep.state_code, cep.city, cep.region_label,
  cep.registration_status, cep.scheduling_status, cep.next_action, cep.next_action_due_at,
  cep.priority, cep.notes, cep.last_contact_at, cep.last_contact_channel,
  cep.is_profile_complete, cep.created_at, cep.updated_at,
  co.trade_name AS company_trade_name,
  co.legal_name AS company_legal_name,
  co.specialty AS company_specialty,
  pp.full_name AS primary_contact_name,
  pp.email AS primary_contact_email,
  pp.phone AS primary_contact_phone,
  pp.whatsapp AS primary_contact_whatsapp,
  op.full_name AS owner_name,
  vp.buyer_type AS visitor_buyer_type,
  vp.interests_segments AS visitor_segments,
  vp.interests_destinations AS visitor_destinations,
  vp.interests_services AS visitor_services,
  ep.segments AS exhibitor_segments,
  ep.destinations AS exhibitor_destinations,
  ep.services AS exhibitor_services,
  (SELECT count(*) FROM public.meetings m
     WHERE m.event_id = cep.event_id AND m.status = 'scheduled'
       AND (
         (cep.company_role = 'visitor' AND m.visitor_profile_id IN (SELECT id FROM public.profiles WHERE company_id = cep.company_id))
         OR (cep.company_role = 'exhibitor' AND m.table_id IN (
              SELECT et.id FROM public.event_tables et
              JOIN public.profiles p2 ON p2.id = et.exhibitor_profile_id
              WHERE p2.company_id = cep.company_id))
       )
  ) AS scheduled_meetings_count,
  EXISTS (SELECT 1 FROM public.exhibitor_requests er
           WHERE er.profile_id = cep.primary_profile_id AND er.status = 'pending') AS has_pending_exhibitor_request
FROM public.company_event_pipeline cep
LEFT JOIN public.companies co ON co.id = cep.company_id
LEFT JOIN public.profiles pp ON pp.id = cep.primary_profile_id
LEFT JOIN public.profiles op ON op.id = cep.owner_staff_profile_id
LEFT JOIN public.visitor_profiles vp ON vp.profile_id = cep.primary_profile_id
LEFT JOIN public.exhibitor_profiles ep ON ep.profile_id = cep.primary_profile_id;

GRANT SELECT ON public.v_company_event_pipeline TO authenticated;
GRANT SELECT ON public.v_company_event_pipeline TO service_role;

-- ============= BACKFILL =============
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT id FROM public.companies LOOP
    PERFORM public.pipeline_ensure_row(r.id);
  END LOOP;
END $$;

-- Initial scheduling recalc for existing rows
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT event_id, company_id FROM public.company_event_pipeline LOOP
    PERFORM public.pipeline_recalc_scheduling(r.event_id, r.company_id);
  END LOOP;
END $$;
