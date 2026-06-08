
-- ============================================================
-- Extensions
-- ============================================================
create extension if not exists pgcrypto;
create extension if not exists citext;

-- ============================================================
-- Enums
-- ============================================================
do $$ begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type app_role as enum ('admin', 'staff', 'exhibitor', 'visitor');
  end if;
  if not exists (select 1 from pg_type where typname = 'app_language') then
    create type app_language as enum ('pt-BR', 'es');
  end if;
  if not exists (select 1 from pg_type where typname = 'meeting_status') then
    create type meeting_status as enum ('scheduled', 'cancelled', 'done', 'no_show', 'needs_reschedule');
  end if;
  if not exists (select 1 from pg_type where typname = 'checkin_method') then
    create type checkin_method as enum ('qr', 'manual');
  end if;
  if not exists (select 1 from pg_type where typname = 'meeting_checkin_by_role') then
    create type meeting_checkin_by_role as enum ('staff', 'exhibitor', 'visitor');
  end if;
  if not exists (select 1 from pg_type where typname = 'meeting_checkin_status') then
    create type meeting_checkin_status as enum ('present', 'no_show', 'late');
  end if;
  if not exists (select 1 from pg_type where typname = 'meeting_outcome') then
    create type meeting_outcome as enum ('hot', 'warm', 'cold');
  end if;
  if not exists (select 1 from pg_type where typname = 'notification_type') then
    create type notification_type as enum ('meeting_created','meeting_cancelled','meeting_rescheduled','meeting_reminder','system');
  end if;
  if not exists (select 1 from pg_type where typname = 'notification_channel') then
    create type notification_channel as enum ('in_app','email','both');
  end if;
  if not exists (select 1 from pg_type where typname = 'notification_status') then
    create type notification_status as enum ('queued','sent','failed');
  end if;
end $$;

-- ============================================================
-- Core tables
-- ============================================================
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  legal_name text,
  trade_name text not null,
  country_code text not null,
  city text,
  website text,
  instagram text,
  linkedin text,
  phone text,
  whatsapp text,
  tax_id text,
  state_code text,
  created_at timestamptz not null default now(),
  constraint companies_country_code_chk check (char_length(country_code) between 2 and 3)
);

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  full_name text not null,
  email citext,
  preferred_language app_language not null default 'pt-BR',
  is_active boolean not null default true,
  job_title text,
  phone text,
  whatsapp text,
  created_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

create table if not exists public.exhibitor_profiles (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  segments text[],
  destinations text[],
  services text[],
  target_buyers text[],
  pitch_pt text,
  pitch_es text,
  portfolio_pt text,
  portfolio_es text,
  materials_links text[]
);

create table if not exists public.visitor_profiles (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  buyer_type text,
  interests_segments text[],
  interests_destinations text[],
  interests_services text[],
  portfolio_pt text,
  portfolio_es text,
  notes text,
  demand_profile text,
  interests_destinations_free text,
  consent_data_sharing boolean not null default false,
  consent_data_sharing_at timestamptz,
  consent_marketing boolean not null default false
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  event_date date,
  meetings_start timestamptz,
  meetings_end timestamptz,
  lunch_start timestamptz,
  lunch_end timestamptz,
  meetings2_start timestamptz,
  meetings2_end timestamptz,
  slot_minutes int not null default 15,
  tables_count int not null default 0,
  capacity_target int,
  language_default app_language not null default 'pt-BR',
  created_at timestamptz not null default now()
);

create table if not exists public.event_tables (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  table_number int not null,
  exhibitor_profile_id uuid references public.exhibitor_profiles(profile_id) on delete set null,
  table_label text,
  constraint event_tables_table_number_chk check (table_number > 0)
);
create unique index if not exists event_tables_unique_event_table_number on public.event_tables(event_id, table_number);
create unique index if not exists event_tables_unique_event_exhibitor on public.event_tables(event_id, exhibitor_profile_id) where exhibitor_profile_id is not null;

