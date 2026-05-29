
-- ============================================================
-- Extensions
-- ============================================================
create extension if not exists pgcrypto;
create extension if not exists citext;

-- ============================================================
-- Enums (criados com todos os valores upfront para evitar ALTER TYPE em transação)
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
  notes text
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
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  );
$$;

create or replace function public.is_admin_or_staff(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role in ('admin','staff')
  );
$$;

create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.profiles where auth_user_id = auth.uid() limit 1;
$$;

-- ============================================================
-- Anti-conflict trigger for meetings
-- ============================================================
create or replace function public.enforce_meeting_no_conflict()
returns trigger
language plpgsql
as $$
begin
  if new.status <> 'scheduled' then
    return new;
  end if;
  if exists (
    select 1 from public.meetings m
    where m.table_id = new.table_id and m.slot_id = new.slot_id
      and m.status = 'scheduled'
      and (tg_op = 'INSERT' or m.id <> new.id)
  ) then
    raise exception 'Conflito de agenda: esta mesa já possui uma reunião agendada neste horário.' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.meetings m
    where m.visitor_profile_id = new.visitor_profile_id and m.slot_id = new.slot_id
      and m.status = 'scheduled'
      and (tg_op = 'INSERT' or m.id <> new.id)
  ) then
    raise exception 'Conflito de agenda: este visitante já possui uma reunião agendada neste horário.' using errcode = '23505';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_meetings_no_conflict on public.meetings;
create trigger trg_meetings_no_conflict
before insert or update of table_id, slot_id, visitor_profile_id, status on public.meetings
for each row execute function public.enforce_meeting_no_conflict();

-- ============================================================
-- Auto-create profile + default role on signup
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full_name text;
  v_lang app_language;
begin
  v_full_name := coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1));
  v_lang := case
    when (new.raw_user_meta_data->>'preferred_language') = 'es' then 'es'::app_language
    else 'pt-BR'::app_language
  end;

  insert into public.profiles (auth_user_id, full_name, email, preferred_language)
  values (new.id, v_full_name, new.email, v_lang)
  on conflict (auth_user_id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'visitor')
  on conflict (user_id, role) do nothing;

  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ============================================================
-- Slot generation function
-- ============================================================
create or replace function public.rebuild_event_time_slots(
  p_event_id uuid,
  p_deactivate_previous boolean default true
) returns uuid
language plpgsql
as $$
declare
  v_event public.events%rowtype;
  v_generation_id uuid := gen_random_uuid();
  v_slot_interval interval;
begin
  select * into v_event from public.events where id = p_event_id;
  if not found then raise exception 'Evento não encontrado: %', p_event_id; end if;
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
      v_event.meetings_end - v_slot_interval,
      v_slot_interval
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
grant select, insert, update, delete on public.profiles, public.exhibitor_profiles, public.visitor_profiles to authenticated;
grant select on public.user_roles to authenticated;
grant select, insert, update, delete on public.meetings, public.meeting_outcomes, public.meeting_checkins, public.general_checkins to authenticated;
grant select on public.meeting_reschedules, public.audit_logs to authenticated;
grant select, update on public.notifications to authenticated;
grant select on public.email_delivery_logs to authenticated;
grant insert, update, delete on public.companies, public.events, public.event_tables, public.time_slots to authenticated;

grant all on all tables in schema public to service_role;

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

-- PROFILES
create policy "profiles select own" on public.profiles for select using (auth_user_id = auth.uid());
create policy "profiles select all authenticated" on public.profiles for select to authenticated using (true);
create policy "profiles update own" on public.profiles for update using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());
create policy "profiles insert own" on public.profiles for insert with check (auth_user_id = auth.uid());
create policy "profiles admin all" on public.profiles for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));

-- USER_ROLES (somente leitura para o próprio + admin)
create policy "user_roles select own" on public.user_roles for select using (user_id = auth.uid());
create policy "user_roles admin all" on public.user_roles for all using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

-- COMPANIES (todas as empresas são visíveis para autenticados; criação livre)
create policy "companies select auth" on public.companies for select to authenticated using (true);
create policy "companies insert auth" on public.companies for insert to authenticated with check (true);
create policy "companies update admin" on public.companies for update using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));
create policy "companies delete admin" on public.companies for delete using (public.is_admin_or_staff(auth.uid()));

-- EXHIBITOR_PROFILES
create policy "exh select auth" on public.exhibitor_profiles for select to authenticated using (true);
create policy "exh insert own" on public.exhibitor_profiles for insert with check (profile_id = public.current_profile_id());
create policy "exh update own" on public.exhibitor_profiles for update using (profile_id = public.current_profile_id()) with check (profile_id = public.current_profile_id());
create policy "exh admin all" on public.exhibitor_profiles for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));

