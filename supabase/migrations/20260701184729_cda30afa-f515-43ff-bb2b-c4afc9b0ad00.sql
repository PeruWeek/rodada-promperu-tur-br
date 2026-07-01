
WITH ranked AS (
  SELECT m.id, m.table_id, m.slot_id, p.company_id,
         row_number() OVER (PARTITION BY m.table_id, m.slot_id
                            ORDER BY m.created_at ASC, m.id ASC) AS rn
  FROM public.meetings m
  JOIN public.profiles p ON p.id = m.visitor_profile_id
  WHERE m.status = 'scheduled'
),
distinct_counts AS (
  SELECT table_id, slot_id, count(DISTINCT company_id) AS dc
  FROM ranked GROUP BY table_id, slot_id
),
to_cancel AS (
  SELECT r.id FROM ranked r JOIN distinct_counts d USING (table_id, slot_id)
  WHERE r.rn > 1 AND d.dc > 1
),
cancelled AS (
  UPDATE public.meetings
  SET status = 'cancelled',
      cancel_reason = 'auto-sanitize:duplicate_table_slot_different_company_v2'
  WHERE id IN (SELECT id FROM to_cancel)
  RETURNING id, table_id, slot_id, event_id
)
INSERT INTO public.audit_logs (event_id, actor_profile_id, action, payload)
SELECT event_id, NULL, 'sanitize_meeting_conflict_v2',
       jsonb_build_object(
         'meeting_id', id,
         'table_id', table_id,
         'slot_id', slot_id,
         'reason', 'duplicate_table_slot_different_company_v2'
       )
FROM cancelled;

CREATE OR REPLACE FUNCTION public.enforce_meeting_no_conflict()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_new_company uuid;
  v_conflict_id uuid;
  v_other_company uuid;
BEGIN
  IF new.status <> 'scheduled' THEN RETURN new; END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(new.table_id::text || ':' || new.slot_id::text)
  );

  SELECT p.company_id INTO v_new_company
  FROM public.profiles p WHERE p.id = new.visitor_profile_id;

  SELECT m.id, p.company_id INTO v_conflict_id, v_other_company
  FROM public.meetings m
  JOIN public.profiles p ON p.id = m.visitor_profile_id
  WHERE m.table_id = new.table_id
    AND m.slot_id = new.slot_id
    AND m.status = 'scheduled'
    AND (tg_op = 'INSERT' OR m.id <> new.id)
  LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    IF v_new_company IS NULL OR v_other_company IS NULL OR v_other_company <> v_new_company THEN
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