create table if not exists public.time_slots (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  table_id uuid not null references public.event_tables(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  is_buffer boolean not null default false,
  is_active boolean not null default true,
  generation_id uuid,
  created_at timestamptz not null default now(),
  constraint time_slots_time_chk check (end_at > start_at)
);
create unique index if not exists time_slots_unique_table_start_end on public.time_slots(table_id, start_at, end_at) where is_active = true;

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  table_id uuid not null references public.event_tables(id) on delete restrict,
  slot_id uuid not null references public.time_slots(id) on delete restrict,
  visitor_profile_id uuid not null references public.visitor_profiles(profile_id) on delete restrict,
  status meeting_status not null default 'scheduled',
  cancel_reason text,
  requested_start_at timestamptz,
  original_slot_id uuid references public.time_slots(id) on delete set null,
  original_start_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists meetings_unique_table_slot_scheduled on public.meetings(table_id, slot_id) where status = 'scheduled';
create unique index if not exists meetings_unique_visitor_slot_scheduled on public.meetings(visitor_profile_id, slot_id) where status = 'scheduled';

create table if not exists public.meeting_reschedules (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  batch_id uuid not null,
  old_table_id uuid,
  new_table_id uuid,
  old_slot_id uuid,
  new_slot_id uuid,
  reason text,
  changed_by_profile_id uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb
);

create table if not exists public.general_checkins (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  checkin_at timestamptz not null default now(),
  method checkin_method not null default 'manual'
);
create unique index if not exists general_checkins_unique_event_profile on public.general_checkins(event_id, profile_id);

create table if not exists public.meeting_checkins (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  checkin_at timestamptz not null default now(),
  by_role meeting_checkin_by_role not null,
  status meeting_checkin_status not null default 'present',
  late_minutes int,
  constraint meeting_checkins_late_minutes_chk check (late_minutes is null or late_minutes >= 0)
);

create table if not exists public.meeting_outcomes (
  meeting_id uuid primary key references public.meetings(id) on delete cascade,
  outcome meeting_outcome not null,
  next_steps text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id) on delete cascade,
  recipient_profile_id uuid not null references public.profiles(id) on delete cascade,
  type notification_type not null,
  title text not null,
  body text,
  data jsonb not null default '{}'::jsonb,
  channel notification_channel not null default 'in_app',
  status notification_status not null default 'queued',
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.email_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id) on delete cascade,
  recipient_profile_id uuid references public.profiles(id) on delete set null,
  recipient_email text not null,
  template text not null,
  provider text not null default 'sendgrid',
  status text not null,
  error text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Indexes
-- ============================================================
create index if not exists profiles_company_id_idx on public.profiles(company_id);
create index if not exists event_tables_event_id_idx on public.event_tables(event_id);
create index if not exists time_slots_event_id_start_at_idx on public.time_slots(event_id, start_at);
create index if not exists time_slots_table_id_start_at_idx on public.time_slots(table_id, start_at);
create index if not exists time_slots_event_active_start_idx on public.time_slots(event_id, is_active, start_at);
create index if not exists meetings_event_id_idx on public.meetings(event_id);
create index if not exists meetings_slot_id_idx on public.meetings(slot_id);
create index if not exists meetings_visitor_profile_id_idx on public.meetings(visitor_profile_id);
create index if not exists meetings_table_id_idx on public.meetings(table_id);
create index if not exists meeting_checkins_meeting_id_idx on public.meeting_checkins(meeting_id);
create index if not exists audit_logs_event_id_created_at_idx on public.audit_logs(event_id, created_at desc);
create index if not exists notifications_recipient_idx on public.notifications(recipient_profile_id, is_read, created_at desc);
create index if not exists user_roles_user_id_idx on public.user_roles(user_id);

-- ============================================================
-- Security-definer helpers
-- ============================================================
create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role);
$$;

create or replace function public.is_admin_or_staff(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role in ('admin','staff'));
$$;

create or replace function public.current_profile_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.profiles where auth_user_id = auth.uid() limit 1;
$$;

-- ============================================================
-- Anti-conflict trigger for meetings
-- ============================================================
create or replace function public.enforce_meeting_no_conflict()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status <> 'scheduled' then return new; end if;
  if exists (
    select 1 from public.meetings m
    where m.table_id = new.table_id and m.slot_id = new.slot_id and m.status = 'scheduled'
      and (tg_op = 'INSERT' or m.id <> new.id)
  ) then
    raise exception 'Conflito de agenda: esta mesa ja possui uma reuniao agendada neste horario.' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.meetings m
    where m.visitor_profile_id = new.visitor_profile_id and m.slot_id = new.slot_id and m.status = 'scheduled'
      and (tg_op = 'INSERT' or m.id <> new.id)
  ) then
    raise exception 'Conflito de agenda: este visitante ja possui uma reuniao agendada neste horario.' using errcode = '23505';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_meetings_no_conflict on public.meetings;
create trigger trg_meetings_no_conflict
before insert or update of table_id, slot_id, visitor_profile_id, status on public.meetings
for each row execute function public.enforce_meeting_no_conflict();

