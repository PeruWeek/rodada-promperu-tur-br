
-- 1) HARDENING: enforce_meeting_no_conflict com SECURITY DEFINER.
-- Sem SECURITY DEFINER a função roda com o role invocador e o SELECT interno
-- é filtrado por RLS de meetings, deixando entrar conflitos "1 slot = 1 empresa".
CREATE OR REPLACE FUNCTION public.enforce_meeting_no_conflict()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

-- 2) VIEW: scheduled_meetings_count por pares (table_id, slot_id) DISTINTOS
--    somente no ramo exhibitor. Ramo visitor permanece count(*) inalterado.
CREATE OR REPLACE VIEW public.v_company_event_pipeline AS
 SELECT cep.id,
    cep.event_id,
    cep.company_id,
    cep.primary_profile_id,
    cep.owner_staff_profile_id,
    cep.company_role,
    cep.company_type,
    cep.company_category,
    cep.country_code,
    cep.state_code,
    cep.city,
    cep.region_label,
    cep.registration_status,
    cep.scheduling_status,
    cep.next_action,
    cep.next_action_due_at,
    cep.priority,
    cep.notes,
    cep.last_contact_at,
    cep.last_contact_channel,
    cep.is_profile_complete,
    cep.created_at,
    cep.updated_at,
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
    ( SELECT
        CASE cep.company_role
          WHEN 'exhibitor'::pipeline_company_role THEN (
            SELECT count(*) FROM (
              SELECT DISTINCT m.table_id, m.slot_id
                FROM public.meetings m
               WHERE m.event_id = cep.event_id
                 AND m.status = 'scheduled'::meeting_status
                 AND m.table_id IN (
                   SELECT et.id
                     FROM public.event_tables et
                     JOIN public.profiles p2 ON p2.id = et.exhibitor_profile_id
                    WHERE p2.company_id = cep.company_id
                 )
            ) d
          )
          WHEN 'visitor'::pipeline_company_role THEN (
            SELECT count(*)
              FROM public.meetings m
             WHERE m.event_id = cep.event_id
               AND m.status = 'scheduled'::meeting_status
               AND m.visitor_profile_id IN (
                 SELECT profiles.id FROM public.profiles
                  WHERE profiles.company_id = cep.company_id
               )
          )
          ELSE 0
        END
    ) AS scheduled_meetings_count,
    (EXISTS ( SELECT 1
           FROM exhibitor_requests er
          WHERE er.profile_id = cep.primary_profile_id AND er.status = 'pending'::text)) AS has_pending_exhibitor_request
   FROM company_event_pipeline cep
     LEFT JOIN companies co ON co.id = cep.company_id
     LEFT JOIN profiles pp ON pp.id = cep.primary_profile_id
     LEFT JOIN profiles op ON op.id = cep.owner_staff_profile_id
     LEFT JOIN visitor_profiles vp ON vp.profile_id = cep.primary_profile_id
     LEFT JOIN exhibitor_profiles ep ON ep.profile_id = cep.primary_profile_id;

-- 3) CLEANUP DO INCIDENTE — escopado por event_id + status='scheduled',
--    preserva a empresa vencedora (mais antiga), auditado e idempotente.
WITH scoped AS (
  SELECT m.id, m.table_id, m.slot_id, m.created_at, p.company_id
    FROM public.meetings m
    JOIN public.profiles p ON p.id = m.visitor_profile_id
   WHERE m.event_id = 'd86be1b5-857e-44c4-9d69-1f4f4d8b1bdb'
     AND m.status   = 'scheduled'
),
winners AS (
  SELECT DISTINCT ON (table_id, slot_id)
         table_id, slot_id, company_id AS winner_company_id
    FROM scoped
   WHERE company_id IS NOT NULL
   ORDER BY table_id, slot_id, created_at ASC
),
losers AS (
  SELECT s.id, s.table_id, s.slot_id
    FROM scoped s
    JOIN winners w
      ON w.table_id = s.table_id
     AND w.slot_id  = s.slot_id
   WHERE (s.company_id IS DISTINCT FROM w.winner_company_id)
     AND EXISTS (
       SELECT 1 FROM scoped s2
        WHERE s2.table_id = s.table_id
          AND s2.slot_id  = s.slot_id
          AND s2.company_id IS DISTINCT FROM w.winner_company_id
     )
),
cancelled AS (
  UPDATE public.meetings m
     SET status        = 'cancelled',
         cancel_reason = 'data cleanup: slot ja ocupado por outra empresa (incidente 2026-07-03)'
    FROM losers l
   WHERE m.id       = l.id
     AND m.event_id = 'd86be1b5-857e-44c4-9d69-1f4f4d8b1bdb'
     AND m.status   = 'scheduled'
  RETURNING m.id, m.event_id, m.table_id, m.slot_id, m.visitor_profile_id
)
INSERT INTO public.audit_logs (action, actor_profile_id, event_id, payload)
SELECT
  'meeting.cleanup_cancelled',
  NULL,
  c.event_id,
  jsonb_build_object(
    'meeting_id',         c.id,
    'table_id',           c.table_id,
    'slot_id',            c.slot_id,
    'visitor_profile_id', c.visitor_profile_id,
    'incident',           '1-slot-1-empresa 2026-07-03',
    'source',             'migration hardening_1_slot_1_empresa'
  )
FROM cancelled c;
