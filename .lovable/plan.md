## Diagnóstico

Estado atual da Denise no banco:

- `user_roles`: papel único `cliente` (legado)
- `exhibitor_profiles`: **não existia**
- `visitor_profiles`: linha antiga preservada
- `profiles.company_id`: preenchido

Causas raiz:

1. **Escrita incompleta em `user_roles`** — `setUserRole` (`src/lib/admin.functions.ts`) só faz `insert`/`delete` de uma linha. Não tratava a unicidade real do schema (`user_roles_user_id_unique` — uma linha por usuário) nem materializava `exhibitor_profiles`.
2. **Aprovação de expositor não promovia o papel** — `reviewExhibitorRequest` (`src/lib/exhibitor-requests.functions.ts`) só mudava `status` do request.
3. **`cliente` foi usado como papel principal**, mas é só rótulo de negócio. Tecnicamente equivale a `exhibitor`.
4. **Cache no cliente** — `useProfile` usa `staleTime` padrão e o listener em `__root.tsx` só invalida em SIGN_IN/SIGN_OUT/USER_UPDATED, então a UI só atualiza após relogin.

Confirmações de schema relevantes:

- `user_roles` tem `UNIQUE(user_id)` — **uma única linha por usuário**, então qualquer transição é, na prática, um upsert por `user_id`.
- Existe trigger `trg_ensure_exhibitor_profile` que materializa `exhibitor_profiles` quando o papel é `exhibitor` — a função vai redundar com `INSERT ... ON CONFLICT DO NOTHING` para garantir mesmo se o trigger for desligado.
- `audit_logs` tem só `actor_profile_id`, `action`, `payload`, `event_id`, `created_at`.

Já aplicado nesta etapa (banco):

- Migração 1 + 2: criada a função `public.transition_primary_role(p_auth_user_id uuid, p_target_role app_role)` — security definer, search_path travado, grant execute só para `service_role`, revoke de PUBLIC. Faz a transição atômica do papel principal (visitor/exhibitor), remove o legado `cliente` por `role::text`, upsert por `user_id`, garante `visitor_profiles`/`exhibitor_profiles` por `profile_id`, e grava auditoria.
- Correção pontual da Denise: papel agora é `exhibitor`, `exhibitor_profiles` criada, `visitor_profiles` preservada, `exhibitor_requests` pendente aprovada. Retorno da RPC confirma `before.roles=[cliente] → after.roles=[exhibitor]`, `has_exhibitor_profile=true`, `has_visitor_profile=true`.

## O que falta fazer (precisa de build mode)

### 1. `src/lib/admin.functions.ts`
- Nova server fn `transitionUserPrimaryRole` (admin-only):
  - Input: `{ userId: uuid, role: 'visitor' | 'exhibitor' }`.
  - Chama `supabaseAdmin.rpc('transition_primary_role', { p_auth_user_id, p_target_role })`.
  - Retorna payload da RPC.
- `setUserRole`: passar a rejeitar `role === 'cliente'` no zod enum. Mantém o restante como aditivo para casos legados de admin/staff.

### 2. `src/lib/exhibitor-requests.functions.ts`
- `reviewExhibitorRequest` ação `approve`:
  1. Resolve `profile_id` no request, depois `auth_user_id` em `profiles`.
  2. Chama `rpc('transition_primary_role', ..., 'exhibitor')`. Se falhar, **não** atualiza status — o admin pode tentar de novo.
  3. Só então atualiza `status='approved'`, `reviewed_by_profile_id`, `reviewed_at`, `review_note`.
- `reject`: continua só marcando status. Não toca em papéis.

### 3. `src/hooks/use-profile.ts`
- Adicionar à query do perfil: `staleTime: 0`, `refetchOnWindowFocus: true`, `refetchOnReconnect: true`.

### 4. Reflexão no admin (telas que disparam essas mutações)
- Em `src/routes/_authenticated/admin.tsx` (e qualquer caller das mutações acima), envolver com `useMutation` e invalidar no `onSuccess` as chaves: `["profile"]`, `["admin-users"]`, `["pipeline-list"]`, `["exhibitor-requests"]`. Hoje vários botões chamam o server fn direto no `onClick` — passamos a usar `useMutation` para garantir invalidação consistente.

### 5. Leitura de legado `cliente`
- Não remover as referências a `cliente` no código (há checks em `_authenticated.tsx`, `site-header.tsx`, `getPrimaryRole`, etc. usados por dashboards atuais). Para evitar regressão visual, manter a normalização **somente na leitura**: em `getPrimaryRole` (`src/hooks/use-profile.ts`), tratar `cliente` recebido do banco como `exhibitor` (mapeamento defensivo só na função de derivação de papel principal). Assim qualquer conta legada que ainda esteja com `cliente` no banco passa a ser refletida na UI como `exhibitor` sem precisar de migração massiva.

## Critérios de aceite

- Denise reflete `exhibitor` (já confirmado no banco; UI passa a refletir no próximo refetch/focus/relogin).
- Header, dashboard, guard de rota e profile respondem ao novo papel via `useProfile` reativo.
- Nenhuma escrita futura coloca um usuário em `cliente` (`setUserRole` rejeita e a RPC só aceita visitor/exhibitor).
- Contas legadas com `cliente` no banco são apresentadas como `exhibitor` pela normalização defensiva em `getPrimaryRole`.
- `admin` e `staff` continuam intocados pela RPC (a função só apaga `visitor`/`exhibitor`/`cliente`).
- `visitor` puro e `exhibitor` puro continuam funcionando — a RPC garante a linha de perfil correspondente sem destruir a outra.

## Resumo dos arquivos a tocar (após aprovar)

- `src/lib/admin.functions.ts` — `transitionUserPrimaryRole` + endurecimento de `setUserRole`.
- `src/lib/exhibitor-requests.functions.ts` — `reviewExhibitorRequest` aprova via RPC.
- `src/hooks/use-profile.ts` — `staleTime: 0`, `refetchOnWindowFocus`, `refetchOnReconnect`, normalização de `cliente` em `getPrimaryRole`.
- `src/routes/_authenticated/admin.tsx` (e callers) — envolver mutações em `useMutation` com invalidações.
