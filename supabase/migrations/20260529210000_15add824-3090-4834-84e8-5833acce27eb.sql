-- Attach meeting conflict trigger and generate initial time_slots
DROP TRIGGER IF EXISTS meetings_no_conflict ON public.meetings;
CREATE TRIGGER meetings_no_conflict
BEFORE INSERT OR UPDATE ON public.meetings
FOR EACH ROW EXECUTE FUNCTION public.enforce_meeting_no_conflict();

-- Generate time slots for the seeded event
SELECT public.rebuild_event_time_slots(id, true) FROM public.events;