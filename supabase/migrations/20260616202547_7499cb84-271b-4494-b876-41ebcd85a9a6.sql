UPDATE public.events
SET meetings_start  = (event_date + time '12:00') AT TIME ZONE 'UTC',
    meetings_end    = (event_date + time '17:00') AT TIME ZONE 'UTC',
    lunch_start     = (event_date + time '17:00') AT TIME ZONE 'UTC',
    lunch_end       = (event_date + time '19:00') AT TIME ZONE 'UTC',
    meetings2_start = (event_date + time '19:00') AT TIME ZONE 'UTC',
    meetings2_end   = (event_date + time '19:00') AT TIME ZONE 'UTC'
WHERE id = 'd86be1b5-857e-44c4-9d69-1f4f4d8b1bdb';

SELECT public.rebuild_event_time_slots('d86be1b5-857e-44c4-9d69-1f4f4d8b1bdb');