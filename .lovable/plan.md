# Visitante ↔ Expositor — plano final aprovado (pronto p/ implementar)

Incorpora as 2 recomendações finais.

## Recomendação 1 — `p_force` com motivo auditável

`admin_link_orphan_to_company` muda assinatura para exigir **motivo** quando força:

```
admin_link_orphan_to_company(
  p_profile_id   uuid,
  p_company_id   uuid,
  p_force        boolean default false,
  p_force_reason text    default null
)
```

Regras:
- Por padrão (`p_force=false`) a RPC **bloqueia** vínculo a qualquer empresa cujo conjunto de profiles vinculados contenha pelo menos 1 com role `visitor` e nenhum `exhibitor` → caso Krone (empresa do visitante) é **bloqueada por padrão**.
- Em "Misto" (tem visitor e exhibitor) também bloqueia por padrão; só prossegue com `p_force=true` + `p_force_reason` não vazio (mínimo 10 chars, trim).
- Se `p_force=true` e `p_force_reason` vazio/curto → `RAISE EXCEPTION 'force_reason_required'`.
- Audit log dedicado para o caminho forçado:
  - `action = 'exhibitor.orphan_linked_forced'`
  - `payload = { profile_id, company_id, detected_roles, force_reason, actor_profile_id }`
  - Caminho normal continua emitindo `exhibitor.orphan_linked`.

UI (`link-orphan-dialog.tsx`):
- Empresa "exhibitor pura" → botão verde "Vincular".
- Empresa "visitor pura" ou "misto" → botão fica **desabilitado** e aparece um bloco vermelho "Vínculo bloqueado por padrão". Um link discreto "Vincular mesmo assim (requer justificativa)" abre um sub-dialog que exige textarea de motivo (≥10 chars) + checkbox "Confirmo que esta operação é intencional". Só então habilita um botão "Vincular com justificativa" que envia `p_force=true, p_force_reason=<texto>`.
- Confirmação tripla: tag visual + bloqueio padrão + motivo obrigatório.

## Recomendação 2 — Ausência de evento ativo é comportamento explícito

`public.pipeline_active_event_id()` pode retornar `NULL` se a tabela `events` estiver vazia. Tratamento explícito:

- `public.public_exhibitor_catalog(_event_id uuid default NULL)`:
  - Resolve `v_event := COALESCE(_event_id, public.pipeline_active_event_id())`.
  - Se `v_event IS NULL` → `RAISE EXCEPTION 'no_active_event' USING HINT = 'Configure an active event in admin.';`. **Não** retorna conjunto vazio — assim o front detecta o caso e mostra estado distinto de "filtros sem resultado".
- `/explore` trata o erro `no_active_event` em estado próprio: card neutro "Evento não configurado. Avise o administrador." (separado do estado "nenhum resultado para os filtros"). Sem regressão silenciosa.
- `admin_list_unpublished_exhibitors()` idem: se não houver evento ativo, todos os expositores 1–5 são listados com `reason = 'no_active_event'`. O painel passa a sinalizar isso no topo com banner âmbar "Não há evento ativo configurado".
- `/explore` deixa a query rodar (não bloqueia o usuário antes), e a mensagem âmbar é mostrada no admin para incentivar a configuração.

---

## Resumo do que vai entrar (recap final)

### Migração `xxxx_exhibitor_catalog_and_orphans.sql`
Todas as funções abaixo: `SECURITY DEFINER` + `SET search_path = public`. Admin valida `is_admin_or_staff(auth.uid())` por dentro; `public_exhibitor_catalog` valida apenas `auth.uid() IS NOT NULL`.

1. `public_exhibitor_catalog(_event_id uuid default null)` — STABLE — raise `no_active_event` quando aplicável; JOIN `event_tables` (índice único garante 1 linha por expositor por evento); retorna só campos do card.
2. `admin_list_orphan_exhibitors()` — STABLE.
3. `admin_list_unpublished_exhibitors()` — STABLE — retorna `reason text` (`no_active_event` | `no_company` | `inactive` | `no_table` | `missing_role`).
4. `admin_link_orphan_to_company(p_profile_id, p_company_id, p_force, p_force_reason)` — VOLATILE — bloqueio padrão + motivo auditável.
5. `admin_create_company_for_orphan(p_profile_id, p_trade_name, p_country_code, p_city, p_legal_name, p_state_code)` — VOLATILE — transacional.
6. Backfill idempotente `exhibitor.orphan_detected` via `WHERE NOT EXISTS`.
7. GRANT EXECUTE TO authenticated em todas.

