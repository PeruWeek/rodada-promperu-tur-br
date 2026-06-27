ALTER TABLE public.booking_reminder_settings
  ADD COLUMN last_manual_run_at timestamp with time zone,
  ADD COLUMN last_manual_run_summary jsonb;

GRANT SELECT, UPDATE ON public.booking_reminder_settings TO authenticated;
GRANT ALL ON public.booking_reminder_settings TO service_role;