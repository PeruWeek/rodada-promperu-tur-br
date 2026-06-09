-- Tighten exhibitor_profiles SELECT and add participant SELECT on meeting_reschedules

DROP POLICY IF EXISTS "exh select auth" ON public.exhibitor_profiles;

CREATE POLICY "exh select scoped"
ON public.exhibitor_profiles
FOR SELECT
TO authenticated
USING (
  profile_id = public.current_profile_id()
  OR public.is_admin_or_staff(auth.uid())
  OR public.has_meeting_with_profile(profile_id)
);

CREATE POLICY "resch participant select"
ON public.meeting_reschedules
FOR SELECT
TO authenticated
USING (
  public.is_admin_or_staff(auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.meetings m
    LEFT JOIN public.event_tables et ON et.id = m.table_id
    WHERE m.id = meeting_reschedules.meeting_id
      AND (
        m.visitor_profile_id = public.current_profile_id()
        OR et.exhibitor_profile_id = public.current_profile_id()
      )
  )
);
