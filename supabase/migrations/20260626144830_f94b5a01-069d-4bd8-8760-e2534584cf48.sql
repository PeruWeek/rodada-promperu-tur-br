
ALTER TABLE public.booking_reminder_log
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS mode text,
  ADD COLUMN IF NOT EXISTS language text,
  ADD COLUMN IF NOT EXISTS error_reason text,
  ADD COLUMN IF NOT EXISTS skip_reason text;

CREATE INDEX IF NOT EXISTS booking_reminder_log_event_status_idx
  ON public.booking_reminder_log (event_id, status, sent_at DESC);
CREATE INDEX IF NOT EXISTS booking_reminder_log_profile_event_idx
  ON public.booking_reminder_log (profile_id, event_id, status);
