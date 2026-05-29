## Objetivo

Implementar escolha de papel (Visitante × Expositor) no onboarding, com aprovação obrigatória de admin/staff para expositores. Garantir que nenhum usuário consiga se auto-promover.

## Observação importante sobre o schema atual

O projeto **não** usa `profiles.role`. Papéis ficam em `public.user_roles` (separado, padrão Lovable anti-recursão RLS). Todo o plano respeita esse padrão — "setar role" significa inserir em `user_roles`.

Hoje o `/onboarding` deixa o próprio usuário inserir `('user_id','exhibitor')` em `user_roles` (vulnerabilidade). Vamos remover isso e proteger via política RLS.

## 1. Migração de banco

**Nova tabela `public.exhibitor_requests`**
- `id uuid pk`, `profile_id uuid unique fk profiles(id) on delete cascade`
- `status text` check in (`pending`,`approved`,`rejected`) default `pending`
- `created_at`, `reviewed_by_profile_id`, `reviewed_at`, `review_note`
- GRANT select/insert para `authenticated`; ALL para `service_role`
- RLS:
  - `select own`: `profile_id = current_profile_id()`
  - `insert own`: idem, e `status = 'pending'`
  - `admin select/update all`: `is_admin_or_staff(auth.uid())`

**Trancar `user_roles` contra auto-promoção**
- Política `user_roles admin all` já existe. Hoje qualquer authenticated pode inserir porque o `onboarding.tsx` chama `.upsert({user_id, role:'exhibitor'})` direto e a tabela não tem política de INSERT para usuário comum — provavelmente está passando por uma policy permissiva. Vamos:
  - Verificar/garantir que só `has_role(auth.uid(),'admin')` pode INSERT/UPDATE/DELETE em `user_roles` (já é o caso pela policy `user_roles admin all`). Remover qualquer chamada cliente que insere em `user_roles`.

**Trigger de aprovação**
- `on update of exhibitor_requests` quando `status` muda para `approved`:
  - inserir `(profile.auth_user_id,'exhibitor')` em `user_roles` (ON CONFLICT DO NOTHING)
  - inserir linha em `exhibitor_profiles` se faltar
- Function `security definer`, search_path public.

## 2. Server functions (`src/lib/exhibitor-requests.functions.ts`)

- `requestExhibitorAccess()` — middleware auth; insere linha pending para o profile do usuário (idempotente). Recusa se já tem role `exhibitor`/`admin`/`staff`.
- `listExhibitorRequests({status?})` — admin only; retorna requests + profile + company.
- `reviewExhibitorRequest({id, action: 'approve'|'reject', note?})` — admin only; UPDATE status + reviewer + reviewed_at. O trigger cuida do role/exhibitor_profiles.

## 3. UI

### `/onboarding` (substituir lógica atual)
Dois cards mobile-first:
- **Visitante** → form com Empresa/País/Cidade (como hoje) → cria company + atualiza `profiles.company_id` + upsert `visitor_profiles` → redirect `/dashboard`.
- **Expositor (requer aprovação)** → form com Empresa/País/Cidade (Peru default) → cria company + `profiles.company_id` + chama `requestExhibitorAccess` → redirect `/pending-exhibitor`.

Remover o `supabase.from("user_roles").upsert(...)` do cliente.

### `/pending-exhibitor` (nova rota autenticada)
- Mostra status (`pending`/`rejected` com `review_note`).
- Se aprovado, redireciona para `/dashboard`.
- Botão "Sair".

### `/admin/exhibitor-requests` (nova, sob `_authenticated/admin`)
- Adicionar nova tab no `admin.tsx` "Solicitações" listando pending (com filtro all/pending/approved/rejected).
- Cada linha: nome, empresa, e-mail, data, botões Aprovar / Rejeitar (com nota opcional).

### Guards (`src/routes/_authenticated.tsx`)
Após `getUser()`, buscar profile + roles + onboarding state e redirecionar:
- sem `company_id` E sem request pending E não é admin/staff → `/onboarding`
- request pending → `/pending-exhibitor` (exceto se já está nela ou em `/profile`)
- role `exhibitor` sem mesa atribuída em `event_tables` → permite acesso mas dashboard mostra banner "Aguardando atribuição de mesa".

### Dashboard
- Banner condicional para expositor sem mesa.

### i18n
- Adicionar chaves em `pt-BR.json` e `es.json`: `onboarding.exhibitorPending`, `pendingExhibitor.*`, `admin.tabs.requests`, `admin.requests.*`, `dashboard.awaitingTable`.

### Signup
- Mantém genérico (nome/e-mail/senha). Sem mudança funcional.

## 4. Critérios de aceite

1. Novo signup → login → vai para `/onboarding`.
2. Escolhe Visitante → `visitor_profiles` criado, role permanece `visitor` (já criada pelo trigger `handle_new_user`), acessa `/dashboard`.
3. Escolhe Expositor → linha pending em `exhibitor_requests`, redirect `/pending-exhibitor`, **sem** role `exhibitor`.
4. Admin entra em `/admin` aba Solicitações → Aprova → trigger adiciona role `exhibitor` + linha `exhibitor_profiles`. Usuário ao recarregar vê área de expositor.
5. Tentativa de inserir manualmente em `user_roles` ou alterar `status='approved'` do client é bloqueada por RLS.

## Detalhes técnicos resumidos

```text
DB:
  exhibitor_requests (RLS própria + grants)
  trigger trg_exhibitor_request_approved → insert user_roles + exhibitor_profiles

Server fns:
  requestExhibitorAccess / listExhibitorRequests / reviewExhibitorRequest

Rotas:
  src/routes/onboarding.tsx           (reescrita)
  src/routes/_authenticated/pending-exhibitor.tsx   (nova)
  src/routes/_authenticated/admin.tsx (nova tab)

Guard:
  src/routes/_authenticated.tsx       (lógica de redirect por estado)
```

Confirma para eu implementar?
