
-- 1) Reconciliar duplicidades (table_id, slot_id) com status='scheduled'.
--    Mantém a mais antiga (created_at asc); cancela as demais.
WITH ranked AS (
  SELECT
    m.id,
    m.event_id,
    m.table_id,
    m.slot_id,
    m.visitor_profile_id,
    m.created_at,
    row_number() OVER (
      PARTITION BY m.table_id, m.slot_id
      ORDER BY m.created_at ASC, m.id ASC
    ) AS rn,
    first_value(m.id) OVER (
      PARTITION BY m.table_id, m.slot_id
      ORDER BY m.created_at ASC, m.id ASC
    ) AS keep_id
  FROM public.meetings m
  WHERE m.status = 'scheduled'
),
losers AS (
  SELECT * FROM ranked WHERE rn > 1
),
cancelled AS (
  UPDATE public.meetings m
     SET status = 'cancelled',
         cancel_reason = 'admin_dedupe_table_slot'
    FROM losers l
   WHERE m.id = l.id
   RETURNING m.id, m.event_id, m.table_id, m.slot_id, m.visitor_profile_id,
             l.keep_id
),
audit_insert AS (
  INSERT INTO public.audit_logs (event_id, actor_profile_id, action, payload)
  SELECT
    c.event_id,
    NULL,
    'meeting.deduped_table_slot',
    jsonb_build_object(
      'meeting_id', c.id,
      'kept_meeting_id', c.keep_id,
      'table_id', c.table_id,
      'slot_id', c.slot_id,
      'visitor_profile_id', c.visitor_profile_id,
      'reason', 'admin_dedupe_table_slot'
    )
  FROM cancelled c
  RETURNING 1
),
notif_visitor AS (
  INSERT INTO public.notifications
    (event_id, recipient_profile_id, type, channel, status, title, body, data)
  SELECT
    c.event_id,
    c.visitor_profile_id,
    'meeting_cancelled',
    'in_app',
    'sent',
    'Reunião cancelada',
    'Sua reunião foi cancelada por conflito operacional (mesa duplicada). Você pode reagendar em outro horário.',
    jsonb_build_object(
      'meeting_id', c.id,
      'table_id', c.table_id,
      'slot_id', c.slot_id,
      'reason', 'admin_dedupe_table_slot'
    )
  FROM cancelled c
  RETURNING 1
),
notif_exhibitor AS (
  INSERT INTO public.notifications
    (event_id, recipient_profile_id, type, channel, status, title, body, data)
  SELECT
    c.event_id,
    et.exhibitor_profile_id,
    'meeting_cancelled',
    'in_app',
    'sent',
    'Reunião cancelada',
    'Uma reunião da sua mesa foi cancelada por conflito operacional (mesa duplicada).',
    jsonb_build_object(
      'meeting_id', c.id,
      'table_id', c.table_id,
      'slot_id', c.slot_id,
      'reason', 'admin_dedupe_table_slot'
    )
  FROM cancelled c
  JOIN public.event_tables et ON et.id = c.table_id
  WHERE et.exhibitor_profile_id IS NOT NULL
  RETURNING 1
)
SELECT count(*) FROM cancelled;

-- 2) Trava definitiva: no máximo 1 reunião ativa por (table_id, slot_id).
CREATE UNIQUE INDEX IF NOT EXISTS uq_meetings_table_slot_scheduled
  ON public.meetings (table_id, slot_id)
  WHERE status = 'scheduled';
