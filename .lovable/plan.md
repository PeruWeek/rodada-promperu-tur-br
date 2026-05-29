## Diagnóstico

O hash `#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired` é o redirect padrão do Supabase quando o link de confirmação:

1. **Já foi consumido** (clicado uma vez, ou pré-carregado pelo cliente de e-mail/antivírus — é o que aconteceu no log: primeiro `/verify` em 23:16:09 deu `user_signedup` ✅, o segundo em 23:16:18 deu `403 One-time token not found`).
2. **Expirou** (default 1h).
3. Foi gerado a partir de `localhost:3000` (signup feito em dev) — então o `redirect_to` aponta para localhost mesmo abrindo o e-mail depois.

Hoje o app não trata esse hash em lugar nenhum — o usuário cai em `/` e não entende o que aconteceu.

## Plano

### 1. Detectar e exibir o erro de auth vindo no hash

Criar um pequeno utilitário client-side `src/lib/auth-hash-error.ts` que:
- Lê `window.location.hash`, faz parse de `error`, `error_code`, `error_description`.
- Se houver erro, limpa o hash (`history.replaceState`) para não persistir.
- Retorna o objeto de erro (ou `null`).

Montar em `RootComponent` (`src/routes/__root.tsx`) dentro de um `useEffect`:
- Se `error_code === 'otp_expired'` ou `'access_denied'`, redireciona para `/login?reason=otp_expired&email=<se houver>` e mostra `toast.error` traduzido.
- Outros erros: `toast.error(error_description)`.

### 2. Tela de "link expirado" + reenviar e-mail no `/login`

Em `src/routes/login.tsx`:
- Ler `?reason=otp_expired` via `Route.useSearch()`.
- Mostrar um banner (Alert) acima do form: "Seu link de confirmação expirou ou já foi usado. Informe seu e-mail e clique em **Reenviar confirmação**."
- Adicionar botão secundário "Reenviar confirmação" que chama:
  ```ts
  supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: `${window.location.origin}/onboarding` },
  })
  ```
- Toast de sucesso/erro.

### 3. Mensagem no `/signup` deixando expectativa clara

Trocar `toast.success(t('auth.checkEmail'))` por um estado local que renderiza um painel:
"Enviamos um e-mail de confirmação para **{email}**. O link expira em 1 hora e só pode ser usado uma vez. Se não chegar, verifique spam ou [reenvie](/login?reason=otp_expired&email=...)".
Não navegar imediatamente para `/onboarding` (o usuário ainda não está autenticado de fato até clicar no link).

### 4. i18n

Adicionar em `pt-BR.json` e `es.json`:
- `auth.linkExpiredTitle`, `auth.linkExpiredBody`
- `auth.resendConfirmation`, `auth.resendSuccess`, `auth.resendError`
- `auth.checkEmailSent` (substituindo a navegação automática)

### 5. Checklist do Supabase Dashboard (instrução p/ o usuário, não código)

Garantir em **Auth → URL Configuration**:
- **Site URL**: `https://rodada.promperu.tur.br`
- **Redirect URLs** (allow list): `https://rodada.promperu.tur.br/**`, `https://rodada-promperu-tur-br.lovable.app/**`, `https://id-preview--9163060e-b183-4ce2-8782-e5a412537db3.lovable.app/**`, `http://localhost:3000/**`

Sem isso, links gerados em produção podem cair em domínio errado.

## Arquivos tocados

- `src/lib/auth-hash-error.ts` (novo)
- `src/routes/__root.tsx` (hook do hash)
- `src/routes/login.tsx` (banner + reenviar)
- `src/routes/signup.tsx` (não navegar; mostrar painel de confirmação)
- `src/lib/i18n/pt-BR.json`, `src/lib/i18n/es.json`

## Critérios de aceite

- Abrir `/#error=access_denied&error_code=otp_expired&...` redireciona para `/login?reason=otp_expired`, hash some, banner aparece, toast aparece.
- No banner, ao informar e-mail e clicar **Reenviar confirmação**, chega novo e-mail (Supabase log mostra `mail.send` confirmation).
- Após signup, usuário vê painel "verifique seu e-mail" em vez de ir direto para `/onboarding`.
- Nenhuma mudança no fluxo de Visitante/Expositor já implementado.
