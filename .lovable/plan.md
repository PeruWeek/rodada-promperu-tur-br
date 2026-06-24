## Objetivo

Eliminar a confirmação de e-mail como bloqueio do fluxo do Buyer. Após o cadastro o usuário entra autenticado, vai para `/onboarding`, vê a tela de sucesso por 3s e é redirecionado para `/agenda`. O e-mail continua sendo enviado como comunicação, mas não interrompe mais o fluxo principal.

## Passo 1 — Backend (Supabase Auth)

Chamar `supabase--configure_auth` com `auto_confirm_email: true`. Isso faz o `supabase.auth.signUp` retornar uma sessão imediata (sem exigir clique no link de confirmação). Demais flags ficam como estão (signup habilitado, anônimo desabilitado, HIBP no estado atual).

Impacto:
- Novos cadastros entram autenticados imediatamente.
- O e-mail de confirmação continua sendo enviado (a confirmação ainda existe no Supabase como ação opcional), mas não é mais pré-requisito para sessão.
- Usuários antigos pendentes de confirmação continuam funcionando pelo fallback existente em `/auth/callback` (não removido).

## Passo 2 — Frontend (`src/routes/signup.tsx`)

Com `auto_confirm_email: true`, `signUp` passa a retornar `session` no caminho de sucesso, então o ramo existente `if (signUpData?.session) navigate({ to: "/onboarding", replace: true })` já cobre o fluxo. Ajustes:

- Remover o `setSent(true)` como caminho esperado do buyer. Como contingência (caso o Supabase retorne sem sessão por algum motivo — ex.: rate limit ou re-signup de e-mail já existente), tentar `supabase.auth.signInWithPassword` com as credenciais recém-criadas e, em caso de sucesso, redirecionar para `/onboarding`. Só cair na tela `auth.signupSuccessTitle / checkEmailBody` se nem signUp nem signIn retornarem sessão (fallback legado preservado, não obrigatório).
- Não mexer na copy da tela final de sucesso do buyer em `/onboarding` (já existe `onboarding.buyerSuccessTitle` / `onboarding.buyerSuccessBody` com timer de 3s → `/agenda`).

## Passo 3 — Frontend (`src/routes/onboarding.tsx`)

Já está correto após os ajustes anteriores: auto-finaliza o payload do buyer via `complete_buyer_signup`, mostra a tela de sucesso, seta `sessionStorage["buyer_success_pending"]="1"` antes do `setBuyerSuccess(true)`, e o `useEffect` dedicado dispara o redirect para `/agenda` após 3s. Não há mudança necessária aqui.

## Passo 4 — Validar com Playwright

Reproduzir end-to-end: abrir `/signup`, completar os 3 passos, submeter. Conferir que:
1. Não aparece a tela "verifique seu e-mail".
2. Vai direto para `/onboarding`.
3. Aparece "Cadastro realizado com sucesso / Estamos redirecionando você para sua agenda." por ~3s.
4. Redireciona para `/agenda` autenticado.

## Não alterar

- Fluxos de expositor, admin, staff, cliente.
- Copy da tela final de sucesso do buyer.
- Rota final `/agenda`.
- `/auth/callback` (mantido como fallback para usuários legados ou contingência).
- E-mail de confirmação continua sendo enviado pelo Supabase.

## Entregáveis ao final

- Config do Supabase Auth alterada: `auto_confirm_email: true`.
- Arquivos do frontend alterados: `src/routes/signup.tsx` (contingência de signIn pós-signUp; tela "verifique e-mail" vira fallback raro).
- Fluxo final: signup → sessão imediata → `/onboarding` → auto-finalize → tela de sucesso 3s → `/agenda`.

## Impactos operacionais

- **Risco de typo no e-mail**: usuário pode se cadastrar com e-mail errado e mesmo assim acessar a plataforma. Comunicação por e-mail (confirmações de reunião, lembretes) pode não chegar. Mitigar com validação de formato (já existe) e telas que reforcem revisão do e-mail no `/profile`.
- **Risco de spam/abuse**: sem confirmação obrigatória, contas falsas entram direto. Mitigar com rate-limit do Supabase Auth (já ativo) e moderação via admin se necessário.
- **Conformidade**: se houver requisito legal de double opt-in para marketing, manter o consentimento `consent_marketing` desacoplado do acesso (já é o caso).
- **Usuários legados pendentes**: os que ainda não confirmaram conseguem entrar normalmente pelo `/auth/callback` (link do e-mail antigo continua funcionando).