drop trigger if exists meetings_no_conflict on public.meetings;
create trigger meetings_no_conflict
before insert or update on public.meetings
for each row execute function public.enforce_meeting_no_conflict();

-- ============================================================
-- Auto-create profile + default role on signup
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_full_name text; v_lang app_language;
begin
  v_full_name := coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1));
  v_lang := case when (new.raw_user_meta_data->>'preferred_language') = 'es' then 'es'::app_language else 'pt-BR'::app_language end;
  insert into public.profiles (auth_user_id, full_name, email, preferred_language)
  values (new.id, v_full_name, new.email, v_lang)
  on conflict (auth_user_id) do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'visitor')
  on conflict (user_id, role) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- ============================================================
-- Slot generation function
-- ============================================================
create or replace function public.rebuild_event_time_slots(
  p_event_id uuid, p_deactivate_previous boolean default true
) returns uuid language plpgsql set search_path = public as $$
declare
  v_event public.events%rowtype;
  v_generation_id uuid := gen_random_uuid();
  v_slot_interval interval;
begin
  select * into v_event from public.events where id = p_event_id;
  if not found then raise exception 'Evento nao encontrado: %', p_event_id; end if;
  v_slot_interval := make_interval(mins => v_event.slot_minutes);
  if p_deactivate_previous then
    update public.time_slots set is_active = false where event_id = p_event_id and is_active = true;
  end if;
  insert into public.time_slots (event_id, table_id, start_at, end_at, is_buffer, is_active, generation_id)
  select et.event_id, et.id, gs.start_at, gs.start_at + v_slot_interval, false, true, v_generation_id
  from public.event_tables et
  cross join lateral (
    select s as start_at from generate_series(
      v_event.meetings_start,
      (case when v_event.lunch_start is not null and v_event.lunch_start < v_event.meetings_end then v_event.lunch_start else v_event.meetings_end end) - v_slot_interval,
      v_slot_interval
    ) s where v_event.meetings_start is not null and v_event.meetings_end is not null
    union all
    select s from generate_series(
      (case when v_event.lunch_end is not null and v_event.lunch_end > v_event.meetings_start then v_event.lunch_end else v_event.meetings_start end),
      v_event.meetings_end - v_slot_interval, v_slot_interval
    ) s where v_event.lunch_end is not null and v_event.lunch_end < v_event.meetings_end
    union all
    select s from generate_series(v_event.meetings2_start, v_event.meetings2_end - v_slot_interval, v_slot_interval) s
    where v_event.meetings2_start is not null and v_event.meetings2_end is not null
  ) gs
  where et.event_id = p_event_id;
  return v_generation_id;
end;
$$;

-- ============================================================
-- GRANTs
-- ============================================================
grant select on public.events, public.event_tables, public.time_slots, public.companies to anon, authenticated;
grant select, insert, update, delete on public.exhibitor_profiles, public.visitor_profiles to authenticated;
grant select on public.user_roles to authenticated;
grant select, insert, update, delete on public.meetings, public.meeting_outcomes, public.meeting_checkins, public.general_checkins to authenticated;
grant select on public.meeting_reschedules, public.audit_logs to authenticated;
grant select, update on public.notifications to authenticated;
grant select on public.email_delivery_logs to authenticated;
grant insert, update, delete on public.companies, public.events, public.event_tables, public.time_slots to authenticated;
grant all on all tables in schema public to service_role;

-- profiles column-level grants (email/phone/whatsapp hidden from authenticated/anon)
grant select (id, auth_user_id, company_id, full_name, preferred_language, is_active, created_at)
  on public.profiles to authenticated;
grant select (id, auth_user_id, company_id, full_name, preferred_language, is_active, created_at)
  on public.profiles to anon;
grant insert, update, delete on public.profiles to authenticated;
grant all on public.profiles to service_role;

-- ============================================================
-- RLS
-- ============================================================
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.companies enable row level security;
alter table public.exhibitor_profiles enable row level security;
alter table public.visitor_profiles enable row level security;
alter table public.events enable row level security;
alter table public.event_tables enable row level security;
alter table public.time_slots enable row level security;
alter table public.meetings enable row level security;
alter table public.meeting_reschedules enable row level security;
alter table public.general_checkins enable row level security;
alter table public.meeting_checkins enable row level security;
alter table public.meeting_outcomes enable row level security;
alter table public.audit_logs enable row level security;
alter table public.notifications enable row level security;
alter table public.email_delivery_logs enable row level security;

