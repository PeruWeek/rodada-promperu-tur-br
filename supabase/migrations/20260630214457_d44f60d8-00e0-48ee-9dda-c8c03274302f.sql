
-- 1) Trigger function: recalc both old and new company when profiles.company_id changes
CREATE OR REPLACE FUNCTION public.trg_profiles_company_change_recalc()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ev_id uuid;
BEGIN
  -- Only act on real company_id transitions
  IF TG_OP = 'UPDATE' AND NEW.company_id IS NOT DISTINCT FROM OLD.company_id THEN
    RETURN NEW;
  END IF;

  -- Clear stale primary_profile_id on the old company's pipeline rows so
  -- the consolidated/badge stops attributing this contact to the old company.
  IF TG_OP = 'UPDATE' AND OLD.company_id IS NOT NULL THEN
    UPDATE public.company_event_pipeline
       SET primary_profile_id = NULL,
           updated_at = now()
     WHERE company_id = OLD.company_id
       AND primary_profile_id = OLD.id;

    -- Recalc scheduling_status for every event where the old company has a pipeline row
    FOR ev_id IN
      SELECT event_id FROM public.company_event_pipeline WHERE company_id = OLD.company_id
    LOOP
      PERFORM public.pipeline_recalc_scheduling(ev_id, OLD.company_id);
    END LOOP;
  END IF;

  -- Recalc scheduling_status for the new company too
  IF NEW.company_id IS NOT NULL THEN
    FOR ev_id IN
      SELECT event_id FROM public.company_event_pipeline WHERE company_id = NEW.company_id
    LOOP
      PERFORM public.pipeline_recalc_scheduling(ev_id, NEW.company_id);
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_company_change_recalc ON public.profiles;
CREATE TRIGGER trg_profiles_company_change_recalc
AFTER UPDATE OF company_id ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.trg_profiles_company_change_recalc();

-- 2) Also recalc when a meeting is inserted/updated/cancelled, so consolidated
--    scheduling_status never drifts (defense in depth for moves + bookings).
CREATE OR REPLACE FUNCTION public.trg_meetings_recalc_company_scheduling()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visitor_company uuid;
  v_exhibitor_company uuid;
  v_event uuid;
BEGIN
  v_event := COALESCE(NEW.event_id, OLD.event_id);
  IF v_event IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  -- Recalc visitor side (current company of visitor profile)
  IF NEW IS NOT NULL THEN
    SELECT p.company_id INTO v_visitor_company
      FROM public.profiles p WHERE p.id = NEW.visitor_profile_id;
    IF v_visitor_company IS NOT NULL THEN
      PERFORM public.pipeline_recalc_scheduling(v_event, v_visitor_company);
    END IF;
    SELECT p.company_id INTO v_exhibitor_company
      FROM public.event_tables et
      JOIN public.profiles p ON p.id = et.exhibitor_profile_id
     WHERE et.id = NEW.table_id;
    IF v_exhibitor_company IS NOT NULL THEN
      PERFORM public.pipeline_recalc_scheduling(v_event, v_exhibitor_company);
    END IF;
  END IF;

  IF TG_OP IN ('UPDATE','DELETE') AND OLD IS NOT NULL THEN
    SELECT p.company_id INTO v_visitor_company
      FROM public.profiles p WHERE p.id = OLD.visitor_profile_id;
    IF v_visitor_company IS NOT NULL THEN
      PERFORM public.pipeline_recalc_scheduling(v_event, v_visitor_company);
    END IF;
    SELECT p.company_id INTO v_exhibitor_company
      FROM public.event_tables et
      JOIN public.profiles p ON p.id = et.exhibitor_profile_id
     WHERE et.id = OLD.table_id;
    IF v_exhibitor_company IS NOT NULL THEN
      PERFORM public.pipeline_recalc_scheduling(v_event, v_exhibitor_company);
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_meetings_recalc_company_scheduling ON public.meetings;
CREATE TRIGGER trg_meetings_recalc_company_scheduling
AFTER INSERT OR UPDATE OR DELETE ON public.meetings
FOR EACH ROW
EXECUTE FUNCTION public.trg_meetings_recalc_company_scheduling();

-- 3) Backfill: clear stale primary_profile_id pointing to a profile whose
--    company_id no longer matches the pipeline row.
UPDATE public.company_event_pipeline cep
   SET primary_profile_id = NULL,
       updated_at = now()
  FROM public.profiles p
 WHERE cep.primary_profile_id = p.id
   AND (p.company_id IS NULL OR p.company_id <> cep.company_id);

-- 4) Backfill: recalc scheduling_status for every pipeline row to flush stale state.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT event_id, company_id FROM public.company_event_pipeline LOOP
    PERFORM public.pipeline_recalc_scheduling(r.event_id, r.company_id);
  END LOOP;
END $$;
