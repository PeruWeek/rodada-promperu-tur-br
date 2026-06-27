
-- Relax meetings same-slot-same-table conflict to allow same-company exception.
-- Two visitors from the SAME company_id may share (table_id, slot_id).
-- All other conflict rules stay: a visitor cannot have two scheduled meetings
-- on the same slot (any table), and cannot have two on the same table.

-- 1) Drop the hard unique index that forbids any two meetings on (table, slot).
DROP INDEX IF EXISTS public.meetings_unique_table_slot_scheduled;

-- 2) Rewrite the anti-conflict trigger function.
CREATE OR REPLACE FUNCTION public.enforce_meeting_no_conflict()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_new_company uuid;
  v_conflict_id uuid;
  v_other_company uuid;
BEGIN
  IF new.status <> 'scheduled' THEN RETURN new; END IF;

  -- Resolve the new meeting's visitor company (single source of truth: profiles.company_id).
  SELECT p.company_id INTO v_new_company
  FROM public.profiles p
  WHERE p.id = new.visitor_profile_id;

  -- Same-table/same-slot conflict: allowed only if BOTH visitors share the same non-null company_id.
  SELECT m.id, p.company_id INTO v_conflict_id, v_other_company
  FROM public.meetings m
  JOIN public.profiles p ON p.id = m.visitor_profile_id
  WHERE m.table_id = new.table_id
    AND m.slot_id = new.slot_id
    AND m.status = 'scheduled'
    AND (tg_op = 'INSERT' OR m.id <> new.id)
  LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    IF v_new_company IS NULL
       OR v_other_company IS NULL
       OR v_other_company <> v_new_company THEN
      RAISE EXCEPTION 'Conflito de agenda: esta mesa ja possui uma reuniao agendada neste horario com outra empresa.'
        USING errcode = '23505';
    END IF;
    -- Same company: allowed. Continue.
  END IF;

  -- Per-visitor cross-table conflict on the same slot stays blocked.
  IF EXISTS (
    SELECT 1 FROM public.meetings m
    WHERE m.visitor_profile_id = new.visitor_profile_id
      AND m.slot_id = new.slot_id
      AND m.status = 'scheduled'
      AND (tg_op = 'INSERT' OR m.id <> new.id)
  ) THEN
    RAISE EXCEPTION 'Conflito de agenda: este visitante ja possui uma reuniao agendada neste horario.'
      USING errcode = '23505';
  END IF;

  RETURN new;
END;
$$;

-- The visitor-slot unique index already prevents the same person double-booking the same slot.
-- The visitor-table unique index (uq_meetings_visitor_table_scheduled) already prevents the same
-- person booking the same table twice. Both stay in place.