create policy "profiles select own" on public.profiles for select using (auth_user_id = auth.uid());
create policy "profiles select authenticated limited" on public.profiles for select to authenticated using (true);
create policy "profiles update own" on public.profiles for update using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());
create policy "profiles insert own" on public.profiles for insert with check (auth_user_id = auth.uid());
create policy "profiles admin all" on public.profiles for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));

create policy "user_roles select own" on public.user_roles for select using (user_id = auth.uid());
create policy "user_roles admin all" on public.user_roles for all using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

create policy "companies select auth" on public.companies for select to authenticated using (true);
create policy "companies update admin" on public.companies for update using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));
create policy "companies delete admin" on public.companies for delete using (public.is_admin_or_staff(auth.uid()));

create policy "exh select auth" on public.exhibitor_profiles for select to authenticated using (true);
create policy "exh insert own" on public.exhibitor_profiles for insert with check (profile_id = public.current_profile_id());
create policy "exh update own" on public.exhibitor_profiles for update using (profile_id = public.current_profile_id()) with check (profile_id = public.current_profile_id());
create policy "exh admin all" on public.exhibitor_profiles for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));

create policy "vis select own" on public.visitor_profiles for select using (profile_id = public.current_profile_id());
create policy "vis insert own" on public.visitor_profiles for insert with check (profile_id = public.current_profile_id());
create policy "vis update own" on public.visitor_profiles for update using (profile_id = public.current_profile_id()) with check (profile_id = public.current_profile_id());
create policy "vis admin all" on public.visitor_profiles for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));
create policy "vis select exhibitor with meeting" on public.visitor_profiles for select using (
  exists (
    select 1 from public.meetings m join public.event_tables et on et.id = m.table_id
    where m.visitor_profile_id = visitor_profiles.profile_id
      and et.exhibitor_profile_id = public.current_profile_id()
  )
);

create policy "events select all" on public.events for select using (true);
create policy "events admin all" on public.events for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));
create policy "event_tables select all" on public.event_tables for select using (true);
create policy "event_tables admin all" on public.event_tables for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));
create policy "time_slots select all" on public.time_slots for select using (true);
create policy "time_slots admin all" on public.time_slots for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));

create policy "meetings select visitor own" on public.meetings for select using (visitor_profile_id = public.current_profile_id());
create policy "meetings select exhibitor table" on public.meetings for select using (
  exists (select 1 from public.event_tables et where et.id = meetings.table_id and et.exhibitor_profile_id = public.current_profile_id())
);
create policy "meetings select admin" on public.meetings for select using (public.is_admin_or_staff(auth.uid()));
create policy "meetings insert visitor" on public.meetings for insert with check (visitor_profile_id = public.current_profile_id());
create policy "meetings admin all" on public.meetings for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));

create policy "resch admin all" on public.meeting_reschedules for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));
create policy "gen_checkins select own" on public.general_checkins for select using (profile_id = public.current_profile_id());
create policy "gen_checkins admin all" on public.general_checkins for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));

create policy "meeting_checkins select participant" on public.meeting_checkins for select using (
  exists (select 1 from public.meetings m where m.id = meeting_checkins.meeting_id and (
    m.visitor_profile_id = public.current_profile_id()
    or exists (select 1 from public.event_tables et where et.id = m.table_id and et.exhibitor_profile_id = public.current_profile_id())
  ))
);
create policy "meeting_checkins admin all" on public.meeting_checkins for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));

create policy "outcomes select participant" on public.meeting_outcomes for select using (
  exists (select 1 from public.meetings m where m.id = meeting_outcomes.meeting_id and (
    m.visitor_profile_id = public.current_profile_id()
    or exists (select 1 from public.event_tables et where et.id = m.table_id and et.exhibitor_profile_id = public.current_profile_id())
  ))
);
create policy "outcomes insert exhibitor" on public.meeting_outcomes for insert with check (
  exists (select 1 from public.meetings m join public.event_tables et on et.id = m.table_id
    where m.id = meeting_outcomes.meeting_id and et.exhibitor_profile_id = public.current_profile_id())
);
create policy "outcomes admin all" on public.meeting_outcomes for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));

create policy "audit admin all" on public.audit_logs for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));
create policy "notif select own" on public.notifications for select using (recipient_profile_id = public.current_profile_id());
create policy "notif update own" on public.notifications for update using (recipient_profile_id = public.current_profile_id()) with check (recipient_profile_id = public.current_profile_id());
create policy "notif admin all" on public.notifications for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));
create policy "email_logs admin all" on public.email_delivery_logs for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));

