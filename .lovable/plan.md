## Permitir admin alterar e-mail de usuários

### 1. Backend — nova serverFn `adminUpdateUserEmail`
Arquivo: `src/lib/admin-auth.functions.ts`

- Input (Zod): `{ userId: uuid, newEmail: email (lowercase/trim) }`
- Guards:
  - `assertAdmin(context.userId)`
  - Bloquear `data.userId === context.userId` → erro "Use o fluxo normal para alterar seu próprio e-mail."
- Buscar usuário atual via `supabaseAdmin.auth.admin.getUserById(userId)`; se `newEmail === currentEmail` → erro "E-mail igual ao atual."
- Chamar `supabaseAdmin.auth.admin.updateUserById(userId, { email: newEmail, email_confirm: true })` (auto-confirma, sem link de confirmação).
- Tratar erro de e-mail em uso (mensagem do Supabase contém "already") → erro amigável "E-mail já está em uso por outra conta."
- Sincronizar `profiles.email = newEmail` onde `auth_user_id = userId`.
- `audit("admin.email_change", actor, { target_user_id, old_email, new_email })`.
- Retorno: `{ ok: true, email: newEmail }`.

### 2. UI — botão "Alterar e-mail" no editor de usuário
Localizar o drawer/dialog de edição de usuário do admin (provavelmente em `src/components/admin/registrants-tab.tsx` ou um `edit-user-drawer`; verificar e reutilizar).

- Adicionar botão "Alterar e-mail" ao lado do e-mail atual (read-only).
- Abre `AlertDialog` com:
  - E-mail atual (texto)
  - Input "Novo e-mail" (validação client-side básica)
  - Aviso: "O usuário passará a logar com o novo e-mail imediatamente. Nenhum link de confirmação será enviado."
  - Botões: Cancelar / Confirmar alteração.
- Ao confirmar: chama `adminUpdateUserEmail` via `useServerFn`.
- Sucesso: `toast.success`, fecha dialog, `queryClient.invalidateQueries` da lista de usuários.
- Erro: `toast.error(error.message)`.
- Esconder o botão quando `user.auth_user_id === currentAdmin.auth_user_id`.

### 3. i18n
Adicionar em `src/lib/i18n/pt-BR.json` e `es.json`:
- `admin.users.changeEmail.button` → "Alterar e-mail" / "Cambiar correo"
- `admin.users.changeEmail.title`
- `admin.users.changeEmail.description` (com aviso de troca imediata)
- `admin.users.changeEmail.currentLabel`, `newLabel`
- `admin.users.changeEmail.confirm`, `cancel`
- `admin.users.changeEmail.success`
- `admin.users.changeEmail.errors.same`, `inUse`, `self`, `invalid`

### 4. Sem migration
Auth API já suporta; apenas sincronizamos `profiles.email`.

### Detalhes técnicos
- Não tocar em `src/integrations/supabase/*` (autogerado).
- `audit()` reusa o logger já presente no arquivo.
- Validação de e-mail server-side via `emailSchema` já existente.
- Erro de auto-edição é bloqueado server-side (defesa em profundidade) e ocultado client-side.
