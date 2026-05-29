
-- These helpers are referenced inside RLS policies and must be executable
-- by the calling role; otherwise policy evaluation fails for end users.
GRANT EXECUTE ON FUNCTION public.is_admin_or_staff(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.current_profile_id() TO authenticated, anon;