-- Restrict execute on security definer helpers
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.rebuild_event_time_slots(uuid, boolean) from public, anon;
grant execute on function public.rebuild_event_time_slots(uuid, boolean) to authenticated, service_role;
grant execute on function public.is_admin_or_staff(uuid) to authenticated, anon;
grant execute on function public.has_role(uuid, public.app_role) to authenticated, anon;
grant execute on function public.current_profile_id() to authenticated, anon;

-- ============================================================
-- Seed event + 10 tables + slots
-- ============================================================
do $$
declare v_event_id uuid; v_tz text := 'America/Sao_Paulo'; i int;
begin
  if not exists (select 1 from public.events where name = 'Rodada Peru 2026') then
    insert into public.events (
      name, event_date, meetings_start, meetings_end, lunch_start, lunch_end,
      meetings2_start, meetings2_end, slot_minutes, tables_count, capacity_target, language_default
    ) values (
      'Rodada Peru 2026', '2026-07-08',
      ('2026-07-08 09:00'::timestamp at time zone v_tz),
      ('2026-07-08 14:15'::timestamp at time zone v_tz),
      ('2026-07-08 12:00'::timestamp at time zone v_tz),
      ('2026-07-08 12:15'::timestamp at time zone v_tz),
      ('2026-07-08 16:15'::timestamp at time zone v_tz),
      ('2026-07-08 18:30'::timestamp at time zone v_tz),
      15, 10, 280, 'pt-BR'
    ) returning id into v_event_id;
    for i in 1..10 loop
      insert into public.event_tables (event_id, table_number, table_label) values (v_event_id, i, 'Mesa ' || i);
    end loop;
    perform public.rebuild_event_time_slots(v_event_id, false);
  end if;
end $$;

-- ============================================================
-- pgvector + agents/skills/rag/conversations
-- ============================================================
create extension if not exists vector;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'agent_base_url_mode') then
    create type agent_base_url_mode as enum ('api', 'free');
  end if;
  if not exists (select 1 from pg_type where typname = 'skill_scope') then
    create type skill_scope as enum ('public', 'staff');
  end if;
  if not exists (select 1 from pg_type where typname = 'conversation_message_role') then
    create type conversation_message_role as enum ('user', 'assistant', 'tool', 'system');
  end if;
end $$;

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null,
  provider text not null default 'openrouter',
  base_url_mode agent_base_url_mode not null default 'free',
  model text not null,
  temperature numeric(3,2),
  max_tokens integer,
  system_prompt text,
  rag_enabled boolean not null default false,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agents_event_id_idx on public.agents(event_id);
create unique index agents_one_default_per_event on public.agents(event_id) where is_default = true;
grant select on public.agents to authenticated;
grant all on public.agents to service_role;
alter table public.agents enable row level security;
create policy "agents select auth" on public.agents for select to authenticated using (true);
create policy "agents admin all" on public.agents for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));

create table public.skills (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text not null,
  params_schema jsonb not null default '{}'::jsonb,
  scope skill_scope not null default 'public',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
grant select on public.skills to authenticated;
grant all on public.skills to service_role;
alter table public.skills enable row level security;
create policy "skills select auth" on public.skills for select to authenticated using (true);
create policy "skills admin all" on public.skills for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));

create table public.agent_skills (
  agent_id uuid not null references public.agents(id) on delete cascade,
  skill_id uuid not null references public.skills(id) on delete cascade,
  primary key (agent_id, skill_id)
);
grant select on public.agent_skills to authenticated;
grant all on public.agent_skills to service_role;
alter table public.agent_skills enable row level security;
create policy "agent_skills select auth" on public.agent_skills for select to authenticated using (true);
create policy "agent_skills admin all" on public.agent_skills for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));

create table public.user_llm_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null default 'openrouter',
  api_key_encrypted text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.user_llm_credentials to authenticated;
