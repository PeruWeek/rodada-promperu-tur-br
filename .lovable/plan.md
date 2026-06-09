## Problema
A tela `/login` não tem opção "Esqueci minha senha" e não existem rotas para solicitar nem para redefinir a senha. O template de e-mail de **recovery** já existe (`src/routes/lovable/email/auth/...`), então só falta a parte do app.

## O que será feito

1. **Link "Esqueci minha senha" em `/login`**
   - Logo abaixo do campo de senha, alinhado à direita.
   - PT-BR e ES (via `src/lib/i18n/*.json`).

2. **Nova rota pública `/forgot-password`** (`src/routes/forgot-password.tsx`)
   - Formulário com um único campo (e-mail).
   - Chama `supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/reset-password' })`.
   - Mensagem genérica de sucesso ("Se o e-mail existir, enviaremos um link") para não vazar quais e-mails estão cadastrados.
   - Link de voltar para o login.

3. **Nova rota pública `/reset-password`** (`src/routes/reset-password.tsx`)
   - Página onde o usuário cai vindo do link do e-mail (token `type=recovery`).
   - Detecta a sessão de recovery (o Supabase processa o hash automaticamente).
   - Formulário com nova senha + confirmação, com validação mínima (8+ caracteres, coincidem).
   - Chama `supabase.auth.updateUser({ password })`.
   - Em sucesso: mostra confirmação e redireciona para `/login` (faz signOut antes, para o usuário entrar com a nova senha).
   - Em erro (link expirado/usado): mostra mensagem e link para solicitar novamente.

4. **i18n**
   - Adicionar chaves em `pt-BR.json` e `es.json`: `auth.forgotPassword`, `auth.forgotPasswordTitle`, `auth.forgotPasswordHelp`, `auth.sendResetLink`, `auth.resetEmailSent`, `auth.resetPasswordTitle`, `auth.newPassword`, `auth.confirmPassword`, `auth.passwordsDontMatch`, `auth.passwordTooShort`, `auth.passwordUpdated`, `auth.backToLogin`, `auth.invalidOrExpiredLink`.

## O que NÃO será mexido
- Template de e-mail de recovery (já existe e funciona).
- `/login` (apenas adiciona o link).
- Fluxo de signup, magic link, outros templates.
- Backend / RLS / migrations (nenhuma necessária — o Supabase Auth cuida do reset).

## Validação
- Em `/login` clicar "Esqueci minha senha" → vai para `/forgot-password`.
- Submeter e-mail cadastrado → recebe e-mail de recovery (visível em `email_send_log`).
- Clicar no link do e-mail → cai em `/reset-password`, define nova senha, é redirecionado para `/login` e consegue entrar com a nova senha.
- Link expirado ou já usado → mensagem clara em `/reset-password`.
