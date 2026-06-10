## Objetivo

Resolver a inconsistência visual do pós-login do visitante (formulário "Entrar" continua visível mesmo autenticado), eliminar os erros residuais de console do admin (`502` / `TypeError: Failed to fetch`) e entregar a documentação técnica e o checklist de QA dos três perfis (admin, visitante, expositor).

---

## Bloco A — Visitante (correção de causa raiz)

### Diagnóstico

O bug "tela de Entrar continua aparecendo após login" tem três causas combinadas:

1. **`useAuth` inicializa com `loading: true`, mas o `SiteHeader` não bloqueia a renderização do conteúdo da rota.** O `/login` segue montado durante a transição assíncrona porque `navigate({ to: "/dashboard" })` no `onSubmit` do `LoginPage` só dispara depois que o React processa o `setLoading(false)`. Nesse intervalo, o formulário "Entrar" permanece em tela, agora junto com o botão "Sair" que o header já mostra (porque `onAuthStateChange` disparou primeiro).

2. **`beforeLoad` do `/login` não roda quando a navegação é client-side pós-`signInWithPassword`.** Ele só guarda o acesso direto à URL. Depois do submit, o redirect depende exclusivamente do `navigate(...)` imperativo. Se o `navigate` dispara antes do estado da sessão estar realmente refletido no `QueryClient`, o `_authenticated` layout (que é `ssr:false`) entra em estado intermediário e o usuário enxerga `/login` por mais um frame.

3. **`__root.tsx` chama `queryClient.invalidateQueries()` em TODO evento de `onAuthStateChange`** (incluindo `INITIAL_SESSION`, `TOKEN_REFRESHED` e `SIGNED_OUT`). Isso refaz queries protegidas após o sign-out, causa o `TypeError: Failed to fetch` quando o token já foi limpo, e contribui para flashes de UI inconsistente. A regra documentada do projeto (`tanstack-supabase-integration`) é filtrar só `SIGNED_IN`/`SIGNED_OUT`/`USER_UPDATED` e nunca invalidar no `SIGNED_OUT`.

### Correção

1. **`__root.tsx` → filtrar o `onAuthStateChange`** para reagir apenas a `SIGNED_IN`, `SIGNED_OUT`, `USER_UPDATED`; chamar `router.invalidate()` sempre, e `queryClient.invalidateQueries()` **apenas** quando o evento não for `SIGNED_OUT`. Isso elimina o ciclo de refetch contra sessão limpa (causa direta do `Failed to fetch`).

2. **`/login` (`src/routes/login.tsx`) → eliminar a janela onde o formulário fica visível autenticado**:
   - Após `signInWithPassword` bem-sucedido, chamar `await router.invalidate()` antes do `navigate({ to: "/dashboard" })`. Isso garante que o `_authenticated.beforeLoad` re-rode e o `useProfile` esteja pronto antes de pintar `/dashboard`.
   - Durante a transição (`isLoading` do `navigate` ou enquanto o usuário existe mas a rota ainda é `/login`), substituir o formulário por um estado de carregamento (skeleton + texto curto). Assim o usuário nunca enxerga "Entrar" + "Sair" simultaneamente.

3. **`SiteHeader` → não renderizar o bloco `Entrar/Cadastrar` enquanto `loading` for true.** Hoje a condição é `!loading && !user`, que está correta; o problema é que o conteúdo da rota `/login` não tem a mesma proteção. A correção no item 2 cobre isso, mas vamos garantir simetria: header continua escondendo CTA até `loading` resolver.

4. **`_authenticated.tsx` → trocar `supabase.auth.getUser()` por `getSession()` no `beforeLoad`** (apenas para o gate; `getUser()` é uma round-trip extra que aumenta o flash). O bearer continua sendo validado pelo middleware das serverFns, então não há perda de segurança — só latência. *(Opcional, dependente do efeito real medido; mantemos `getUser` se o impacto visual já estiver resolvido pelos itens 1–3.)*

### Resultado esperado

- Submit do login → tela de loading curta → `/dashboard` já hidratado com nome do usuário.
- Em nenhum momento o formulário "Entrar" aparece junto com o botão "Sair".
- Navegação `/dashboard ↔ /explore ↔ /agenda` sem flicker de auth.

---

## Bloco B — Admin: erros residuais de console

### Diagnóstico

- **`TypeError: Failed to fetch` no `beforeLoad/getUser`**: efeito colateral do `invalidateQueries()` global no `onAuthStateChange` (mesma causa raiz do Bloco A). Após `SIGNED_OUT`, queries protegidas refazem fetch contra um cliente sem sessão → 401/abort do worker → `Failed to fetch` no console.
- **`502`**: tipicamente são serverFns chamadas durante sign-out que batem no Worker depois do token ser limpo. A correção do Bloco A (não invalidar no `SIGNED_OUT`) + `queryClient.cancelQueries()` no logout (já documentado em `tanstack-auth-guards`) elimina a maior parte.

### Correção