grant all on public.user_llm_credentials to service_role;
alter table public.user_llm_credentials enable row level security;
create policy "llm_cred own select" on public.user_llm_credentials for select using (user_id = auth.uid());
create policy "llm_cred own insert" on public.user_llm_credentials for insert with check (user_id = auth.uid());
create policy "llm_cred own update" on public.user_llm_credentials for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "llm_cred own delete" on public.user_llm_credentials for delete using (user_id = auth.uid());

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  owner_profile_id uuid not null references public.profiles(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversations_owner_idx on public.conversations(owner_profile_id);
create index conversations_event_idx on public.conversations(event_id);
grant select, insert, update, delete on public.conversations to authenticated;
grant all on public.conversations to service_role;
alter table public.conversations enable row level security;
create policy "conv select own" on public.conversations for select using (owner_profile_id = public.current_profile_id() or public.is_admin_or_staff(auth.uid()));
create policy "conv insert own" on public.conversations for insert with check (owner_profile_id = public.current_profile_id());
create policy "conv update own" on public.conversations for update using (owner_profile_id = public.current_profile_id()) with check (owner_profile_id = public.current_profile_id());
create policy "conv delete own" on public.conversations for delete using (owner_profile_id = public.current_profile_id() or public.is_admin_or_staff(auth.uid()));

create table public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role conversation_message_role not null,
  content text,
  tool_calls jsonb,
  tool_call_id text,
  tool_name text,
  created_at timestamptz not null default now()
);
create index conv_msg_conv_idx on public.conversation_messages(conversation_id, created_at);
grant select, insert on public.conversation_messages to authenticated;
grant all on public.conversation_messages to service_role;
alter table public.conversation_messages enable row level security;
create policy "conv_msg select own" on public.conversation_messages for select using (
  exists (select 1 from public.conversations c where c.id = conversation_id and (c.owner_profile_id = public.current_profile_id() or public.is_admin_or_staff(auth.uid())))
);
create policy "conv_msg insert own" on public.conversation_messages for insert with check (
  exists (select 1 from public.conversations c where c.id = conversation_id and (c.owner_profile_id = public.current_profile_id() or public.is_admin_or_staff(auth.uid())))
);

create table public.rag_documents (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  title text not null,
  source_url text,
  mime text,
  raw_text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index rag_docs_event_idx on public.rag_documents(event_id);
grant select, insert, update, delete on public.rag_documents to authenticated;
grant all on public.rag_documents to service_role;
alter table public.rag_documents enable row level security;
create policy "rag_docs admin all" on public.rag_documents for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));

create table public.rag_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.rag_documents(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(1024),
  created_at timestamptz not null default now()
);
create index rag_chunks_event_idx on public.rag_chunks(event_id);
create index rag_chunks_doc_idx on public.rag_chunks(document_id);
grant select, insert, update, delete on public.rag_chunks to authenticated;
grant all on public.rag_chunks to service_role;
alter table public.rag_chunks enable row level security;
create policy "rag_chunks admin all" on public.rag_chunks for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));

create or replace function public.match_rag_chunks(
  p_event_id uuid, p_query vector(1024), p_top_k int default 5
) returns table (id uuid, content text, metadata jsonb, similarity float)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin_or_staff(auth.uid()) then raise exception 'Forbidden'; end if;
  return query
  select c.id, c.content, c.metadata, 1 - (c.embedding <=> p_query) as similarity
  from public.rag_chunks c
  where c.event_id = p_event_id and c.embedding is not null
  order by c.embedding <=> p_query
  limit p_top_k;
end;
$$;
grant execute on function public.match_rag_chunks(uuid, public.vector, integer) to authenticated;

