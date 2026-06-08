
# Plano — Permissões, Papéis e CRUD de Usuários

## 1. Conceito de "papel primário"

Adicionar helper `getPrimaryRole(roles)` em `src/hooks/use-profile.ts` com prioridade: `admin > staff > exhibitor > visitor`. Toda a UI (menus, dashboard, guards) passa a olhar o papel primário em vez de "tem o papel X".

## 2. Backend — banco e RLS (migração única)

- **Nova tabela `public.staff_table_assignments`**: `event_id`, `table_id`, `staff_profile_id`, `created_at`. Único por (event_id, table_id, staff_profile_id). GRANTs para `authenticated` e `service_role`.
- **RLS**:
  - Admin: full CRUD (`has_role(uid,'admin')`).
  - Staff: SELECT apenas onde `staff_profile_id = current_profile_id()`.
- **Função `public.has_role_staff_for_table(_table_id)`** (SECURITY DEFINER) para uso em outras políticas.
- **Ajustar RLS existente para separar admin vs staff**:
  - `event_tables`, `events`, `time_slots`, `exhibitor_requests`: trocar `is_admin_or_staff` por `has_role('admin')` em INSERT/UPDATE/DELETE (escrita = só admin). SELECT segue público/aberto como hoje.
  - `meetings`, `meeting_checkins`, `general_checkins`: staff pode SELECT/UPDATE check-in só para reuniões em mesas atribuídas a ele.
  - `profiles`/`user_roles`: escrita administrativa só admin; staff perde poderes.
- **Coluna `profiles.is_active`** já existe — manter; CRUD vai usá-la.
- **Trigger de consistência de papel**: ao inserir `user_roles`, opcionalmente garantir registros derivados (visitor/exhibitor profile) já existe parcialmente (`handle_exhibitor_request_approved`); manter como está, sem trigger novo — consistência é tratada nas server functions.

## 3. Backend — server functions (em `src/lib/admin*.functions.ts`)

Adicionar guards `assertAdmin` (apenas admin) e `assertAdminOrStaff` separados. Substituir o atual `assertAdmin` (que aceita staff) por `assertAdminStrict` para tudo que é administrativo.

Novas/alteradas:

- `adminListUsers({ q, limit })` — lista profiles + roles + is_active + email confirmado.
- `adminCreateUser({ email, password, full_name, preferred_language, role })` — extensão de `adminCreateConfirmedUser` que também atribui role inicial (remove `visitor` default do trigger se role for outro).
- `adminUpdateUserProfile({ userId, full_name, preferred_language, is_active })`.
- `adminDeleteUser({ userId })` — bloqueia auto-exclusão (`userId !== context.userId`); usa `supabaseAdmin.auth.admin.deleteUser`.
- `adminSetPrimaryRole({ userId, role })` — substitui roles atuais por uma única role (remove todas e insere a nova). Substitui o atual `setUserRole` (add/remove individual) para fluxo do CRUD; manter `setUserRole` para compatibilidade interna se necessário.
- `listStaffAssignments({ eventId })` — admin: todas. Retorna mesas + staff atribuídos.
- `setStaffTableAssignment({ eventId, tableId, staffProfileId, assigned })` — admin only.
- `getMyStaffAgenda()` — admin-or-staff: retorna reuniões das mesas onde o profile é staff atribuído (admin: opcionalmente todas via param). Inclui slot, mesa, visitante (nome+empresa), expositor, status, check-in.

Todas escrevem em `audit_logs` quando aplicável (já existe padrão).

## 4. Frontend — navegação e guards

### `src/hooks/use-profile.ts`
- Exportar `getPrimaryRole(roles): AppRole | null`.

### `src/components/site-header.tsx`
Menu por papel primário:
- **admin**: Admin, Perfil.
- **staff**: Admin (modo staff), Perfil.
- **exhibitor**: Dashboard, Explore, Table Agenda, Perfil.
- **visitor**: Dashboard, Explore, Agenda, Perfil.

