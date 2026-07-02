## Causa raiz confirmada

A regressão está em `profiles.company_id` da Naline — **não** em `companies.trade_name/legal_name` e **não** no pipeline.

### Estado atual verificado

**Companies (rótulos corretos):**
| id | trade_name | legal_name | tax_id |
|---|---|---|---|
| `694245f4` | AQUARELA VIAGEM | COPASTUR TURISMO | (vazio) |
| `2429b47f` | COPASTUR TURISMO | COPASTUR VIAGENS E TURISMO LTDA | 43.637.214/0001-86 |

**Profiles:**
- `e0438f6c` Naline `naline.correia@aquarelagencia.com.br` → hoje em `2429b47f` ❌ (deveria estar em `694245f4`)
- `8ab580f6` Wellika `@copastur.com.br` → em `2429b47f` ✅
- `5d7b1826` Emerson e `83a23881` Midori `@aquarelagencia.com.br` → em `694245f4` ✅

**Pipeline (`company_event_pipeline` no evento ativo `d86be1b5`):** as duas empresas têm linhas próprias, sem cross-link nem resíduo.

### Qual fluxo permitiu religar a Naline (07-01 18:54)

Auditoria da janela `18:53–18:55` em 07-01:
- 1 evento `profile.company_linked` com `actor_profile_id = NULL`, `old = 694245f4`, `new = 2429b47f`
- 1 evento `pipeline.scheduling_status` derivado
- **Nenhum** evento `company_contact_reassigned`

Mapeamento dos writers de `profiles.company_id` no código (grep completo em `src/lib`):

| Fluxo | Arquivo | Reescreve company de perfil já vinculado? | Emite `company_contact_reassigned`? |
|---|---|---|---|
| `reassignCompanyContact` | `company-contacts.functions.ts:275` | Sim | **Sim, sempre** (linha 337) |
| `adminUpsertUserCompany` | `admin-auth.functions.ts:239` | Não — só atualiza `companies` do vínculo existente, ou vincula quando `company_id` é NULL | — |
| `resolveReviewLink` / `resolveReviewMerge` | `review-queue.functions.ts:228/301` | Só quando `!target.company_id` (`if (!target.company_id && rev.company_id)`) | — |
| `preRegistrationBulkImport` | `pre-registration.functions.ts:216` | Só quando `!existingProfile.company_id`; nunca sobrescreve perfil com `auth_user_id` | — |
| `approveExhibitorRequest` | `exhibitor-requests.functions.ts:142` | Cenário de aprovação de expositor (perfil sem company) | — |
| `staff-registration` bulk | `staff-registration.functions.ts:522` | Cenário de importação staff | — |
| `qa-simulation` | `qa-simulation.functions.ts:125` | Somente contas QA (`qa_run_id`) | — |

Conclusão: **nenhum fluxo operacional do app pode ter feito a religação de 07-01**, porque a única rota que reescreve `company_id` de um contato já vinculado é `reassignCompanyContact`, e ela sempre grava o par `company_contact_reassigned` no `audit_logs`. Esse par não existe.

**Origem real:** UPDATE direto no banco (SQL Editor / psql / migração ad-hoc) sobre `profiles.company_id`. Só isso dispara o trigger `trg_audit_profiles` (que emite `profile.company_linked`) sem gerar o audit operacional — e explica também o `actor_profile_id = NULL`.

## Correção

### 1. Dado (via `supabase--insert`)

```sql
UPDATE public.profiles
SET company_id = '694245f4-9ef4-464d-a595-1310694a9e6e'
WHERE id = 'e0438f6c-f8dd-4196-9c0f-4912f177611c'
  AND email = 'naline.correia@aquarelagencia.com.br'
  AND company_id = '2429b47f-827d-4f2e-9a6b-f971396a752c';

INSERT INTO public.audit_logs (actor_profile_id, action, payload)
VALUES (
  NULL,
  'company_contact_reassigned',
  jsonb_build_object(
    'email', 'naline.correia@aquarelagencia.com.br',
    'profile_id', 'e0438f6c-f8dd-4196-9c0f-4912f177611c',
    'previous_company_id', '2429b47f-827d-4f2e-9a6b-f971396a752c',
    'new_company_id', '694245f4-9ef4-464d-a595-1310694a9e6e',
    'reason', 'Reconciliação: Naline pertence à AQUARELA VIAGEM (694245f4). Regressão registrada em 2026-07-01 18:54 veio de UPDATE direto em banco — não do fluxo reassignCompanyContact.',
    'source', 'manual_reconciliation'
  )
);
```

Triggers cobrem o resto automaticamente:
- `trg_profiles_recalc_company` reavalia `companies.is_active` de `694245f4` e `2429b47f`.
- `trg_pipeline_after_profile_company` garante `pipeline_ensure_row(694245f4)`.
- `trg_meetings_recalc_company_scheduling` não é acionado (não mexe em meetings), mas `pipeline_recalc_scheduling` já reflete o estado correto (a linha `2429b47f` continua `agendado_ok` — Wellika mantém as reuniões da COPASTUR).

Sem alterações em `companies` (rótulos corretos) nem em `company_event_pipeline` (sem resíduo).

### 2. Prevenção operacional

- O código do app já protege este caminho: a única rota UI, `reassignCompanyContact`, exige `reason` (mínimo 10 chars via UI) e grava audit próprio. Nenhum ajuste de código é necessário.
- O que permitiu a regressão foi um UPDATE fora do app. Ficará documentado no `audit_logs` que qualquer futura mudança em `naline.correia@aquarelagencia.com.br` que a tire de `694245f4` é regressão — a entrada acima serve como marcador de decisão canônica.

### 3. Validação pós-aplicação

`SELECT` para confirmar:
- `naline.correia@aquarelagencia.com.br` → `company_id = 694245f4`
- `wellika.medeiros@copastur.com.br` → `company_id = 2429b47f`
- Emerson/Midori seguem em `694245f4`
- `694245f4.is_active` conforme cálculo do trigger
- Uma linha de pipeline por empresa no evento ativo

## Entrega ao final

1. **Causa raiz:** UPDATE direto em `profiles.company_id` em 2026-07-01 18:54, fora do fluxo `reassignCompanyContact` (sem `company_contact_reassigned`, `actor_profile_id = NULL`).
2. **Dados alterados:** 1 linha em `profiles` + 1 entrada em `audit_logs`. Nenhum arquivo de código.
3. **Resumo:** Naline volta para `694245f4` (AQUARELA VIAGEM). Rótulos e pipeline não precisam de correção.
4. **Como fica evitado:** UI já expõe apenas `reassignCompanyContact` (com motivo obrigatório e audit próprio). A entrada em `audit_logs` marca a decisão canônica para futuras investigações.
