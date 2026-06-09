## Diagnóstico — papéis atuais do staff

Hoje, embora o nome sugira "admin estrito", praticamente todas as `assertAdmin(...)` no servidor aceitam tanto `admin` quanto `staff`. Resultado: o staff tem, de fato, quase os mesmos poderes do admin.

**O que o staff consegue fazer hoje (indevidamente):**

- `admin.functions.ts` — atribuir expositor a mesa, reconstruir slots, criar/editar/excluir mesas, buscar e editar empresas (full edit), `setUserRole`.
- `admin-auth.functions.ts` — criar usuário confirmado, redefinir senha, atualizar perfil, vincular empresa, listar usuários, definir papel primário (exceto promover a admin).
- `exhibitor-requests.functions.ts` — listar e aprovar/rejeitar solicitações de expositor.
- `email-admin.functions.ts` / `email-templates.functions.ts` — disparar e-mail de teste e editar templates.
- `pipeline.functions.ts` — atualizar entradas, atribuir owner, completar próximas ações.
- `staff.functions.ts` → `setStaffTableAssignment` é admin-only (correto), mas o resto do painel admin está aberto.

Na UI (`/admin`), o branch `isStaffOnly` já restringe as abas para **Dashboard, Agenda de mesa, Check-in, Usuários** — mas as abas Check-in e Usuários expõem ações de escrita (criar usuário, redefinir senha, mudar papel, check-in geral), e o backend não bloqueia, então um staff técnico ainda consegue chamar qualquer endpoint admin via DevTools.

## O que o staff DEVE poder fazer (pedido)

1. **Visualizar agendas** — agenda por mesa / por participante (somente leitura).
2. **Visualizar empresas cadastradas** — expositores e visitantes (somente leitura, sem edição).
3. **Exportar lista de inscritos** em **XLSX e CSV**.
4. **Exportar a agenda de cada inscrito em PDF** (reaproveitar `buildAgendaPdf`).

Sem direito a: gerenciar usuários, papéis, empresas (edição), mesas, slots, pipeline, solicitações de expositor, templates de e-mail, envios de teste, check-in, auditoria, atribuições de staff.

## Plano de implementação

### 1. Reforçar autorização no backend (corrigir o bug)

Renomear/refatorar todas as `assertAdmin(...)` que hoje aceitam staff para serem realmente **admin-only**, mantendo `assertAdminOrStaff` apenas onde leitura compartilhada faz sentido.

- `src/lib/admin.functions.ts` — `assertAdmin` passa a checar somente `'admin'`. Manter `assertAdminStrict` (já correto) ou consolidar em uma única função.
  - Endpoints somente-leitura que o staff precisa (`adminSearchProfiles`, `listAdminCompanies`, `getCompanyForEdit` em modo leitura) ganham um novo `assertAdminOrStaffReadOnly`.
  - `getCompanyForEdit` para staff retorna a empresa, mas a UI esconde o botão "Salvar"; `updateCompanyFull` permanece admin-only.
- `src/lib/admin-auth.functions.ts` — todas as funções viram admin-only (incluir `adminListUsers` se quiser proibir staff de ver a lista de usuários; **decisão**: bloquear, pois não está no escopo).
- `src/lib/exhibitor-requests.functions.ts` — `listExhibitorRequests` e `reviewExhibitorRequest` viram admin-only.
- `src/lib/email-admin.functions.ts` e `src/lib/email-templates.functions.ts` — admin-only.
- `src/lib/pipeline.functions.ts` — as funções de escrita (`updatePipelineEntry`, `assignPipelineOwner`, `completeNextAction`) viram admin-only; as de leitura (`listPipeline`, `getPipelineKpis`, `getPipelineAlerts`, `listFollowUps`, `listStaffOwners`) continuam admin-or-staff.
- `src/lib/staff.functions.ts` — `getMyStaffAgenda` segue admin-or-staff; `setStaffTableAssignment` e `listStaffOptions` ficam admin-only (já são).
- `src/lib/checkin.functions.ts` — `generalCheckIn` vira admin-only (staff não faz check-in conforme pedido).

### 2. Reformular a UI `/admin` para o staff

Abas do branch `isStaffOnly` passam a ser **apenas leitura + exports**:

- **Agendas** — abas internas:
  - "Por mesa" (reaproveita `StaffAgendaTab` em modo somente-leitura, sem botões de check-in).
  - "Geral do evento" — lista todas as reuniões do evento, ordenadas por horário, filtros por mesa/empresa.
  - Botão **"Exportar PDF da agenda"** ao lado de cada participante (expositor ou visitante).
