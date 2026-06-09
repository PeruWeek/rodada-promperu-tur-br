
-- 1) Restrict agents SELECT to admin/staff only
DROP POLICY IF EXISTS "agents select auth" ON public.agents;
CREATE POLICY "agents select admin staff" ON public.agents
  FOR SELECT
  USING (public.is_admin_or_staff(auth.uid()));

-- 2) Tighten meetings INSERT for visitors: enforce slot/table/event consistency
DROP POLICY IF EXISTS "meetings insert visitor" ON public.meetings;
CREATE POLICY "meetings insert visitor" ON public.meetings
  FOR INSERT
  WITH CHECK (
    visitor_profile_id = public.current_profile_id()
    AND status = 'scheduled'::meeting_status
    AND EXISTS (
      SELECT 1
      FROM public.time_slots ts
      WHERE ts.id = meetings.slot_id
        AND ts.table_id = meetings.table_id
        AND ts.event_id = meetings.event_id
        AND ts.is_active = true
        AND ts.is_buffer = false
    )
  );