-- VISITOR_PROFILES
create policy "vis select own" on public.visitor_profiles for select using (profile_id = public.current_profile_id());
create policy "vis insert own" on public.visitor_profiles for insert with check (profile_id = public.current_profile_id());
create policy "vis update own" on public.visitor_profiles for update using (profile_id = public.current_profile_id()) with check (profile_id = public.current_profile_id());
create policy "vis admin all" on public.visitor_profiles for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));

-- EVENTS / EVENT_TABLES / TIME_SLOTS (todos veem; admin/staff escreve)
create policy "events select all" on public.events for select using (true);
create policy "events admin all" on public.events for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));

create policy "event_tables select all" on public.event_tables for select using (true);
create policy "event_tables admin all" on public.event_tables for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));

create policy "time_slots select all" on public.time_slots for select using (true);
create policy "time_slots admin all" on public.time_slots for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));

-- MEETINGS
create policy "meetings select visitor own" on public.meetings for select using (visitor_profile_id = public.current_profile_id());
create policy "meetings select exhibitor table" on public.meetings for select using (
  exists (select 1 from public.event_tables et where et.id = meetings.table_id and et.exhibitor_profile_id = public.current_profile_id())
);
create policy "meetings select admin" on public.meetings for select using (public.is_admin_or_staff(auth.uid()));
create policy "meetings insert visitor" on public.meetings for insert with check (visitor_profile_id = public.current_profile_id());
create policy "meetings update visitor own" on public.meetings for update using (visitor_profile_id = public.current_profile_id()) with check (visitor_profile_id = public.current_profile_id());
create policy "meetings admin all" on public.meetings for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));

-- MEETING_RESCHEDULES (apenas admin/staff)
create policy "resch admin all" on public.meeting_reschedules for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));

-- GENERAL_CHECKINS
create policy "gen_checkins select own" on public.general_checkins for select using (profile_id = public.current_profile_id());
create policy "gen_checkins admin all" on public.general_checkins for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));

-- MEETING_CHECKINS
create policy "meeting_checkins select participant" on public.meeting_checkins for select using (
  exists (
    select 1 from public.meetings m where m.id = meeting_checkins.meeting_id
    and (
      m.visitor_profile_id = public.current_profile_id()
      or exists (select 1 from public.event_tables et where et.id = m.table_id and et.exhibitor_profile_id = public.current_profile_id())
    )
  )
);
create policy "meeting_checkins admin all" on public.meeting_checkins for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));

-- MEETING_OUTCOMES
create policy "outcomes select participant" on public.meeting_outcomes for select using (
  exists (
    select 1 from public.meetings m where m.id = meeting_outcomes.meeting_id
    and (
      m.visitor_profile_id = public.current_profile_id()
      or exists (select 1 from public.event_tables et where et.id = m.table_id and et.exhibitor_profile_id = public.current_profile_id())
    )
  )
);
create policy "outcomes insert exhibitor" on public.meeting_outcomes for insert with check (
  exists (
    select 1 from public.meetings m join public.event_tables et on et.id = m.table_id
    where m.id = meeting_outcomes.meeting_id and et.exhibitor_profile_id = public.current_profile_id()
  )
);
create policy "outcomes admin all" on public.meeting_outcomes for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));

-- AUDIT_LOGS (apenas admin/staff)
create policy "audit admin all" on public.audit_logs for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));

-- NOTIFICATIONS
create policy "notif select own" on public.notifications for select using (recipient_profile_id = public.current_profile_id());
create policy "notif update own" on public.notifications for update using (recipient_profile_id = public.current_profile_id()) with check (recipient_profile_id = public.current_profile_id());
create policy "notif admin all" on public.notifications for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));

-- EMAIL_DELIVERY_LOGS (apenas admin/staff)
create policy "email_logs admin all" on public.email_delivery_logs for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));

-- ============================================================
-- Seed: evento + 10 mesas + slots
-- ============================================================
do $$
declare
  v_event_id uuid;
  v_tz text := 'America/Sao_Paulo';
  i int;
begin
  if not exists (select 1 from public.events where name = 'Rodada Peru 2026') then
    insert into public.events (
      name, event_date,
      meetings_start, meetings_end,
      lunch_start, lunch_end,
      meetings2_start, meetings2_end,
      slot_minutes, tables_count, capacity_target, language_default
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
      insert into public.event_tables (event_id, table_number, table_label)
      values (v_event_id, i, 'Mesa ' || i);
    end loop;

    perform public.rebuild_event_time_slots(v_event_id, false);
  end if;
end $$;
