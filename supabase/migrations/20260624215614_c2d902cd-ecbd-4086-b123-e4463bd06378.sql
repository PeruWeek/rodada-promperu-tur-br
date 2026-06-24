
-- 1) booking_reminder_log
CREATE TABLE public.booking_reminder_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  reminder_type TEXT NOT NULL DEFAULT 'booking-reminder',
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT booking_reminder_log_idem_key UNIQUE (idempotency_key)
);
CREATE INDEX booking_reminder_log_event_profile_idx
  ON public.booking_reminder_log (event_id, profile_id, sent_at DESC);
CREATE INDEX booking_reminder_log_sent_at_idx
  ON public.booking_reminder_log (sent_at DESC);

GRANT SELECT ON public.booking_reminder_log TO authenticated;
GRANT ALL ON public.booking_reminder_log TO service_role;

ALTER TABLE public.booking_reminder_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read booking reminder log"
  ON public.booking_reminder_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 2) booking_reminder_settings (singleton id = 1)
CREATE TABLE public.booking_reminder_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  enabled BOOLEAN NOT NULL DEFAULT false,
  run_hour INTEGER NOT NULL DEFAULT 10,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  max_reminders_per_event INTEGER NOT NULL DEFAULT 3,
  min_interval_hours INTEGER NOT NULL DEFAULT 24,
  event_scope UUID NULL REFERENCES public.events(id) ON DELETE SET NULL,
  last_run_at TIMESTAMPTZ NULL,
  last_run_summary JSONB NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID NULL,
  CONSTRAINT booking_reminder_settings_singleton CHECK (id = 1),
  CONSTRAINT booking_reminder_settings_run_hour_range CHECK (run_hour >= 0 AND run_hour <= 23),
  CONSTRAINT booking_reminder_settings_max_pos CHECK (max_reminders_per_event > 0),
  CONSTRAINT booking_reminder_settings_min_int_pos CHECK (min_interval_hours > 0)
);

GRANT SELECT ON public.booking_reminder_settings TO authenticated;
GRANT ALL ON public.booking_reminder_settings TO service_role;

ALTER TABLE public.booking_reminder_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read booking reminder settings"
  ON public.booking_reminder_settings
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.booking_reminder_settings (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;

-- 3) updated_at trigger (reuse generic function pattern)
CREATE OR REPLACE FUNCTION public.touch_booking_reminder_settings_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER booking_reminder_settings_touch
BEFORE UPDATE ON public.booking_reminder_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_booking_reminder_settings_updated_at();

-- 4) Cron: run hourly; the route itself decides if it should fire (enabled, hour-in-tz, last_run_at).
SELECT cron.unschedule('process-booking-reminders')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-booking-reminders');

SELECT cron.schedule(
  'process-booking-reminders',
  '5 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://rodada.promperu.tur.br/api/public/hooks/booking-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'email_queue_service_role_key'
      )
    ),
    body := jsonb_build_object('source', 'cron')
  );
  $cron$
);
