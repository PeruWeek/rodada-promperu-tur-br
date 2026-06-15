update public.events
set
  meetings_end    = date_trunc('day', meetings_start) + interval '17 hours',
  lunch_start     = null,
  lunch_end       = null,
  meetings2_start = null,
  meetings2_end   = null,
  slot_minutes    = 15
where meetings_start is not null;

update public.time_slots ts
set is_active = false
from public.events e
where ts.event_id = e.id
  and ts.is_active = true
  and ts.start_at >= date_trunc('day', e.meetings_start) + interval '17 hours';