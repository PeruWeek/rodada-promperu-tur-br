
-- general_checkins: campos operacionais
ALTER TABLE public.general_checkins
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'staff_manual',
  ADD COLUMN IF NOT EXISTS note text NULL,
  ADD COLUMN IF NOT EXISTS available_for_fillin boolean NOT NULL DEFAULT true;

ALTER TABLE public.general_checkins
  DROP CONSTRAINT IF EXISTS general_checkins_source_check;
ALTER TABLE public.general_checkins
  ADD CONSTRAINT general_checkins_source_check
  CHECK (source IN ('entrance','staff_manual','qr','self'));

ALTER TABLE public.general_checkins
  DROP CONSTRAINT IF EXISTS general_checkins_note_len_check;
ALTER TABLE public.general_checkins
  ADD CONSTRAINT general_checkins_note_len_check
  CHECK (note IS NULL OR char_length(note) <= 140);

-- meeting_checkins: nota curta
ALTER TABLE public.meeting_checkins
  ADD COLUMN IF NOT EXISTS note text NULL;

ALTER TABLE public.meeting_checkins
  DROP CONSTRAINT IF EXISTS meeting_checkins_note_len_check;
ALTER TABLE public.meeting_checkins
  ADD CONSTRAINT meeting_checkins_note_len_check
  CHECK (note IS NULL OR char_length(note) <= 140);
