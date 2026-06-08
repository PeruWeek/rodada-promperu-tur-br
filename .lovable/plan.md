# Dashboard Operacional Admin/Staff

## Objetivo

Adicionar dentro de `/admin` uma dashboard com 4 abas novas (Visão Geral, Cadastros, Agendamentos, Follow-up) para `admin` e `staff` acompanharem o funil das empresas, com 3 dimensões independentes de status (cadastro, agendamento, próxima ação) e agrupamentos por tipo/categoria/localidade.

## 1. Modelagem Supabase

### Enums novos
- `company_role_pipeline`: `exhibitor`, `visitor`
- `registration_status`: `nao_iniciado`, `em_preenchimento`, `cadastro_concluido`, `aguardando_aprovacao`, `aprovado`, `bloqueado`
- `scheduling_status`: `sem_agendamento`, `agendamento_iniciado`, `agendado_parcial`, `agendado_ok`, `agenda_fechada`
- `next_action`: `nenhuma`, `ligar_para_confirmar`, `cobrar_documentos`, `aguardar_retorno`, `aprovar_cadastro`, `ajustar_perfil`, `estimular_agendamento`
- `priority_level`: `baixa`, `media`, `alta`
- `company_type`: `agencia`, `operadora`, `corporativo`, `organizadora`, `associacao`, `hotel`, `dmc`, `centro_de_convencoes`, `transporte`, `tecnologia_eventos`, `outro`
- `company_category`: `buyer_prioritario`, `buyer_secundario`, `fornecedor_mice`, `hotelaria`, `destino`, `parceiro_institucional`, `imprensa`, `outro`

### Tabela `company_event_pipeline` (uma linha por evento+empresa)
Colunas:
- `id`, `event_id` FK events, `company_id` FK companies, UNIQUE(event_id, company_id)
- `primary_profile_id` FK profiles
- `owner_staff_profile_id` FK profiles (nullable)
- `company_role` enum
- `company_type` enum (nullable)
- `company_category` enum (nullable)
- `country_code`, `state_code`, `city` (snapshot de companies)
- `region_label` text (derivado: "São Paulo", "Brasil Sudeste", "Peru Lima", "Internacional")
- `registration_status`, `scheduling_status`, `next_action`, `priority` enums
- `next_action_due_at`, `last_contact_at` timestamptz
- `last_contact_channel` text
- `notes` text
- `is_profile_complete` bool
- `created_at`, `updated_at`

### GRANTs + RLS
- GRANT SELECT/INSERT/UPDATE/DELETE para `authenticated`; ALL para `service_role`
- Policies (usando `is_admin_or_staff` e `has_role`):
  - SELECT: admin OU staff (staff vê tudo do evento — necessário para reatribuir carteira e gerar KPIs do escopo)
  - INSERT/UPDATE/DELETE: admin sempre; staff só onde `owner_staff_profile_id = current_profile_id()`
  - Edição de `owner_staff_profile_id`: apenas admin (enforced via trigger BEFORE UPDATE)

### Triggers
- `tg_pipeline_sync_company`: AFTER INSERT/UPDATE em `companies` — atualiza snapshot (`country_code`, `state_code`, `city`, `region_label`) em linhas correspondentes
- `tg_pipeline_ensure_row`: AFTER INSERT em `companies` OU AFTER UPDATE em `profiles.company_id` — cria linha em `company_event_pipeline` para o evento ativo, inferindo `company_role` por `user_roles` do primary profile
- `tg_pipeline_meetings_recalc`: AFTER INSERT/UPDATE/DELETE em `meetings` — recalcula `scheduling_status` (zero → `sem_agendamento`; <meta → `agendado_parcial`; ≥meta → `agendado_ok`). Meta: constante `EXPECTED_MEETINGS_MIN = 6` por enquanto
- `tg_pipeline_exhibitor_request`: AFTER INSERT/UPDATE em `exhibitor_requests` — `pending` → `aguardando_aprovacao`; `approved` → `aprovado`
- `tg_pipeline_updated_at`: BEFORE UPDATE

Função `derive_region_label(country, state, city)` em plpgsql para padronizar rótulos.

### View `v_company_event_pipeline`
JOIN pipeline + companies + profiles (primary + owner) + count(meetings) + flag exhibitor_request pendente + `buyer_type` / `segments` / `services` / `destinations` de visitor/exhibitor_profiles. Base única para listagens e KPIs (evita N+1).

