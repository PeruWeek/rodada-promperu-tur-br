## Objetivo

Garantir que, após confirmar o e-mail e voltar pelo `/auth/callback`, o buyer chegue ao `/onboarding`, veja a tela "Cadastro realizado com sucesso / Estamos redirecionando você para sua agenda." por 3 segundos completos, e só então caia em `/agenda`. Sem mexer em signup, fallback de e-mail, `emailRedirectTo`, ou fluxos de expositor/admin/staff/cliente.

## Passo 1 — Investigar com Playwright

Reproduzir em aba privada contra o preview local: signup → clicar no link de confirmação → observar cada etapa. Capturar URL final, console/network do callback, e o DOM/tempo do `/onboarding`.

Objetivo: confirmar qual dos pontos abaixo é o bloqueio real:
- (a) `/auth/callback` não autenticando (poll de sessão expira / URL é `?code=` em vez de hash);
- (b) payload do buyer não chegando ao `OnboardingPage` (sessionStorage vazio cross-tab + `user_metadata` ausente);
- (c) success de 3s sendo cortado por redirect concorrente (`_authenticated.tsx` ou efeito interno de `onboarding.tsx`);
- (d) outro ponto descoberto na execução.

## Passo 2 — Ajustes (aplicar conforme o Passo 1)

Tudo em frontend.

**A. `src/routes/onboarding.tsx`** — fechar a race contra o success de 3s:
- Setar `sessionStorage["buyer_success_pending"]="1"` no próprio bloco do auto-finalizer, **antes** do `setBuyerSuccess(true)`, não só no `useEffect` reativo. Assim qualquer re-render imediato com `profile` já atualizado (visitor + `company_id`) encontra o flag e não redireciona para `/agenda` cedo.
- Reforçar o efeito "visitor + company_id → /agenda" para também respeitar o flag em sessionStorage além do `buyerSuccess` / `autoFinishing` que já existem.

**B. `src/routes/auth.callback.tsx`** — só se o Passo 1 mostrar problema de URL:
- Se o link vier como PKCE (`?code=...`), trocar o poll por `supabase.auth.exchangeCodeForSession(window.location.href)` antes do poll. Sem alterar `emailRedirectTo`.
- Manter `goOnce("/onboarding")` para usuários sem role (caminho atual já correto pós-confirmação).

**C. `src/routes/_authenticated.tsx`** — apenas reforço se necessário:
- Manter a checagem `buyer_success_pending && pathname === "/onboarding"` no topo do effect, como já está. Não adicionar lógica nova para `visitor`.

**D. Payload cross-device** — só se o Passo 1 mostrar `user_metadata` vazio:
- No auto-finalizer, tentar `supabase.auth.getUser()` (revalida com o servidor) antes de desistir do payload.

## Passo 3 — Validar

Re-executar o Playwright em aba privada:
- signup → tela "Enviamos um link de confirmação" (intacta);
- clicar no link → `/auth/callback` autentica → `/onboarding`;
- tela "Cadastro realizado com sucesso / Estamos redirecionando você para sua agenda." visível por 3s;
- redirect automático para `/agenda`.

## O que NÃO muda

- `src/routes/signup.tsx` (tela e textos do fallback de e-mail).
- `emailRedirectTo` (`/auth/callback`).
- Texto/UI da tela "Enviamos um link de confirmação".
- Fluxos de expositor / admin / staff / cliente.
- Nada de `signInWithPassword` forçado após `signUp`.

## Arquivos prováveis de edição

- `src/routes/onboarding.tsx` (race do flag + setBuyerSuccess) — certo.
- `src/routes/auth.callback.tsx` — só se Passo 1 indicar PKCE.
- `src/routes/_authenticated.tsx` — só reforço, se necessário.
- `.lovable/plan.md` — atualizar.

## Critérios de aceite

- Cadastro inicial mostra a tela atual de confirmação de e-mail (intacta).
- Link do e-mail leva a `/auth/callback`, autentica e segue para `/onboarding`.
- `OnboardingPage` auto-finaliza o buyer e mostra "Cadastro realizado com sucesso / Estamos redirecionando você para sua agenda." por **3 segundos completos**.
- Após 3s, vai para `/agenda`.
- Nenhum redirect concorrente corta o success.
- Fallback de e-mail permanece intacto.
