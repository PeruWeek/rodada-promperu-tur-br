
-- Helper: is the current user a participant in the given event?
create or replace function public.user_in_event(_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.event_tables et
    where et.event_id = _event_id
      and et.exhibitor_profile_id = public.current_profile_id()
  )
  or exists (
    select 1
    from public.company_event_pipeline cep
    join public.profiles p on p.company_id = cep.company_id
    where cep.event_id = _event_id
      and p.id = public.current_profile_id()
  )
  or exists (
    select 1
    from public.meetings m
    where m.event_id = _event_id
      and m.visitor_profile_id = public.current_profile_id()
  );
$$;

grant execute on function public.user_in_event(uuid) to authenticated;

-- agent_skills / skills: restrict SELECT to admin/staff
drop policy if exists "agent_skills select auth" on public.agent_skills;
create policy "agent_skills select admin/staff"
  on public.agent_skills
  for select
  to authenticated
  using (public.is_admin_or_staff(auth.uid()));

drop policy if exists "skills select auth" on public.skills;
create policy "skills select admin/staff"
  on public.skills
  for select
  to authenticated
  using (public.is_admin_or_staff(auth.uid()));

-- time_slots: scope reads to admin/staff or event participants
drop policy if exists "time_slots select authenticated" on public.time_slots;
create policy "time_slots select participant"
  on public.time_slots
  for select
  to authenticated
  using (
    public.is_admin_or_staff(auth.uid())
    or public.user_in_event(event_id)
  );

-- event_tables: scope reads to admin/staff or event participants
drop policy if exists "event_tables select authenticated" on public.event_tables;
create policy "event_tables select participant"
  on public.event_tables
  for select
  to authenticated
  using (
    public.is_admin_or_staff(auth.uid())
    or public.user_in_event(event_id)
  );
