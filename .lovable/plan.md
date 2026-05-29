# Módulo "Assistente do Evento" — Agentes, Skills e RAG

Adicionar ao projeto existente (TanStack Start + Supabase) um módulo de chat assistido por LLM via OpenRouter, com sistema de agentes configuráveis, skills (tools) que operam sobre os dados do evento e RAG restrito a admin/staff.

## 1. Banco de Dados (migration única)

**Extensão:** habilitar `vector` (pgvector).

**Novas tabelas (todas com RLS + GRANTs):**

- `agents` — `id`, `event_id`, `name`, `provider` (default `openrouter`), `base_url_mode` enum (`api`|`free`), `model`, `temperature`, `max_tokens`, `rag_enabled`, `is_default`, `is_active`, timestamps. RLS: SELECT autenticado, CUD apenas admin/staff.
- `skills` — `id`, `key` (único, ex. `get_event_info`), `name`, `description`, `params_schema` (jsonb), `scope` enum (`public`|`staff`), `is_active`. RLS: SELECT autenticado, CUD admin/staff. Seed com as 10 skills listadas.
- `agent_skills` — junção `agent_id` × `skill_id`. RLS: SELECT autenticado, CUD admin/staff.
- `user_llm_credentials` — `user_id` (PK), `provider`, `api_key_encrypted`, timestamps. RLS: apenas o próprio user (SELECT/INSERT/UPDATE/DELETE via `auth.uid()`). Chave nunca lida no frontend; leitura só via server function.
- `conversations` — `id`, `event_id`, `owner_profile_id`, `agent_id`, `title`, timestamps. RLS: dono + admin/staff.
- `conversation_messages` — `id`, `conversation_id`, `role` (`user`|`assistant`|`tool`|`system`), `content`, `tool_calls` jsonb, `tool_name`, created_at. RLS: herdada pela conversa.
- `rag_documents` — `id`, `event_id`, `title`, `source_url`, `mime`, `raw_text`, timestamps. RLS: SELECT/CUD apenas admin/staff.
- `rag_chunks` — `id`, `document_id`, `event_id`, `chunk_index`, `content`, `metadata` jsonb, `embedding vector(1024)`. RLS: apenas admin/staff. Índice IVFFlat cosine em `embedding` + índice em `event_id`.

**Função SQL:** `match_rag_chunks(p_event_id uuid, p_query vector(1024), p_top_k int)` retorna `id, content, metadata, similarity` (SECURITY DEFINER + check `is_admin_or_staff(auth.uid())`).

## 2. Server Functions / Routes (TanStack Start)

Toda interação com OpenRouter ocorre no servidor — chave nunca vai ao browser.

**Helper `src/lib/openrouter.server.ts`:**
- `getOpenRouterKey(userId)` → busca chave do usuário em `user_llm_credentials` (descriptografa); fallback para `process.env.OPENROUTER_API_KEY_APP`.
- `resolveBaseUrl(mode)` → `api` ou `free`.

**`src/lib/llm.functions.ts`** (createServerFn, middleware requireSupabaseAuth):
- `sendChatMessage({ conversationId, agentId, userMessage })`:
  1. Valida conversa pertence ao user.
  2. Carrega agente + skills habilitadas.
  3. Se `agent.rag_enabled` E user é admin/staff → chama `ragSearch` interno e injeta contexto como system message.
  4. Carrega histórico, monta `messages[]` + `tools[]` (skills convertidas para OpenAI tool format).
  5. Chama OpenRouter (`fetch` com base URL do agente).
  6. Se resposta contém `tool_calls` → executa skills (loop até max 5 passos) salvando mensagens `tool`.
  7. Persiste mensagens user/assistant/tool em `conversation_messages`.
  8. Retorna mensagens novas.
- `createConversation`, `listConversations`, `getConversation`.
- `saveUserCredential({ apiKey })`, `deleteUserCredential`, `hasUserCredential` (nunca retorna a chave).

**`src/lib/agents.functions.ts`** (admin/staff): CRUD `agents` + `agent_skills` + `duplicateAgent`, `listSkills`.

