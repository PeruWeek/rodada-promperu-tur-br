
-- 1. Campaigns table
CREATE TABLE public.agenda_email_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('visitor','exhibitor')),
  subject text NOT NULL,
  body_md text NOT NULL DEFAULT '',
  button_label text NOT NULL DEFAULT 'Baixar minha agenda',
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  test_recipient text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sending','sent','failed')),
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.agenda_email_campaigns TO authenticated;
GRANT ALL ON public.agenda_email_campaigns TO service_role;

ALTER TABLE public.agenda_email_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agenda_email_campaigns admin select"
  ON public.agenda_email_campaigns FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "agenda_email_campaigns admin insert"
  ON public.agenda_email_campaigns FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "agenda_email_campaigns admin update"
  ON public.agenda_email_campaigns FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_agenda_email_campaigns_event ON public.agenda_email_campaigns(event_id);
CREATE INDEX idx_agenda_email_campaigns_created_at ON public.agenda_email_campaigns(created_at DESC);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_agenda_email_campaigns_updated_at
  BEFORE UPDATE ON public.agenda_email_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Recipients table
CREATE TABLE public.agenda_email_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.agenda_email_campaigns(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  role_category text NOT NULL CHECK (role_category IN ('visitor','exhibitor')),
  recipient_email text NOT NULL,
  subject_snapshot text NOT NULL,
  body_snapshot text NOT NULL,
  button_label_snapshot text NOT NULL,
  token_hash bytea NOT NULL,
  sent_at timestamptz,
  send_status text NOT NULL DEFAULT 'pending' CHECK (send_status IN ('pending','sent','suppressed','failed')),
  error_message text,
  clicked_at timestamptz,
  click_count integer NOT NULL DEFAULT 0,
  downloaded_at timestamptz,
  download_count integer NOT NULL DEFAULT 0,
  first_click_ip inet,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.agenda_email_campaign_recipients TO authenticated;
GRANT ALL ON public.agenda_email_campaign_recipients TO service_role;

ALTER TABLE public.agenda_email_campaign_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agenda_email_campaign_recipients admin select"
  ON public.agenda_email_campaign_recipients FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "agenda_email_campaign_recipients admin insert"
  ON public.agenda_email_campaign_recipients FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "agenda_email_campaign_recipients admin update"
  ON public.agenda_email_campaign_recipients FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_agenda_camp_recipients_campaign ON public.agenda_email_campaign_recipients(campaign_id);
CREATE INDEX idx_agenda_camp_recipients_profile_event ON public.agenda_email_campaign_recipients(profile_id, event_id);
CREATE UNIQUE INDEX ux_agenda_camp_recipients_token_hash ON public.agenda_email_campaign_recipients(token_hash);
CREATE INDEX idx_agenda_camp_recipients_role_status ON public.agenda_email_campaign_recipients(role_category, send_status);
CREATE INDEX idx_agenda_camp_recipients_camp_clicked ON public.agenda_email_campaign_recipients(campaign_id, clicked_at);
CREATE INDEX idx_agenda_camp_recipients_camp_downloaded ON public.agenda_email_campaign_recipients(campaign_id, downloaded_at);
