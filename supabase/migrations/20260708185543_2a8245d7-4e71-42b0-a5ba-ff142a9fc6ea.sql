
CREATE TABLE public.postevent_qa_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  sent_at TIMESTAMPTZ,
  first_opened_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, profile_id)
);

CREATE INDEX postevent_qa_tokens_event_idx ON public.postevent_qa_tokens(event_id);
CREATE INDEX postevent_qa_tokens_profile_idx ON public.postevent_qa_tokens(profile_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.postevent_qa_tokens TO authenticated;
GRANT ALL ON public.postevent_qa_tokens TO service_role;

ALTER TABLE public.postevent_qa_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/staff full access to postevent qa tokens"
  ON public.postevent_qa_tokens
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE TRIGGER postevent_qa_tokens_updated_at
  BEFORE UPDATE ON public.postevent_qa_tokens
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