**`src/lib/rag.functions.ts`** (admin/staff apenas, checagem via `has_role`):
- `ragSearch({ eventId, query, topK })`: gera embedding via OpenRouter (`baai/bge-m3`) → chama `match_rag_chunks`.
- `ragIngestText({ eventId, title, text })`: chunking (~800 chars overlap 100) → embeddings batch → insert.
- `listRagDocuments`, `deleteRagDocument`.

**Skills (`src/lib/skills/`):** cada skill como `{ key, schema (zod), execute(ctx, args) }`. Registry central. `ctx` contém `supabase` autenticado + `profileId` + `role`. Skills `staff` checam role antes de executar. Implementar as 10 skills listadas usando as tabelas existentes (`events`, `companies`, `exhibitor_profiles`, `event_tables`, `meetings`, `meeting_checkins`, `meeting_outcomes`, `general_checkins`).

## 3. UI (rotas TanStack)

Seguir design system existente do projeto (paleta PromPerú já definida — `#D52B1E`, Source Sans 3). Não reinventar; reaproveitar componentes shadcn já presentes.

- **`/_authenticated/assistente`** — tela de chat. Lista lateral de conversas + janela principal. Admin/staff: seletor de agente no topo + badge "RAG ativo" quando aplicável. Visitor/exhibitor: usa agente default do evento, sem seletor, sem RAG. Renderiza mensagens com markdown e expõe tool-calls em accordion colapsado.
- **`/_authenticated/configuracoes/credenciais-llm`** — input mascarado (password), botões Salvar / Substituir / Remover. Mostra status "Usando chave pessoal" vs "Usando chave do app".
- **`/_authenticated/admin/agentes`** (admin/staff) — tabela CRUD, modal de edição com todos campos + multiselect de skills + toggle `rag_enabled` + toggle `is_default`.
- **`/_authenticated/admin/rag`** (admin/staff) — lista de `rag_documents`, formulário de ingestão por texto colado (MVP), botão deletar.

i18n PT-BR/ES em todas as telas.

## 4. Secrets necessários

- `OPENROUTER_API_KEY_APP` — chave fallback do app (será solicitada via add_secret).
- `LLM_CREDENTIAL_ENCRYPTION_KEY` — chave AES-256 para criptografar `api_key_encrypted` em repouso.

## 5. Seeds

- 10 skills no banco (`get_event_info`, `list_exhibitors`, `get_my_meetings`, `get_meeting_details`, `list_meetings_by_table`, `list_meetings_by_timeslot`, `mark_general_checkin`, `mark_meeting_checkin`, `mark_no_show`, `set_meeting_outcome`).
- 1 agente default por evento (modo `free`, modelo sugerido `meta-llama/llama-3.1-8b-instruct:free`, sem RAG, com skills públicas).

## 6. Critérios de aceite cobertos

- ✅ Modos `api` e `free` via `llm-proxy` server-side.
- ✅ Override por usuário + fallback env.
- ✅ Histórico de chat persistido em `conversations`/`conversation_messages`.
- ✅ RAG bloqueado no backend (server fn) + RLS (`admin`/`staff` apenas).
- ✅ Embeddings `baai/bge-m3` em `vector(1024)`.
- ✅ Chave nunca exposta ao frontend.

## Fora de escopo (MVP)

- Ingestão de PDF/URL (apenas texto colado).
- Streaming de tokens (resposta completa por request).
- Avaliação/feedback de mensagens.
- Function calling com aprovação humana.

## Ordem de execução

1. Migration (extensão + tabelas + RLS + GRANTs + função `match_rag_chunks` + seeds de skills).
2. Pedir secrets (`OPENROUTER_API_KEY_APP`, `LLM_CREDENTIAL_ENCRYPTION_KEY`).
3. Helpers server (openrouter, crypto, skills registry).
4. Server functions (agents, llm, rag, credentials).
5. UI: credenciais → agentes → RAG → assistente.
6. Seed do agente default + smoke test (chat simples, chat com tool, RAG search como admin).
