CREATE OR REPLACE FUNCTION public.enforce_one_company_per_slot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company uuid;
  v_start   timestamptz;
  v_end     timestamptz;
  v_clash   uuid;
BEGIN
  -- Short-circuit: UPDATE that doesn't touch any rule-relevant column
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
  LIMIT 1;

  IF v_clash IS NOT NULL THEN
    RAISE EXCEPTION 'Esta empresa já possui uma reunião agendada neste horário.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_meetings_one_company_per_slot ON public.meetings;
CREATE TRIGGER trg_meetings_one_company_per_slot
BEFORE INSERT OR UPDATE ON public.meetings
FOR EACH ROW EXECUTE FUNCTION public.enforce_one_company_per_slot();