### `src/routes/_authenticated.tsx`
Adicionar redirecionamento por papel:
- admin/staff em `/explore`, `/agenda`, `/table-agenda`, `/dashboard` → redireciona para `/admin`.
- visitor em `/admin`, `/table-agenda` → `/dashboard`.
- exhibitor em `/admin`, `/agenda` → `/dashboard`.

Pular guard de onboarding para admin/staff (já existe).

### `src/routes/_authenticated/dashboard.tsx`
Se papel primário for admin/staff, redirecionar para `/admin`.

## 5. Frontend — página `/admin` por papel

`src/routes/_authenticated/admin.tsx` passa a renderizar abas conforme papel primário:

**Admin** (abas):
- Mesas
- Agenda do Staff (visualização + filtros)
- Check-in
- Staff (atribuições mesa↔staff)
- Usuários (CRUD completo — ver §6)
- Solicitações
- E-mails

**Staff** (abas):
- Minha Agenda (= Agenda do Staff filtrada para ele)
- Check-in (apenas reuniões das mesas dele)

## 6. UI — CRUD de Usuários (aba Admin)

Reescrever `UsersTab`:
- Busca por nome/email.
- Botão "Novo usuário" → dialog (email, senha, nome, idioma, papel inicial).
- Cada linha: nome, email, papel atual (badge), is_active toggle, botão Editar (dialog: nome, idioma, papel primário via select, ativo/inativo), botão Excluir (confirmação, bloqueado se for o próprio).
- Trocar papel usa `adminSetPrimaryRole` (substitui todos).

## 7. UI — Aba Staff (atribuições)

Nova `StaffAssignmentsTab`:
- Lista mesas do evento atual.
- Por mesa: multiselect dos staffs (usa `adminSearchProfiles` filtrando profiles com role staff).
- Salvar chama `setStaffTableAssignment` por delta.

## 8. UI — Aba Agenda do Staff

Nova `StaffAgendaTab`:
- Para staff: chama `getMyStaffAgenda()` sem param.
- Para admin: select de staff para filtrar (opcional) + lista de reuniões agrupadas por mesa/horário.
- Mostra: hora, mesa, visitante, empresa, expositor, status, badge de check-in.

## 9. i18n

Adicionar chaves em `src/lib/i18n/pt-BR.json` e `es.json`:
- `admin.tabs.staffAgenda`, `admin.tabs.staff`
- `admin.users.create.*`, `admin.users.edit.*`, `admin.users.delete.*`, `admin.users.primaryRole`, `admin.users.cannotDeleteSelf`
- `admin.staff.*` (atribuições)
- `admin.staffAgenda.*`

## 10. Critérios de aceite verificáveis

- [ ] Login como admin: header mostra só Admin/Perfil; ir em `/explore` redireciona para `/admin`.
- [ ] Login como staff: vê só abas Minha Agenda + Check-in; tenta acessar `/admin` aba Usuários → não aparece.
- [ ] Admin cria usuário staff via UI → usuário recebe role `staff` (única).
- [ ] Admin troca papel de um visitor para exhibitor → roles ficam só `exhibitor`.
- [ ] Admin tenta excluir a si mesmo → erro.
- [ ] Staff abre Minha Agenda → vê apenas reuniões das mesas atribuídas.
- [ ] Staff faz query direta no Supabase em `user_roles` insert → bloqueado por RLS.

## Detalhes técnicos (apêndice)

- A política atual `is_admin_or_staff` será substituída em escritas administrativas por `has_role(auth.uid(),'admin')`. Leituras permanecem abertas conforme já estão.
- `setStaffTableAssignment` faz upsert/delete por (event_id, table_id, staff_profile_id).
- `getMyStaffAgenda` JOIN: `staff_table_assignments` → `meetings` por `table_id` (e event_id), `time_slots`, `profiles` (visitante), `companies`, `meeting_checkins`.
- Coluna `profiles.is_active` já existe — usar em CRUD; UI deve filtrar inativos onde fizer sentido (opcional).
- Admin que tenta editar próprio papel via `adminSetPrimaryRole` deve ser bloqueado se for remover seu próprio admin (evita lockout).
