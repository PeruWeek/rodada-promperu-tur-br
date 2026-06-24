## Objetivo
Quando o último usuário ativo de uma empresa for excluído ou desativado, a empresa não deve ser apagada — apenas marcada como **inativa/órfã**, sem aparecer no catálogo nem na operação normal do admin. Dados ficam preservados para histórico, auditoria e reativação. Exclusão definitiva só em fluxo separado.

## Situação atual
- `companies` não possui flag de atividade. `profiles.is_active` existe; `profiles.auth_user_id` é `ON DELETE CASCADE`, então excluir o auth user remove o profile e a empresa permanece.
- `adminDeleteUser` (`src/lib/admin-auth.functions.ts`) e `adminUpdateUserProfile` (toggle `is_active`) não tocam na empresa hoje. Não há rotina que apague a empresa automaticamente, mas também não há regra de "ocultar quando órfã".
- `listAdminCompanies` (`src/lib/admin.functions.ts`) e demais leituras retornam todas as empresas, ativas ou não.

## Mudanças

### 1) Schema (migration)
- `public.companies` ganha:
  - `is_active boolean NOT NULL DEFAULT true`
  - `inactivated_at timestamptz NULL`
  - `inactivated_reason text NULL` (`'no_active_users'` | `'admin_manual'`)
- Backfill: tudo começa `is_active = true`; em seguida, empresas sem profile ativo (`is_active=true AND pending_signup=false`) viram `is_active=false`, `inactivated_reason='no_active_users'`, `inactivated_at=now()`.
- Índice parcial em `companies(is_active) WHERE is_active = true`.

### 2) Regra automática (função + trigger)
Função `public.recalc_company_active(p_company_id uuid)` — SECURITY DEFINER, `SET search_path = public`:
- Se `p_company_id IS NULL` → retorna.
- Conta profiles com `company_id = p_company_id AND is_active = true AND pending_signup = false`.
- Contagem > 0 e empresa inativa por `no_active_users` → reativa (`is_active=true`, zera `inactivated_at` e `inactivated_reason`).
- Contagem = 0 e empresa ativa → inativa (`is_active=false`, `inactivated_at=now()`, `inactivated_reason='no_active_users'`).
- Empresas com `inactivated_reason='admin_manual'` **nunca** são reativadas automaticamente.

Triggers em `public.profiles` (AFTER, FOR EACH ROW):
- INSERT → `recalc_company_active(NEW.company_id)`.
- DELETE → `recalc_company_active(OLD.company_id)`.
- UPDATE de `company_id` | `is_active` | `pending_signup` → recalcula `OLD.company_id` e `NEW.company_id`.

Resultado: excluir o auth user (cascade no profile) ou alternar `is_active` recalcula a empresa sem nunca apagá-la.

### 3) Backend — listagens e operações
- `listAdminCompanies`: incluir `is_active, inactivated_at, inactivated_reason` no select; aceitar novo param `status: 'active' | 'inactive' | 'all'` (default `'active'`). Aplicar o filtro também em `fetchAll` (export) e propagar ao componente.
- Demais leituras de empresas:
  - **Seleção/catálogo/operação** (`signup-availability`, `booking`, `table-agenda`, `exhibitor-requests`, `review-queue`, `qa-simulation`, `staff` quando lista empresas para nova ação): filtrar `is_active = true`.
  - **Lookup por id para hidratar nome em histórico** (`checkin`, `staff-exports`, `admin.tsx`, listagens via `.in("id", compIds)`): manter sem filtro — histórico precisa do nome mesmo se órfã.
- `public_exhibitor_catalog` (DB function): juntar `companies` com filtro `c.is_active = true` para o catálogo público.
- `adminDeleteUser` e `adminUpdateUserProfile`: nenhuma mudança de comportamento — trigger cuida. Apenas anotar no audit (`target_company_id` quando aplicável) para rastreio.

### 4) UI admin (`companies-tab.tsx` e auxiliares)
- Novo segmented/select de status: **Ativas (padrão) / Órfãs / Todas**, propagando ao server fn.
- Badge `Sem usuário ativo` nas órfãs (com tooltip mostrando `inactivated_at`).
- Botão **Reativar** aparece apenas em empresa inativa → chama `adminReactivateCompany`.
- Botão **Excluir definitivamente** aparece apenas em empresa órfã (dentro de `EditCompanyDrawer` ou no card), abre `AlertDialog` exigindo digitar o nome da empresa para confirmar → chama `adminHardDeleteCompany`.
- Diálogos de booking/seleção de empresas no admin não devem mostrar inativas (já cobrem o caso usando o filtro default).

### 5) Exclusão definitiva (`adminHardDeleteCompany`)
- Novo server fn em `src/lib/admin.functions.ts`.
- Exige `assertAdminStrict`.
- Valida: empresa existe, `is_active = false`, **e** zero profiles ativos vinculados.
- Exige `confirm: true` + `companyId` no input.
- Registra `audit('admin.company_hard_delete', ...)` com snapshot mínimo (id, trade_name) antes do delete.
- Executa `delete` em `companies`. FKs atuais: `company_event_pipeline` é `ON DELETE CASCADE` (apaga pipeline da empresa); `profiles.company_id` é `ON DELETE SET NULL` (preserva profiles históricos).

### 6) Reativação manual (`adminReactivateCompany`)
- Novo server fn em `src/lib/admin.functions.ts`.
- Exige `assertAdminStrict`.
- Input: `companyId`, `confirm: true`.
- Atualiza `is_active=true`, `inactivated_at=null`, `inactivated_reason=null` (funciona tanto para `no_active_users` quanto `admin_manual`).
- Registra `audit('admin.company_reactivated', ...)`.
- Não bloqueia reativar empresa sem profile ativo; o admin pode reativar para depois vincular usuário (a regra de auto-inativação volta a agir só se um profile ativo for criado e depois removido).

### 7) i18n (`pt-BR.json`, `es.json`)
Novas chaves em `admin.companies`:
- `statusActive`, `statusInactive`, `statusAll`, `statusFilterLabel`
- `orphanBadge` ("Sem usuário ativo" / "Sin usuario activo")
- `reactivate`, `reactivateConfirmTitle`, `reactivateConfirmBody`, `reactivateSuccess`
- `hardDelete`, `hardDeleteConfirmTitle`, `hardDeleteConfirmBody`, `hardDeleteTypeName`, `hardDeleteSuccess`, `hardDeleteBlocked`

## Critérios de aceite mapeados
- Excluir/inativar o último usuário ativo → trigger marca `is_active=false`; empresa **não** é apagada.
- Excluir/inativar usuário com outro ativo restante → empresa permanece ativa.
- Listagens default e catálogo operacional não mostram inativas.
- Histórico preservado: empresa segue no banco; lookups por id ainda resolvem o nome.
- Exclusão definitiva só via `adminHardDeleteCompany` em fluxo confirmado.
- Reativação automática só ocorre para `no_active_users`; `admin_manual` só por `adminReactivateCompany`.

## Fora de escopo
- Onboarding, auth e e-mail.
- Reescrita das RLS de `companies` (mantidas; filtro `is_active` aplicado nas queries de leitura).