## Objetivo
Garantir que a tela de sucesso do Visitante/Buyer em `/onboarding` permaneça visível por 8s completos antes do redirect para `/agenda`, sem ser atropelada pelo gating do layout `_authenticated.tsx`.

## Mudanças

### 1. `src/routes/onboarding.tsx`
No effect que arma o `setTimeout` de 8s (já existente, dependente de `buyerSuccess`):
- Ao entrar (buyerSuccess=true): `sessionStorage.setItem("buyer_success_pending", "1")`.
- Dentro do `setTimeout`, antes do `navigate({ to: "/agenda", replace: true })`: remover o flag.
- No cleanup: `clearTimeout` + remover o flag caso o componente desmonte antes do redirect (`!redirectedRef.current`).

Os dois pontos que setam `setBuyerSuccess(true)` (auto-finalize e submit manual visitor) já passam pelo mesmo effect, então não precisam de mudança individual.

### 2. `src/routes/_authenticated.tsx`
No início do effect de gating, antes de qualquer `navigate(...)`:
```ts
const buyerSuccessPending =
  typeof window !== "undefined" &&
  sessionStorage.getItem("buyer_success_pending") === "1";
if (buyerSuccessPending && pathname === "/onboarding") return;
```
Isso bloqueia qualquer redirect induzido por re-render/invalidate/role-change enquanto a tela de sucesso está ativa.

## Não alterar
- `emailRedirectTo` → `/auth/callback`
- `src/routes/auth.callback.tsx`
- fluxo expositor (`/pending-exhibitor`)
- fluxo admin/staff/cliente
- chaves i18n `onboarding.buyerSuccessTitle` / `onboarding.buyerSuccessBody` (já existem)

## Critérios de aceite
- Buyer conclui cadastro → `buyerSuccess=true` + flag `buyer_success_pending=1`.
- Tela visível por 8s; nenhum redirect do layout interrompe.
- Após 8s: flag removido, `navigate("/agenda", { replace: true })` executa 1x (`redirectedRef`).
- Desmonte antes: `clearTimeout` + flag removido.
- Fluxo de confirmação por e-mail continua igual.