-- Seed skills
insert into public.skills (key, name, description, params_schema, scope) values
  ('get_event_info', 'Obter informacoes do evento', 'Retorna nome, data, horarios e configuracoes do evento.', '{"type":"object","properties":{"event_id":{"type":"string"}},"required":["event_id"]}'::jsonb, 'public'),
  ('list_exhibitors', 'Listar expositores', 'Lista expositores do evento com filtros opcionais.', '{"type":"object","properties":{"event_id":{"type":"string"},"query":{"type":"string"}},"required":["event_id"]}'::jsonb, 'public'),
  ('get_my_meetings', 'Minhas reunioes', 'Retorna as reunioes agendadas do usuario atual.', '{"type":"object","properties":{"event_id":{"type":"string"}},"required":["event_id"]}'::jsonb, 'public'),
  ('get_meeting_details', 'Detalhes de reuniao', 'Retorna detalhes de uma reuniao especifica.', '{"type":"object","properties":{"meeting_id":{"type":"string"}},"required":["meeting_id"]}'::jsonb, 'public'),
  ('list_meetings_by_table', 'Reunioes por mesa', 'Lista reunioes de uma mesa.', '{"type":"object","properties":{"event_id":{"type":"string"},"table_id":{"type":"string"}},"required":["event_id","table_id"]}'::jsonb, 'staff'),
  ('list_meetings_by_timeslot', 'Reunioes por horario', 'Lista reunioes que comecam em um horario.', '{"type":"object","properties":{"event_id":{"type":"string"},"start_at":{"type":"string"}},"required":["event_id","start_at"]}'::jsonb, 'staff'),
  ('mark_general_checkin', 'Check-in geral', 'Registra check-in geral de um participante no evento.', '{"type":"object","properties":{"event_id":{"type":"string"},"profile_id":{"type":"string"},"method":{"type":"string","enum":["qr","manual"]}},"required":["event_id","profile_id"]}'::jsonb, 'staff'),
  ('mark_meeting_checkin', 'Check-in de reuniao', 'Registra check-in/no-show/late em uma reuniao.', '{"type":"object","properties":{"meeting_id":{"type":"string"},"status":{"type":"string","enum":["present","no_show","late"]},"late_minutes":{"type":"number"}},"required":["meeting_id","status"]}'::jsonb, 'staff'),
  ('mark_no_show', 'Marcar no-show', 'Marca uma reuniao como no-show.', '{"type":"object","properties":{"meeting_id":{"type":"string"}},"required":["meeting_id"]}'::jsonb, 'staff'),
  ('set_meeting_outcome', 'Resultado da reuniao', 'Registra o resultado e notas de uma reuniao.', '{"type":"object","properties":{"meeting_id":{"type":"string"},"outcome":{"type":"string","enum":["hot","warm","cold"]},"notes":{"type":"string"},"next_steps":{"type":"string"}},"required":["meeting_id","outcome"]}'::jsonb, 'staff')
on conflict (key) do nothing;

-- ============================================================
-- Exhibitor approval requests + onboarding helpers
-- ============================================================
create table public.exhibitor_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_by_profile_id uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text
);
grant select, insert on public.exhibitor_requests to authenticated;
grant all on public.exhibitor_requests to service_role;
alter table public.exhibitor_requests enable row level security;
create policy "exh_req select own" on public.exhibitor_requests for select using (profile_id = public.current_profile_id());
create policy "exh_req insert own pending" on public.exhibitor_requests for insert with check (profile_id = public.current_profile_id() and status = 'pending');
create policy "exh_req admin all" on public.exhibitor_requests for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));

create or replace function public.handle_exhibitor_request_approved()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_auth_user_id uuid;
begin
  if new.status = 'approved' and (old.status is distinct from 'approved') then
    select auth_user_id into v_auth_user_id from public.profiles where id = new.profile_id;
    if v_auth_user_id is not null then
      insert into public.user_roles (user_id, role) values (v_auth_user_id, 'exhibitor'::app_role)
      on conflict (user_id, role) do nothing;
    end if;
    insert into public.exhibitor_profiles (profile_id) values (new.profile_id)
    on conflict (profile_id) do nothing;
  end if;
  return new;
end;
$$;
create trigger trg_exhibitor_request_approved
after update on public.exhibitor_requests
for each row execute function public.handle_exhibitor_request_approved();

