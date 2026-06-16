UPDATE public.events
SET lunch_start = (event_date::timestamp + time '15:00') AT TIME ZONE 'UTC',
    lunch_end   = (event_date::timestamp + time '15:15') AT TIME ZONE 'UTC';

SELECT public.rebuild_event_time_slots(id) FROM public.events;