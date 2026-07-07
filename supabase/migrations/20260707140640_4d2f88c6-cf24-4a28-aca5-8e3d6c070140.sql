
CREATE TABLE public.visitor_cancellation_settings (
  id smallint PRIMARY KEY DEFAULT 1,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT visitor_cancellation_settings_singleton CHECK (id = 1)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.visitor_cancellation_settings TO authenticated;
GRANT ALL ON public.visitor_cancellation_settings TO service_role;

ALTER TABLE public.visitor_cancellation_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage visitor cancellation settings"
  ON public.visitor_cancellation_settings
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.visitor_cancellation_settings (id, enabled) VALUES (1, false)
  ON CONFLICT (id) DO NOTHING;
