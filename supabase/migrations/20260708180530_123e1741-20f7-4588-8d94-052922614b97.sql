CREATE TABLE public.signup_settings (
  id smallint PRIMARY KEY DEFAULT 1,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT signup_settings_singleton CHECK (id = 1)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.signup_settings TO authenticated;
GRANT ALL ON public.signup_settings TO service_role;

ALTER TABLE public.signup_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage signup settings"
  ON public.signup_settings
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.signup_settings (id, enabled) VALUES (1, true)
  ON CONFLICT (id) DO NOTHING;