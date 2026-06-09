DROP POLICY "events select all" ON public.events;
DROP POLICY "event_tables select all" ON public.event_tables;
DROP POLICY "time_slots select all" ON public.time_slots;

CREATE POLICY "events select authenticated" ON public.events FOR SELECT TO authenticated USING (true);
CREATE POLICY "event_tables select authenticated" ON public.event_tables FOR SELECT TO authenticated USING (true);
CREATE POLICY "time_slots select authenticated" ON public.time_slots FOR SELECT TO authenticated USING (true);

REVOKE SELECT ON public.events FROM anon;
REVOKE SELECT ON public.event_tables FROM anon;
REVOKE SELECT ON public.time_slots FROM anon;