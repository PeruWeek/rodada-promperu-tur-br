
-- pgvector extension
create extension if not exists vector;

-- Enums
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

-- ============================
-- agents
-- ============================
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

-- ============================
-- skills
-- ============================
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

-- ============================
-- agent_skills
-- ============================
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

-- ============================
-- user_llm_credentials
-- ============================
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

-- ============================
-- conversations
-- ============================
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

-- ============================
-- conversation_messages
-- ============================
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

-- ============================
-- rag_documents
-- ============================
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

-- ============================
-- rag_chunks
-- ============================
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
create index rag_chunks_embedding_idx on public.rag_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

grant select, insert, update, delete on public.rag_chunks to authenticated;
grant all on public.rag_chunks to service_role;
alter table public.rag_chunks enable row level security;

create policy "rag_chunks admin all" on public.rag_chunks for all using (public.is_admin_or_staff(auth.uid())) with check (public.is_admin_or_staff(auth.uid()));

-- ============================
-- match_rag_chunks RPC
-- ============================
create or replace function public.match_rag_chunks(
  p_event_id uuid,
  p_query vector(1024),
  p_top_k int default 5
)
returns table (id uuid, content text, metadata jsonb, similarity float)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin_or_staff(auth.uid()) then
    raise exception 'Forbidden';
  end if;
  return query
  select c.id, c.content, c.metadata, 1 - (c.embedding <=> p_query) as similarity
  from public.rag_chunks c
  where c.event_id = p_event_id and c.embedding is not null
  order by c.embedding <=> p_query
  limit p_top_k;
end;
$$;

-- ============================
-- Seed skills
-- ============================
insert into public.skills (key, name, description, params_schema, scope) values
  ('get_event_info', 'Obter informações do evento', 'Retorna nome, data, horários e configurações do evento.', '{"type":"object","properties":{"event_id":{"type":"string"}},"required":["event_id"]}'::jsonb, 'public'),
  ('list_exhibitors', 'Listar expositores', 'Lista expositores do evento com filtros opcionais.', '{"type":"object","properties":{"event_id":{"type":"string"},"query":{"type":"string"}},"required":["event_id"]}'::jsonb, 'public'),
  ('get_my_meetings', 'Minhas reuniões', 'Retorna as reuniões agendadas do usuário atual.', '{"type":"object","properties":{"event_id":{"type":"string"}},"required":["event_id"]}'::jsonb, 'public'),
  ('get_meeting_details', 'Detalhes de reunião', 'Retorna detalhes de uma reunião específica.', '{"type":"object","properties":{"meeting_id":{"type":"string"}},"required":["meeting_id"]}'::jsonb, 'public'),
  ('list_meetings_by_table', 'Reuniões por mesa', 'Lista reuniões de uma mesa.', '{"type":"object","properties":{"event_id":{"type":"string"},"table_id":{"type":"string"}},"required":["event_id","table_id"]}'::jsonb, 'staff'),
  ('list_meetings_by_timeslot', 'Reuniões por horário', 'Lista reuniões que começam em um horário.', '{"type":"object","properties":{"event_id":{"type":"string"},"start_at":{"type":"string"}},"required":["event_id","start_at"]}'::jsonb, 'staff'),
  ('mark_general_checkin', 'Check-in geral', 'Registra check-in geral de um participante no evento.', '{"type":"object","properties":{"event_id":{"type":"string"},"profile_id":{"type":"string"},"method":{"type":"string","enum":["qr","manual"]}},"required":["event_id","profile_id"]}'::jsonb, 'staff'),
  ('mark_meeting_checkin', 'Check-in de reunião', 'Registra check-in/no-show/late em uma reunião.', '{"type":"object","properties":{"meeting_id":{"type":"string"},"status":{"type":"string","enum":["present","no_show","late"]},"late_minutes":{"type":"number"}},"required":["meeting_id","status"]}'::jsonb, 'staff'),
  ('mark_no_show', 'Marcar no-show', 'Marca uma reunião como no-show.', '{"type":"object","properties":{"meeting_id":{"type":"string"}},"required":["meeting_id"]}'::jsonb, 'staff'),
  ('set_meeting_outcome', 'Resultado da reunião', 'Registra o resultado (hot/warm/cold) e notas de uma reunião.', '{"type":"object","properties":{"meeting_id":{"type":"string"},"outcome":{"type":"string","enum":["hot","warm","cold"]},"notes":{"type":"string"},"next_steps":{"type":"string"}},"required":["meeting_id","outcome"]}'::jsonb, 'staff')
on conflict (key) do nothing;