- **Empresas** — reaproveita `CompaniesTab` em modo somente-leitura: remove botão "Editar", mantém busca/filtro por papel (expositor/visitante).
- **Inscritos** — nova aba com:
  - Lista paginada de profiles + empresa + papel + e-mail.
  - Botões **"Exportar XLSX"** e **"Exportar CSV"** (export do conjunto filtrado completo, não só da página).
  - Botão **"Baixar agenda (PDF)"** por linha.

Remover do staff as abas Check-in e Usuários atuais. A aba Dashboard (Pipeline) permanece em modo leitura (esconder ações de escrita do `PipelineDashboard`).

### 3. Novas funções de servidor para exports

Em `src/lib/staff-exports.functions.ts` (novo), todas com `assertAdminOrStaff`:

- `listEventRegistrants({ eventId?, role?, search? })` — retorna `[{ profile_id, full_name, email, role, company_trade_name, company_legal_name, document_id, city, state, country, status, registered_at }]` para exibição e export.
- `getParticipantAgenda({ profileId, eventId? })` — retorna linhas `{ time, withName, table, location }` no formato consumido por `buildAgendaPdf`.

A renderização XLSX/CSV/PDF acontece no cliente (XLSX via `xlsx`/`sheetjs` ou `exceljs`; CSV via string simples; PDF via `buildAgendaPdf` existente). Adicionar dependência: `xlsx` (SheetJS Community).

### 4. Políticas RLS

Revisar políticas que usam `is_admin_or_staff(...)` para escrita (ex.: `companies update admin`, `event_tables admin all`, `meetings admin all`, `outcomes admin all`, etc.). Como toda escrita ocorre via server functions com service role, a RLS é defesa em profundidade — mas conceitualmente também deveria ser admin-only. **Decisão recomendada**: criar uma função `is_admin(_user_id uuid)` (admin estrito) e substituir nas policies de **escrita** em tabelas que o staff não deve modificar. Manter `is_admin_or_staff` apenas em policies de **leitura** (`profiles`, `companies`, `events`, `event_tables`, `time_slots`, `meetings`, `audit_logs` selects).

Migração nova (sem editar a existente) com:

```sql
create or replace function public.is_admin(_user_id uuid) ...
-- drop + recreate das policies de escrita afetadas, trocando is_admin_or_staff por is_admin
```

### 5. i18n

Novas chaves em `pt-BR.json` e `es.json`: `admin.tabs.registrants`, `admin.registrants.exportXlsx`, `admin.registrants.exportCsv`, `admin.registrants.downloadAgenda`, etc.

## Detalhes técnicos

**Arquivos alterados:**

- `src/lib/admin.functions.ts`, `src/lib/admin-auth.functions.ts`, `src/lib/exhibitor-requests.functions.ts`, `src/lib/email-admin.functions.ts`, `src/lib/email-templates.functions.ts`, `src/lib/pipeline.functions.ts`, `src/lib/checkin.functions.ts`, `src/lib/staff.functions.ts` — endurecer asserts.
- `src/routes/_authenticated/admin.tsx` — reescrever bloco `isStaffOnly` com novas abas; passar prop `readOnly` para `CompaniesTab` e `PipelineDashboard`.
- `src/components/admin/companies/companies-tab.tsx` — aceitar `readOnly` (esconder "Editar").
- `src/components/admin/pipeline/pipeline-tabs.tsx` — propagar `readOnly` (já tem `isAdmin`).
- Novos: `src/lib/staff-exports.functions.ts`, `src/components/admin/registrants-tab.tsx`, `src/components/admin/staff/agenda-readonly-tab.tsx`, `src/lib/exports/xlsx.ts`, `src/lib/exports/csv.ts`.
- `supabase/migrations/<ts>_admin_only_writes.sql` — função `is_admin` + recriação de policies de escrita.

**Dependências:** adicionar `xlsx` (SheetJS).

**Sem mudança de papéis no DB** — `app_role` continua `('admin','staff','exhibitor','visitor')`.

## Pontos a confirmar

1. **Pipeline**: o staff continua vendo o Dashboard de pipeline em **somente leitura**, ok? (ou tira a aba?)
2. **Check-in**: confirmando — staff **não** faz check-in geral nem por reunião, certo?
3. **Lista de "inscritos"**: o XLSX/CSV inclui **todos os perfis** (visitantes + expositores) do evento atual, ou separa em duas exportações?
4. **Agenda em PDF**: gerar PDF a partir do botão por linha (1 PDF por participante) e também um botão "exportar todas as agendas em um ZIP"? (posso deixar só por linha na v1).
