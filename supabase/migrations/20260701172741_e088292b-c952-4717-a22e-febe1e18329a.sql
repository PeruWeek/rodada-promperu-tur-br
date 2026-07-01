
WITH ranked AS (
  SELECT m.id::text AS id_text,
         m.id,
         m.table_id,
         m.slot_id,
         p.company_id,
         m.created_at
    FROM public.meetings m
    JOIN public.profiles p ON p.id = m.visitor_profile_id
   WHERE m.status = 'scheduled'
),
slot_stats AS (
  SELECT table_id, slot_id,
         COUNT(DISTINCT company_id) AS companies_at_slot
    FROM ranked
   GROUP BY table_id, slot_id
),
keepers AS (
  SELECT DISTINCT ON (r.table_id, r.slot_id)
         r.table_id, r.slot_id, r.id AS keep_id
    FROM ranked r
    JOIN slot_stats s USING (table_id, slot_id)
   WHERE s.companies_at_slot > 1
   ORDER BY r.table_id, r.slot_id, r.created_at ASC, r.id_text ASC
),
to_cancel AS (
  SELECT r.id
    FROM ranked r
    JOIN slot_stats s USING (table_id, slot_id)
    JOIN keepers k
      ON k.table_id = r.table_id AND k.slot_id = r.slot_id
   WHERE s.companies_at_slot > 1
     AND r.id <> k.keep_id
)
UPDATE public.meetings
   SET status = 'cancelled',
       cancel_reason = CASE
         WHEN cancel_reason IS NULL OR cancel_reason = '' THEN 'auto-sanitize:duplicate_table_slot_different_company'
         ELSE cancel_reason || ' | auto-sanitize:duplicate_table_slot_different_company'
       END
 WHERE id IN (SELECT id FROM to_cancel);

INSERT INTO public.audit_logs (actor_profile_id, action, payload)
VALUES (NULL, 'meetings.sanitize_duplicate_table_slot',
        jsonb_build_object(
          'note', 'Cancelled legacy duplicate scheduled meetings on same table/slot with different companies. Kept earliest by created_at.',
          'run_at', now()
        ));

CREATE OR REPLACE FUNCTION public.enforce_meeting_no_conflict()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_new_company uuid;
  v_conflict_id uuid;
  v_other_company uuid;
BEGIN
  IF new.status <> 'scheduled' THEN RETURN new; END IF;

  SELECT p.company_id INTO v_new_company
  FROM public.profiles p
  WHERE p.id = new.visitor_profile_id;

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
  END IF;

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
$function$;

DROP TRIGGER IF EXISTS meetings_no_conflict ON public.meetings;
DROP TRIGGER IF EXISTS trg_meetings_no_conflict ON public.meetings;
CREATE TRIGGER trg_meetings_no_conflict
  BEFORE INSERT OR UPDATE OF table_id, slot_id, visitor_profile_id, status
  ON public.meetings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_meeting_no_conflict();