create or replace function public.onboard_company(
  p_trade_name text, p_country_code text, p_city text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_profile_id uuid; v_company_id uuid; v_existing_company uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_trade_name is null or length(btrim(p_trade_name)) = 0 then raise exception 'trade_name required'; end if;
  if p_country_code is null or length(btrim(p_country_code)) = 0 then raise exception 'country_code required'; end if;
  select id, company_id into v_profile_id, v_existing_company
  from public.profiles where auth_user_id = auth.uid() for update;
  if v_profile_id is null then raise exception 'Profile not found'; end if;
  if v_existing_company is not null then return v_existing_company; end if;
  insert into public.companies (trade_name, country_code, city)
  values (btrim(p_trade_name), btrim(p_country_code), nullif(btrim(coalesce(p_city, '')), ''))
  returning id into v_company_id;
  update public.profiles set company_id = v_company_id where id = v_profile_id;
  return v_company_id;
end;
$$;
revoke all on function public.onboard_company(text, text, text) from public;
grant execute on function public.onboard_company(text, text, text) to authenticated;

create or replace function public.complete_buyer_signup(p_payload jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_profile_id uuid; v_company_id uuid; v_existing_company uuid; v_lang app_language;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if coalesce(btrim(p_payload->>'trade_name'), '') = '' then raise exception 'trade_name required'; end if;
  if coalesce(btrim(p_payload->>'city'), '') = '' then raise exception 'city required'; end if;
  if coalesce(btrim(p_payload->>'state_code'), '') = '' then raise exception 'state_code required'; end if;
  if coalesce(btrim(p_payload->>'full_name'), '') = '' then raise exception 'full_name required'; end if;
  if (p_payload->>'consent_data_sharing')::boolean is not true then raise exception 'consent_data_sharing required'; end if;
  v_lang := case when (p_payload->>'preferred_language') = 'es' then 'es'::app_language else 'pt-BR'::app_language end;
  select id, company_id into v_profile_id, v_existing_company
  from public.profiles where auth_user_id = auth.uid() for update;
  if v_profile_id is null then raise exception 'Profile not found'; end if;
  if v_existing_company is null then
    insert into public.companies (trade_name, legal_name, tax_id, country_code, state_code, city, website, instagram, linkedin)
    values (
      btrim(p_payload->>'trade_name'),
      nullif(btrim(coalesce(p_payload->>'legal_name','')), ''),
      nullif(btrim(coalesce(p_payload->>'tax_id','')), ''),
      'BR', upper(btrim(p_payload->>'state_code')), btrim(p_payload->>'city'),
      nullif(btrim(coalesce(p_payload->>'website','')), ''),
      nullif(btrim(coalesce(p_payload->>'instagram','')), ''),
      nullif(btrim(coalesce(p_payload->>'linkedin','')), '')
    ) returning id into v_company_id;
  else
    v_company_id := v_existing_company;
    update public.companies set
      trade_name = btrim(p_payload->>'trade_name'),
      legal_name = nullif(btrim(coalesce(p_payload->>'legal_name','')), ''),
      tax_id = nullif(btrim(coalesce(p_payload->>'tax_id','')), ''),
      country_code = 'BR', state_code = upper(btrim(p_payload->>'state_code')),
      city = btrim(p_payload->>'city'),
      website = nullif(btrim(coalesce(p_payload->>'website','')), ''),
      instagram = nullif(btrim(coalesce(p_payload->>'instagram','')), ''),
      linkedin = nullif(btrim(coalesce(p_payload->>'linkedin','')), '')
    where id = v_company_id;
  end if;
  update public.profiles set
    full_name = btrim(p_payload->>'full_name'),
    job_title = nullif(btrim(coalesce(p_payload->>'job_title','')), ''),
    phone = nullif(btrim(coalesce(p_payload->>'phone','')), ''),
    whatsapp = nullif(btrim(coalesce(p_payload->>'whatsapp','')), ''),
    preferred_language = v_lang, company_id = v_company_id
  where id = v_profile_id;
  insert into public.visitor_profiles (
    profile_id, buyer_type, interests_segments, interests_destinations,
    interests_destinations_free, interests_services, demand_profile, notes,
    portfolio_pt, portfolio_es, consent_data_sharing, consent_data_sharing_at, consent_marketing
  ) values (
    v_profile_id,
    nullif(btrim(coalesce(p_payload->>'buyer_type','')), ''),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload->'interests_segments','[]'::jsonb))), '{}'),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload->'interests_destinations','[]'::jsonb))), '{}'),
    nullif(btrim(coalesce(p_payload->>'interests_destinations_free','')), ''),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload->'interests_services','[]'::jsonb))), '{}'),
    nullif(btrim(coalesce(p_payload->>'demand_profile','')), ''),
    nullif(btrim(coalesce(p_payload->>'notes','')), ''),
    nullif(btrim(coalesce(p_payload->>'portfolio_pt','')), ''),
    nullif(btrim(coalesce(p_payload->>'portfolio_es','')), ''),
    true, now(), coalesce((p_payload->>'consent_marketing')::boolean, false)
  )
  on conflict (profile_id) do update set
    buyer_type = excluded.buyer_type,
    interests_segments = excluded.interests_segments,
    interests_destinations = excluded.interests_destinations,
    interests_destinations_free = excluded.interests_destinations_free,
    interests_services = excluded.interests_services,
    demand_profile = excluded.demand_profile,
    notes = excluded.notes,
    portfolio_pt = excluded.portfolio_pt,
    portfolio_es = excluded.portfolio_es,
    consent_data_sharing = true,
    consent_data_sharing_at = now(),
    consent_marketing = excluded.consent_marketing;
  return v_company_id;
end;
$$;
grant execute on function public.complete_buyer_signup(jsonb) to authenticated;

revoke select (phone, whatsapp) on public.profiles from authenticated;
revoke select (phone, whatsapp) on public.profiles from anon;
