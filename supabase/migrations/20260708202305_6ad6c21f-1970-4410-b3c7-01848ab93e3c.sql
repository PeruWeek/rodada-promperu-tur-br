
CREATE TABLE public.postevent_survey_responses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  token_id UUID NOT NULL REFERENCES public.postevent_qa_tokens(id) ON DELETE CASCADE,
  event_id UUID NOT NULL,
  profile_id UUID NOT NULL,
  overall_rating SMALLINT CHECK (overall_rating BETWEEN 1 AND 5),
  meetings_quality SMALLINT CHECK (meetings_quality BETWEEN 1 AND 5),
  next_edition_interest TEXT CHECK (next_edition_interest IN ('yes','maybe','no')),
  comments TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (token_id)
);

GRANT ALL ON public.postevent_survey_responses TO service_role;

ALTER TABLE public.postevent_survey_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins/staff can read survey responses"
  ON public.postevent_survey_responses
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE OR REPLACE FUNCTION public.postevent_survey_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER postevent_survey_updated_at
BEFORE UPDATE ON public.postevent_survey_responses
FOR EACH ROW EXECUTE FUNCTION public.postevent_survey_touch_updated_at();
