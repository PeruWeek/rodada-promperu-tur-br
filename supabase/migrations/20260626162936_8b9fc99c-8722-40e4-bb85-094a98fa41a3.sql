ALTER TABLE public.booking_reminder_log
ADD COLUMN IF NOT EXISTS run_id uuid;

CREATE INDEX IF NOT EXISTS booking_reminder_log_run_id_idx
ON public.booking_reminder_log (run_id);

CREATE INDEX IF NOT EXISTS booking_reminder_log_run_id_sent_at_idx
ON public.booking_reminder_log (run_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS booking_reminder_log_mode_status_sent_at_idx
ON public.booking_reminder_log (mode, status, sent_at DESC);