UPDATE public.meetings
SET status = 'cancelled'
WHERE id = 'eddcd20f-a97d-474c-b485-63367a40447b'
  AND status = 'scheduled';

CREATE UNIQUE INDEX IF NOT EXISTS uq_meetings_visitor_table_scheduled
  ON public.meetings (visitor_profile_id, table_id)
  WHERE status = 'scheduled';
