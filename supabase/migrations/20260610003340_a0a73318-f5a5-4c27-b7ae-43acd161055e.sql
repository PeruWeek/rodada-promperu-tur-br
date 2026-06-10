DROP POLICY IF EXISTS "exh select scoped" ON public.exhibitor_profiles;
CREATE POLICY "exh select scoped"
  ON public.exhibitor_profiles
  FOR SELECT
  USING (
    profile_id = public.current_profile_id()
    OR public.is_admin_or_staff(auth.uid())
  );