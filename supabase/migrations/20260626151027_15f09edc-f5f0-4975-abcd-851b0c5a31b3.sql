-- Backfill existing booking_reminder_log rows that predate the `mode` column,
-- and set a default so future inserts always carry a mode value.
UPDATE public.booking_reminder_log SET mode = 'auto' WHERE mode IS NULL;
ALTER TABLE public.booking_reminder_log ALTER COLUMN mode SET DEFAULT 'auto';
-- Index helps the history listing filter by mode efficiently.
CREATE INDEX IF NOT EXISTS booking_reminder_log_mode_sent_at_idx
  ON public.booking_reminder_log (mode, sent_at DESC);