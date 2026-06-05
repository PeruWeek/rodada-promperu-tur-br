## Contexto

Não existe usuário com `comercial@kronedesign.com.br` em `auth.users` (verificado). Em vez de SQL pontual, vou entregar uma **aba "E-mails" reutilizável em `/admin`** que resolve o caso atual e casos futuros.

## O que faz

Nova aba **"E-mails"** em `/admin` (visível só para admin/staff), com dois blocos:

### 1. Buscar usuário por e-mail
- Campo + botão "Buscar". Mostra e-mail, criação, status `email_confirmed_at`, se já tem profile.
- Se existir e estiver pendente → botão **"Confirmar e-mail agora"** (marca como confirmado direto, sem disparar envio — contorna o rate limit).
- Se confirmado → badge verde, botão desabilitado.
- Botão **"Definir/Resetar senha"** com campo de senha provisória.

### 2. Criar usuário já confirmado (quando a busca não acha)
- Campos: e-mail, nome completo, senha provisória, idioma (pt-BR/es).
- Botão **"Criar e confirmar"** → cria já com e-mail confirmado e mostra a senha provisória para entregar ao usuário. O trigger `handle_new_user` cria o profile + role `visitor` automaticamente.

### Fluxo Krone hoje
1. `/admin` → aba "E-mails" → buscar `comercial@kronedesign.com.br` → "não encontrado".
2. Preencher nome + senha provisória → "Criar e confirmar".
3. Passar a senha provisória — usuário entra direto em `/login` e cai no onboarding.

## Detalhes técnicos

**Arquivos novos / alterados:**

- `src/lib/admin-auth.functions.ts` (novo) — server functions protegidas por `requireSupabaseAuth` + `assertAdmin` (admin|staff) em **todas** elas, inclusive a de busca (evita enumeração de e-mails). `supabaseAdmin` importado dentro do handler com `await import(...)` (segue o padrão `tanstack-supabase-import-graph`):
  - `findAuthUserByEmail({ email })` — chama `supabaseAdmin.auth.admin.listUsers({ page:1, perPage:200 })` e faz **match exato** em JS comparando `user.email?.toLowerCase() === email.toLowerCase()` (o filtro nativo do Supabase aceita parcial; precisamos do exato). Retorna `{ user: { id, email, email_confirmed_at, created_at } | null, hasProfile: boolean }`.
  - `adminConfirmEmail({ userId })` — `updateUserById(userId, { email_confirm: true })`.
  - `adminCreateConfirmedUser({ email, password, full_name, preferred_language })` — `createUser({ email, password, email_confirm: true, user_metadata: { full_name, preferred_language } })`. O trigger `handle_new_user` já roda para Admin API e popula `profiles` + `user_roles` a partir de `raw_user_meta_data` (verificado no schema).
  - `adminSetPassword({ userId, password })` — `updateUserById(userId, { password })`.
  - Todas inserem linha em `audit_logs` (tabela já existe: `actor_profile_id`, `action`, `payload jsonb`). Ação ex.: `admin.email_confirm`, payload com `target_user_id` e `target_email`.
  - Validação Zod: e-mail válido + lowercase, senha mín. 8, `full_name` 1–120, idioma `pt-BR|es`.
- `src/routes/_authenticated/admin.tsx` — adicionar `<TabsTrigger value="emails">` e componente `EmailsTab` com os dois blocos. Usa `useServerFn` + `useMutation`/`useQuery` no mesmo padrão de `UsersTab`/`RequestsTab`. Toasts `sonner` para sucesso/erro. Senha provisória mostrada num bloco copiável após criar.
- `src/lib/i18n/pt-BR.json` e `es.json` — strings em `admin.tabs.emails` e `admin.emails.*`.

**Sem migration, sem novo secret** (usa `SUPABASE_SERVICE_ROLE_KEY` já presente). Service Role permanece **só no servidor**.

## Fora de escopo

- Sem mudanças em `/signup`, `/login` ou nos e-mails transacionais — o rate limit do Supabase Auth se resolve contornando o envio.
- Sem listagem geral / paginação — apenas busca por e-mail.
- O ponto sobre WhatsApp no signup que você mencionou não está incluído neste plano; se quiser, abro depois separado.