### ServerFns (`src/lib/admin.functions.ts`)
- Todas com `requireSupabaseAuth` + `context.supabase.rpc(...)` (sessão real do admin; `supabaseAdmin` não é usado).
- `listOrphanExhibitors`, `listUnpublishedExhibitors`, `linkOrphanToCompany` (aceita `force` + `forceReason`), `createCompanyForOrphan`, `searchCompaniesForLink` (devolve `role_hint`).

### Front
- `src/routes/_authenticated/explore.tsx` — `supabase.rpc('public_exhibitor_catalog')`; trata erro `no_active_event` em estado distinto; filtros client-side mantidos.
- `src/components/admin/companies/companies-tab.tsx` — monta painéis e badge "Publicado".
- `src/components/admin/companies/orphan-exhibitors-panel.tsx` (novo).
- `src/components/admin/companies/unpublished-exhibitors-panel.tsx` (novo) — banner âmbar quando `no_active_event`.
- `src/components/admin/companies/link-orphan-dialog.tsx` (novo) — bloqueio padrão + sub-dialog de justificativa.
- `src/lib/i18n/pt-BR.json` + `es.json` — novas chaves.

### Não muda
- Trigger `set_exhibitor_role_on_approval` — intacta.
- Booking, agendas, pipeline, auditoria — sem refactor.
- RLS de `exhibitor_profiles` — permanece restrita.

---

## Riscos cobertos

- **Vínculo acidental a empresa de visitante**: bloqueio por padrão + motivo obrigatório + audit log dedicado (`exhibitor.orphan_linked_forced`).
- **`/explore` vazio por falta de evento ativo**: erro explícito `no_active_event` + estado próprio no front + banner âmbar no admin.
- **Duplicidade no catálogo**: índice único `(event_id, exhibitor_profile_id)` + JOIN.
- **Duplicidade de audit log**: backfill com `NOT EXISTS`.
- **`search_path` injection**: `SET search_path = public` em todas as DEFINER.
- **Ambiguidade auth**: todas as RPCs admin rodam com sessão real do admin.
- **Sumiço silencioso por falta de mesa**: painel "não publicados" + badge "Publicado".

---

## Checklist de QA pós-publicação

1. Visitante logado em `/explore` vê expositores elegíveis. Krone ainda não.
2. Aba anônima → novo cadastro → `/explore` populado (regressão RLS curada).
3. `Admin > Empresas`: painel "Sem empresa" lista Krone; painel "Não publicados" lista quem tem empresa mas falta mesa.
4. Buscar "Krone" no link dialog: empresa do visitante aparece, botão padrão **bloqueado**. Abrir "Vincular mesmo assim", digitar motivo curto (<10) → bloqueado. Digitar motivo válido + checkbox → habilita → vincular gera `exhibitor.orphan_linked_forced` com `force_reason`.
5. Caminho recomendado: "Criar empresa nova" para Krone → audit `exhibitor.orphan_company_created` com `actor_profile_id` do admin.
6. Após empresa: Krone vai p/ "Não publicados" (sem mesa) → alocar mesa → badge "Publicado" verde → aparece em `/explore`.
7. Visitante agenda → reunião em `/agenda`, `/table-agenda`, admin/pipeline/auditoria.
8. Cancelar reflete em todos os pontos.
9. Reaplicar migração não duplica `exhibitor.orphan_detected`.
10. Apagar temporariamente o evento ativo (cenário de QA): `/explore` mostra "Evento não configurado"; admin mostra banner âmbar; ao restaurar, volta ao normal.
11. Fluxos não regredidos: login, signup, pré-cadastro+claim, telefone +55, CRUD de empresas/mesas.
