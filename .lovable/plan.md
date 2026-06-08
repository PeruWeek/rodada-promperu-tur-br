## Regras consolidadas (resumo das suas instruções)

- **Cadastro público pelo formulário**: somente para **visitantes (compradores)**. Expositores nunca se cadastram sozinhos pelo site.
- **Cadastro de expositores**: criado por **admin ou staff** no painel.
- **Edição de usuários (qualquer um)**: admin **e** staff.
- **Exclusão de usuários**: **somente admin**.

## Causa raiz do problema atual

`luizantoniotibirica@gmail.com` é visitante e tem em `auth.users.raw_user_meta_data.full_name` = **"Luiz Antonio Tibiriça"** (gravado no signup), mas em `profiles.full_name` ficou **"Escritorio Promperu"** — foi sobrescrito em algum momento (edição admin ou payload do buyer-signup antigo). O onboarding atual para visitor já com role definido **não tem o campo "Nome completo"**, então o usuário não consegue corrigir nesse fluxo (só via "Perfil").

## O que vou fazer

### 1. Onboarding passa a pedir "Nome completo" (visitor)
Em `src/routes/onboarding.tsx`, no formulário de empresa:
- Adicionar campo **"Nome completo"** no topo, pré-preenchido com `profile.full_name`.
- No submit, fazer `UPDATE profiles SET full_name = ... WHERE id = profile.id` antes do `onboard_company` (RLS de update próprio já existe).

### 2. Admin painel: permissões corretas
- `adminCreateConfirmedUser`, `adminUpdateUserProfile`, `adminUpsertUserCompany`, `adminSetPrimaryRole`, `adminConfirmEmail`, `adminSetPassword`: **admin ou staff** (trocar `assertAdminStrict` por `assertAdmin`).
- `adminDeleteUser`: **somente admin** (mantém `assertAdminStrict`).
- Na UI de `admin.tsx`, ocultar o botão "Excluir" para quem é staff (usar `hasRole(roles, "admin")`).

### 3. Bloquear signup público de expositor
- Em `src/routes/signup.tsx` / fluxo de onboarding, remover o caminho "Expositor" do cadastro público. Onboarding já trata visitor por padrão; ajustar o seletor para mostrar só "Visitante" quando o usuário chega via signup público.
- A página `/signup` (formulário público) continua exclusiva para visitante/comprador.

### 4. Corrigir o nome do Luiz agora (data fix)
Atualizar `profiles.full_name = 'Luiz Antonio Tibiriça'` para o `auth_user_id` dele (valor vindo do próprio metadata de signup). Empresa "Kronedesign" permanece.

## Critérios de aceitação
- Visitor recém-criado vê **Nome completo + Empresa + País + Cidade** no onboarding e a edição persiste em `profiles.full_name`.
- Staff consegue criar/editar usuários (incluindo expositores) mas **não** vê o botão Excluir.
- Admin consegue tudo, inclusive excluir.
- Não existe mais opção "Cadastre-se como expositor" no fluxo público; expositor só é criado pelo painel.
- Perfil do Luiz mostra "Luiz Antonio Tibiriça".
