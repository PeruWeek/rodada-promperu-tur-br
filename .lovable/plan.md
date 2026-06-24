## Tela que está travando o fluxo

`src/routes/signup.tsx` — bloco renderizado quando `sent === true` (linhas ~439–454). Mostra:
- `auth.signupSuccessTitle` → "Registro realizado com sucesso!"
- `auth.checkEmailBody` → "Enviamos um link de confirmação para {email}…"

Hoje esse bloco é exibido **sempre** após `supabase.auth.signUp`, mesmo quando o Supabase já devolve uma `session` no retorno (caso de auto-confirm / e-mail já confirmado anteriormente / reenvio em ambiente de teste). Em aba privada o usuário fica nessa tela e não chega ao pós-sucesso de `/onboarding`.

## Causa

O código em `onFinish` só faz `setSent(true)` e nunca olha para `data.session` retornado pelo `signUp`. Quando existe sessão imediata, o usuário já está autenticado e deveria seguir para `/onboarding`, que tem o auto-finalizador do payload do buyer + a tela final "Cadastro realizado com sucesso / Estamos redirecionando para sua agenda" + timer de 8s + `/agenda` (já implementado em `src/routes/onboarding.tsx`).

## Ajuste

Em `src/routes/signup.tsx`, dentro de `onFinish`, após o `supabase.auth.signUp` bem-sucedido:

1. Ler `data.session` do retorno do `signUp`.
2. Se `data.session` existir (usuário já autenticado): navegar com `navigate({ to: "/onboarding", replace: true })`. O `OnboardingPage` detecta o payload em `sessionStorage`/`user_metadata`, executa `complete_buyer_signup`, mostra `buyerSuccessTitle` + `buyerSuccessBody`, espera 8s e redireciona para `/agenda` — sem qualquer mudança nesse arquivo.
3. Se **não** houver sessão (confirmação por e-mail obrigatória — comportamento atual em produção): manter `setSent(true)` exatamente como está. Toda a tela de "Enviamos um link de confirmação", o link de reenvio e o fluxo `/auth/callback` permanecem intactos.

Adicionar `useNavigate` do `@tanstack/react-router` no componente (ainda não importado neste arquivo).

## O que NÃO muda

- `emailRedirectTo: ${origin}/auth/callback` — inalterado.
- `src/routes/auth.callback.tsx` — inalterado.
- `src/routes/onboarding.tsx` — inalterado (a tela de sucesso + 8s + `/agenda` já está implementada e continua valendo).
- `src/routes/_authenticated.tsx` — reforço `buyer_success_pending` continua válido.
- Texto/UI da tela de "Enviamos um link de confirmação" — inalterado, segue como fallback quando não há sessão.
- Fluxos de expositor, admin/staff e e-mail — inalterados.

## Arquivos alterados

- `src/routes/signup.tsx` — único arquivo editado.

## Critérios de aceite

- Buyer conclui cadastro com sessão imediata → vai para `/onboarding` → vê "Cadastro realizado com sucesso / Estamos redirecionando você para sua agenda" → aguarda 8s → cai em `/agenda`.
- Buyer conclui cadastro sem sessão (confirmação obrigatória) → vê exatamente a tela atual com o link de confirmação por e-mail; ao clicar no link, segue por `/auth/callback` como hoje.
