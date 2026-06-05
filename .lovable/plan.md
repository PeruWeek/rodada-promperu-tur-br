## Objetivo

Garantir que (1) o e-mail de confirmação de cadastro está sendo enviado, (2) o e-mail oriente o usuário a fazer login (com o e-mail e senha cadastrados) para ver a agenda, e (3) após confirmar o cadastro o usuário caia direto na tela de agenda.

## Situação atual (após leitura do código)

- `src/routes/signup.tsx`: após o passo 5 chama `supabase.auth.signUp(...)` com `emailRedirectTo: ${origin}/onboarding`. Mostra o cartão "verifique seu e-mail".
- `src/routes/lovable/email/auth/webhook.ts`: hook de auth está corretamente plugado — renderiza `SignupEmail` e enfileira em `auth_emails` via `enqueue_email` (infra Lovable Emails). Domínio: `rsvp.promperu.tur.br`.
- `src/lib/email-templates/signup.tsx`: template PT/ES só pede confirmação do e-mail. **Não menciona** que após confirmar é preciso entrar com e-mail/senha, nem fala em "agenda".
- `src/routes/onboarding.tsx`: ao detectar payload de buyer no `sessionStorage`, chama RPC `complete_buyer_signup` e navega para `/dashboard` (não para `/agenda`). Também o fluxo manual do visitor vai para `/dashboard`.
- Rota da agenda existe: `src/routes/_authenticated/agenda.tsx`.

## Mudanças

### 1. Verificar status atual do envio de e-mails
- Consultar `email_send_log` (últimos `signup`) e `suppressed_emails` por `psql` para confirmar que e-mails recentes saíram com status `sent` (não `failed`/`dlq`/`suppressed`). Reportar resultado ao usuário. Sem mexer em infra a menos que apareça falha real.

### 2. Enriquecer o e-mail de confirmação (PT + ES)
Editar `src/lib/email-templates/signup.tsx`:
- Manter o botão "Confirmar e-mail" / "Confirmar correo".
- Acrescentar, depois do botão, um bloco com:
  - PT: "Após confirmar, entre com o e-mail e a senha cadastrados para acessar sua agenda da Rodada de Negócios." + botão secundário "Entrar e ver minha agenda" apontando para `https://rodada.promperu.tur.br/login`.
  - ES: equivalente em espanhol com link para `/login`.
- Atualizar o `Preview` para refletir o novo conteúdo.

### 3. Redirecionar pós-confirmação para a agenda
- `src/routes/signup.tsx`: trocar `emailRedirectTo` de `/onboarding` para uma URL que ainda passe pelo onboarding (pois o payload do buyer precisa ser finalizado), mas que ao final caia em `/agenda`. Manter `/onboarding` como destino do link de confirmação (necessário para rodar `complete_buyer_signup`).
- `src/routes/onboarding.tsx`:
  - No bloco `autoFinishing` (caminho do buyer signup), trocar `navigate({ to: "/dashboard" })` por `navigate({ to: "/agenda" })`.
  - No `onSubmit` do fluxo visitor manual, trocar o `navigate` final de `/dashboard` por `/agenda` (mantém exibidor indo para `/pending-exhibitor`).
- Atualizar a copy do cartão "verifique seu e-mail" em `signup.tsx` (i18n `auth.checkEmailBody`/`auth.checkEmailHint`) para mencionar que ao confirmar o e-mail o usuário será levado direto à agenda.

### 4. i18n
- Atualizar `src/lib/i18n/pt-BR.json` e `src/lib/i18n/es.json` se houver textos novos referenciados (ex.: ajuste de `auth.checkEmailBody` / `auth.checkEmailHint`).

## Detalhes técnicos

- O template é React Email; o webhook em `webhook.ts` já passa `siteUrl` = `https://promperu.tur.br`. Vou usar `https://rodada.promperu.tur.br/login` como link explícito (domínio publicado do app) para evitar depender de `siteUrl`.
- Não vou criar novas rotas, não vou alterar infra de e-mail nem `supabase/config.toml`, e não vou redeployar nada manualmente (rotas TanStack sobem no publish).
- Não vou alterar lógica de negócio do onboarding além do destino final do `navigate`.

## Fora de escopo

- Trocar provedor de e-mail, mexer em DNS, ou ativar "Leaked password protection" (pendência manual já comunicada).
- Redesenhar a tela de agenda.
