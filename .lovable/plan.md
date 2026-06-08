## Problemas identificados

**1) Admin `rodada@promperu.tur.br` aparece como "Visitante"**
No banco esse usuário tem DUAS roles em `user_roles`: `visitor` e `admin` (legado, antes do `adminSetPrimaryRole` que limpa e regrava). O painel admin (`src/routes/_authenticated/admin.tsx`, linha 524) faz `u.roles[0] ?? null`, ou seja, pega a primeira role retornada pelo banco — que nesse caso veio `visitor`. Por isso o dropdown mostra "Visitante" mesmo o usuário sendo admin de fato. O resto do app funciona porque usa `hasRole(..., "admin")`.

**2) Visitante `luizantoniotibirica@gmail.com` cai no onboarding**
No banco ele tem `role=visitor` mas `company_id IS NULL`. O guard em `_authenticated.tsx` manda visitante sem company para `/onboarding`. E o onboarding ainda mostra o seletor "Visitante / Expositor" (perfil que ele já tem). Além disso o `EditUserDialog` do admin só salva `full_name / preferred_language / is_active` — não há campo de empresa, então "atualizar pela admin" nunca cria a `company` e o visitante segue caindo no onboarding.

## Correções

### A. UI da lista de usuários no admin
`src/routes/_authenticated/admin.tsx`:
- Trocar `const primary = u.roles[0] ?? null;` por `getPrimaryRole(u.roles)` (já importado), com prioridade `admin > staff > exhibitor > visitor`. Isso fará a linha do `rodada@…` mostrar "Administrador".
- `disabled` do Select considera `isSelf && primary === "admin"` (já correto após o fix).

### B. Limpar roles duplicadas no banco
Migration única que, para cada `user_id` com mais de uma role, mantém apenas a de maior prioridade (admin > staff > exhibitor > visitor) e adiciona um índice único `(user_id)` em `user_roles` (hoje o unique é `(user_id, role)`, permitindo múltiplas). Isso evita que o problema volte. Server fn `adminSetPrimaryRole` já faz delete+insert, então passa a respeitar o unique sem mudança.

### C. Onboarding não pergunta perfil quando já existe role
`src/routes/onboarding.tsx`:
- Se `primaryRole === "visitor"` e `!company_id`: pré-selecionar `kind="visitor"`, ocultar os dois botões de escolha e mostrar direto o formulário "Empresa / País / Cidade".
- Se `primaryRole === "exhibitor"` e `!company_id`: idem com `kind="exhibitor"`.
- Mantém o seletor apenas quando o usuário não tem role nenhuma (caso novo OAuth).

### D. Admin pode definir empresa do usuário ao editar
`EditUserDialog` em `admin.tsx`: adicionar campos `Empresa (nome) / País / Cidade`. Ao salvar, se o usuário não tem company, criar via uma nova server fn `adminUpsertUserCompany` (usa `supabaseAdmin`, cria `companies` e seta `profiles.company_id`); se já tem, atualiza os campos. Isso resolve "atualizando dados pela admin não grava" — passa a gravar empresa também, e o visitante deixa de cair no onboarding na próxima entrada.

## Critérios de aceite

- Linha do `rodada@promperu.tur.br` na aba Usuários mostra "Administrador".
- Nenhum usuário possui mais de uma role em `user_roles`.
- Visitante já cadastrado (com role) entra direto no app; se faltar empresa, vê só o formulário de empresa (sem o seletor de perfil).
- Admin consegue preencher empresa/país/cidade de um usuário pelo diálogo de edição e isso persiste no banco.
