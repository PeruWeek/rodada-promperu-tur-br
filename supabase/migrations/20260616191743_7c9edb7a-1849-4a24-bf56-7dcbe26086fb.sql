
do $$
declare v_event_id uuid; v_tz text := 'America/Sao_Paulo';
begin
  select id into v_event_id from public.events where name = 'Rodada Peru 2026' limit 1;
  if v_event_id is null then
    return;
  end if;
  update public.events
     set meetings_start = ('2026-07-08 09:00'::timestamp at time zone v_tz),
         meetings_end   = ('2026-07-08 14:15'::timestamp at time zone v_tz),
         lunch_start    = ('2026-07-08 14:15'::timestamp at time zone v_tz),
         lunch_end      = ('2026-07-08 14:15'::timestamp at time zone v_tz),
         meetings2_start = ('2026-07-08 14:15'::timestamp at time zone v_tz),
         meetings2_end   = ('2026-07-08 14:15'::timestamp at time zone v_tz),
         slot_minutes = 15
   where id = v_event_id;
  perform public.rebuild_event_time_slots(v_event_id, true);
end $$;