### Backfill
Popular linhas para todas as empresas do único evento ativo (`d86be1b5-...`), inferindo `registration_status` por completude de campos obrigatórios, `scheduling_status` por contagem de meetings, demais campos manuais com defaults (`next_action = nenhuma`, `priority = media`).

## 2. Server functions (`src/lib/pipeline.functions.ts`)

Todas com `requireSupabaseAuth` + `is_admin_or_staff`:
- `listPipeline({ eventId, filters, page, pageSize })` — filtros: role, type, category, country/state/city, registration_status, scheduling_status, owner, period, search, mine
- `getPipelineKpis({ eventId, period, scope })` — agregações por dimensão (type, category, country, state, city, registration_status, scheduling_status, owner) + série temporal de cadastros
- `getPipelineAlerts({ eventId, scope })` — top 5 de cada alerta
- `listFollowUps({ eventId, mine, sort })`
- `updatePipelineEntry({ id, patch })` — staff só edita suas
- `assignOwner({ id, ownerStaffProfileId })` — admin only
- `completeNextAction({ id, nextAction, dueAt, notes, channel })` — atualiza `last_contact_at`/channel

## 3. UI — abas dentro de `/admin`

Reaproveita Tabs existente. Novas abas no topo: `Visão Geral`, `Cadastros`, `Agendamentos`, `Follow-up`. Abas atuais (Mesas, Agenda Staff, Check-in, Staff, Usuários, Solicitações, E-mails) permanecem.

Componentes em `src/components/admin/pipeline/`:

### Visão Geral
- 7 cards KPI (Total, Novos no período, Concluídos, Incompletos, Sem agendamento, Follow-up pendente, Aguardando aprovação)
- Seletor de período (7/30/90d/Todos)
- Gráficos com `recharts`: pizza por tipo, pizza por categoria, barras por país, barras por estado, barras por cidade (top 10), barras por registration_status, barras por scheduling_status, linha de evolução de cadastros, barras por responsável
- 4 listas de alertas (top 5 com link "abrir empresa")

### Cadastros
- Chips rápidos: Brasil, Peru, Agências, Operadoras, Corporativo, Hotéis, DMCs, Buyers prioritários, Sem agendamento, Follow-up vencido (aplicam filtros)
- Busca + filtros (papel, tipo, categoria, país, estado, cidade, status, responsável, período)
- Tabela paginada conforme spec

### Agendamentos
- Tabela com colunas spec + filtros por status, responsável, tipo, categoria, localidade

### Follow-up
- Lista ordenável por prioridade/vencimento
- Edição inline (próxima ação, vencimento, prioridade, responsável — responsável só admin)
- Botões: Concluir (abre dialog para próxima ação), Reagendar, Abrir empresa
- Toggle "Apenas meus" (default ON para staff, forçado por RLS de edição)

### RBAC na UI
- `useProfile().roles`: admin → tudo; staff → toggle "Meus" default, esconde controles admin-only (reatribuir owner, KPIs globais opcionais)

## 4. i18n
Novas chaves em `src/lib/i18n/pt-BR.json` e `es.json` sob `admin.pipeline.*` (labels de enums, colunas, KPIs, alertas, ações).

## 5. Detalhes técnicos
- Constante `EXPECTED_MEETINGS_MIN = 6` em `src/lib/pipeline.constants.ts`
- Tipos Supabase regenerados após migration
- Reuso de `Card`, `Tabs`, `Dialog`, `Select`, `Input`, `Badge`, `Skeleton` já presentes
- Sem alteração em `companies`, `profiles`, ou outras tabelas existentes

## Entregas

1. Migration única: enums + tabela + GRANTs + RLS + triggers + view + função de region_label + backfill
2. `src/lib/pipeline.functions.ts`
3. `src/lib/pipeline.constants.ts`
4. `src/components/admin/pipeline/` (4 abas + subcomponentes)
5. Integração em `src/routes/_authenticated/admin.tsx`
6. Chaves i18n PT/ES

## Fora de escopo desta entrega
- Configurar meta de reuniões por evento (constante por enquanto)
- Exportar CSV
- Notificações automáticas de follow-up vencido
- Edição de `company_type`/`company_category` por bulk import (UI permite editar por linha)
