CREATE TABLE IF NOT EXISTS public.email_template_overrides (
  template_name text PRIMARY KEY,
  from_name     text,
  subject_pt    text,
  subject_es    text,
  greeting_pt   text,
  greeting_es   text,
  intro_pt      text,
  intro_es      text,
  outro_pt      text,
  outro_es      text,
  cta_label_pt  text,
  cta_label_es  text,
  signature_pt  text,
  signature_es  text,
  updated_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_template_overrides TO authenticated;
GRANT ALL ON public.email_template_overrides TO service_role;

ALTER TABLE public.email_template_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/staff can read email template overrides"
  ON public.email_template_overrides FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE POLICY "Admin/staff can insert email template overrides"
  ON public.email_template_overrides FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE POLICY "Admin/staff can update email template overrides"
  ON public.email_template_overrides FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE POLICY "Admin/staff can delete email template overrides"
  ON public.email_template_overrides FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));