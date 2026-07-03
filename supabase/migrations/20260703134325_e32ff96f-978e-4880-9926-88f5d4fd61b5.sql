-- Allow multiple attendees of the SAME company to share the SAME
-- (table_id, slot_id). The trigger still blocks the same company from
-- occupying DIFFERENT tables at the same start/end window.
CREATE OR REPLACE FUNCTION public.enforce_one_company_per_slot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid;
  v_start   timestamptz;
  v_end     timestamptz;
  v_clash   uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status             = OLD.status
     AND NEW.event_id           = OLD.event_id
     AND NEW.slot_id            = OLD.slot_id
     AND NEW.visitor_profile_id = OLD.visitor_profile_id
  THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM 'scheduled' THEN
    RETURN NEW;
  END IF;

  SELECT company_id INTO v_company FROM public.profiles WHERE id = NEW.visitor_profile_id;
  IF v_company IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT start_at, end_at INTO v_start, v_end
  FROM public.time_slots WHERE id = NEW.slot_id;

  SELECT m.id INTO v_clash
  FROM public.meetings m
  JOIN public.profiles   p  ON p.id  = m.visitor_profile_id
  JOIN public.time_slots ts ON ts.id = m.slot_id
  WHERE m.event_id   = NEW.event_id
    AND m.status     = 'scheduled'
    AND m.id        <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND p.company_id = v_company
    AND ts.start_at  = v_start
    AND ts.end_at    = v_end
    -- Allow the same company at the SAME physical (table, slot):
    -- multiple reps can share one meeting spot.
    AND NOT (m.table_id = NEW.table_id AND m.slot_id = NEW.slot_id)
  LIMIT 1;

  IF v_clash IS NOT NULL THEN
    RAISE EXCEPTION 'Esta empresa já possui uma reunião agendada neste horário em outra mesa.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $function$;