1. Já coberto pelo item 1 do Bloco A.
2. **`SiteHeader.signOut`** → seguir o "Sign-Out Hygiene" do guia: `await queryClient.cancelQueries()` → `queryClient.clear()` → `supabase.auth.signOut()` → `navigate({ to: "/", replace: true })`. Isso encerra as fetchs em voo antes do 401, eliminando o resto dos 502/Failed to fetch.
3. Reinspecionar console depois — se permanecerem 502s, identificar qual serverFn específica está respondendo 5xx (vai aparecer no log do dev server) e tratar caso a caso.

---

## Bloco C — Expositor: revisão e documentação

### Estado atual mapeado

- **Rotas:** `/dashboard`, `/table-agenda`, `/profile` (visíveis no header quando `primaryRole === "exhibitor"`); `/pending-exhibitor` para quem ainda não foi aprovado.
- **Gating** (`_authenticated.tsx`):
  - Bloqueia expositor em `/admin`, `/agenda`, `/explore`, `/exhibitor/*` → redireciona para `/dashboard`.
  - Se o request do expositor está `pending` ou `rejected`, redireciona para `/pending-exhibitor` (exceto se já está lá ou no `/profile`).
  - Polling de 15s em `/pending-exhibitor` para detectar aprovação.
- **Aprovação:** `requestExhibitorAccess` (server fn) cria registro em `exhibitor_requests` com status `pending`. Admin aprova via `reviewExhibitorRequest`, que atualiza status para `approved`. **NÃO** existe trigger automático visível no código para promover o `user_roles` do solicitante a `exhibitor` quando a aprovação acontece — isso precisa ser validado em migração ou tratado explicitamente.
- **Tabela:** `event_tables.exhibitor_profile_id` liga o expositor a uma mesa numerada; `exhibitor_profiles` guarda pitch/portfólio em PT/ES + segmentos/serviços/destinos/buyers.

### Pontos frágeis identificados

1. **Promoção de role pós-aprovação**: `reviewExhibitorRequest` só atualiza `exhibitor_requests.status`. Se não houver trigger/migração que insira `user_roles(role='exhibitor')` no momento da aprovação, o solicitante permanece como `visitor` para sempre e o gate continua mandando-o para `/pending-exhibitor` mesmo aprovado. **Ação:** verificar migrations existentes; se faltar, criar trigger `AFTER UPDATE ON exhibitor_requests` que faça o INSERT em `user_roles` quando `NEW.status = 'approved' AND OLD.status <> 'approved'`. *(Aplicar somente após confirmar ausência da lógica.)*
2. **`exhibitor_profiles` ausente para expositor aprovado**: `/exhibitor/$id` faz `.maybeSingle()` em `exhibitor_profiles` e renderiza "não encontrado" se vazio. Não há onboarding visível que force preenchimento do pitch. Risco: card vazio no `/explore`.
3. **`event_tables` sem mesa atribuída**: a página de detalhe não mostra número da mesa; o `/table-agenda` depende dessa associação. Sem dado de produção, é difícil validar o agendamento.
4. **`/pending-exhibitor` faz polling a cada 15s** independente do foco da aba — pequeno excesso, mas tolerável.

### Itens seguros para aplicar agora (sem credencial real)

- Documentar (em `.lovable/plan.md`) o fluxo e o checklist de QA.
- Confirmar existência ou criar trigger de promoção de role na aprovação (item 1) — **somente após inspeção das migrations existentes**.

### Itens que ficam bloqueados aguardando dados reais

- Validação visual de `/exhibitor/$id` com perfil completo.
- Validação de `/table-agenda` com mesa atribuída e reservas.
- Reabertura de fluxo de "request → approve → role efetiva" ponta a ponta.

---

## Entregáveis no fim da execução

1. **Resumo técnico em PT-BR** cobrindo: o que foi corrigido no visitante, status confirmado do admin, mapa do expositor, riscos restantes, próximos passos.

2. **Checklist de QA** dividido em Admin / Visitante / Expositor, com colunas: status (passou/atenção/bloqueado), causa, correção aplicada, evidência esperada, impacto no QA.

3. **Lista de arquivos alterados** com explicação objetiva da causa raiz e instruções de validação manual.

4. **Atualização de `.lovable/plan.md`** com o fluxo de expositor documentado e bloqueios listados.

---

## Arquivos previstos para alteração

- `src/routes/__root.tsx` — filtrar `onAuthStateChange` (causa raiz dos 502/Failed to fetch e do flash de UI).
- `src/routes/login.tsx` — `router.invalidate()` antes do `navigate`; estado de loading bloqueando o form.
- `src/components/site-header.tsx` — Sign-Out Hygiene completo (`cancelQueries` + `clear`).
- `.lovable/plan.md` — documentação consolidada de QA + fluxo expositor.
- *(condicional)* nova migration de trigger `exhibitor_requests → user_roles` se a lógica não existir.

---

## Fora de escopo

- Mudanças visuais não relacionadas à inconsistência do pós-login.
- Alteração de regras de RLS.
- Refatoração do fluxo de booking/agenda.
- Qualquer mudança que dependa de credencial real de expositor (apenas documentada).

Confirma para eu prosseguir com a implementação?
