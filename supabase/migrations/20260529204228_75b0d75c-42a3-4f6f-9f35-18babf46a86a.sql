
-- Add search_path to remaining functions
alter function public.enforce_meeting_no_conflict() set search_path = public;
alter function public.rebuild_event_time_slots(uuid, boolean) set search_path = public;
alter function public.handle_new_user() set search_path = public;

-- Restrict execute on security definer helpers (only authenticated users should call them via policies)
revoke execute on function public.has_role(uuid, app_role) from public, anon;
revoke execute on function public.is_admin_or_staff(uuid) from public, anon;
revoke execute on function public.current_profile_id() from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.rebuild_event_time_slots(uuid, boolean) from public, anon;
grant execute on function public.has_role(uuid, app_role) to authenticated;
grant execute on function public.is_admin_or_staff(uuid) to authenticated;
grant execute on function public.current_profile_id() to authenticated;
grant execute on function public.rebuild_event_time_slots(uuid, boolean) to authenticated, service_role;
