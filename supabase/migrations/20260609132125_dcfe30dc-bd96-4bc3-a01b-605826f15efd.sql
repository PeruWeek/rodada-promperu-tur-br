
-- Helper functions (SECURITY DEFINER, fixed search_path)
create or replace function public.is_exhibitor_profile(_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.exhibitor_profiles where profile_id = _profile_id);
$$;

create or replace function public.is_exhibitor_company(_company_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    join public.exhibitor_profiles ep on ep.profile_id = p.id
    where p.company_id = _company_id
  );
$$;

create or replace function public.has_meeting_with_profile(_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.meetings m
    join public.event_tables et on et.id = m.table_id
    where (m.visitor_profile_id = _profile_id and et.exhibitor_profile_id = public.current_profile_id())
       or (m.visitor_profile_id = public.current_profile_id() and et.exhibitor_profile_id = _profile_id)
  );
$$;

create or replace function public.has_meeting_with_company(_company_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.meetings m
    join public.profiles vp on vp.id = m.visitor_profile_id
    join public.event_tables et on et.id = m.table_id
    join public.profiles ep on ep.id = et.exhibitor_profile_id
    where (vp.company_id = _company_id and ep.id = public.current_profile_id())
       or (ep.company_id = _company_id and vp.id = public.current_profile_id())
  );
$$;

-- profiles: replace open SELECT with scoped policy
drop policy if exists "profiles select authenticated limited" on public.profiles;
drop policy if exists "profiles select own" on public.profiles;
create policy "profiles select scoped"
  on public.profiles for select to authenticated
  using (
    auth_user_id = auth.uid()
    or public.is_admin_or_staff(auth.uid())
    or public.is_exhibitor_profile(id)
    or public.has_meeting_with_profile(id)
  );

-- companies: replace open SELECT with scoped policy
drop policy if exists "companies select auth" on public.companies;
create policy "companies select scoped"
  on public.companies for select to authenticated
  using (
    id = (select company_id from public.profiles where auth_user_id = auth.uid() limit 1)
    or public.is_admin_or_staff(auth.uid())
    or public.is_exhibitor_company(id)
    or public.has_meeting_with_company(id)
  );

-- exhibitor_profiles: keep readable to authenticated (intentional public catalog),
-- but make the intent explicit. Already restricted via RLS to authenticated role.
-- No change needed; finding will be marked as accepted in security memory.

-- Fix mutable search_path on email queue helpers
alter function public.enqueue_email(text, jsonb)            set search_path = public, pgmq;
alter function public.read_email_batch(text, integer, integer) set search_path = public, pgmq;
alter function public.delete_email(text, bigint)            set search_path = public, pgmq;
alter function public.move_to_dlq(text, text, bigint, jsonb) set search_path = public, pgmq;
