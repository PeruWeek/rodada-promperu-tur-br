## Objetivo
Remover o acesso do staff à página de perfil. O perfil (dados pessoais, idioma, senha) do staff passa a ser gerenciado apenas pelo admin (organizador do evento).

## Mudanças

### 1. Navegação (`src/components/site-header.tsx`)
- Quando `primaryRole === "staff"`, exibir apenas `{ to: "/admin", label: t("nav.admin") }` no menu (remove "Perfil").
- Admin continua vendo "Perfil" normalmente.

### 2. Gating de rota (`src/routes/_authenticated.tsx`)
- Adicionar `/profile` à lista `adminStaffForbidden` **somente para staff** (admin pode acessar).
  - Implementação: tratar staff separado do admin no bloco do `useEffect`. Se `primaryRole === "staff"` e `pathname` começar com `/profile`, redirecionar para `/admin`.

### 3. Página de perfil (`src/routes/_authenticated/profile.tsx`)
- Defesa em profundidade: se `hasRole(profile?.roles, "staff")` e não admin, renderizar um aviso curto ("Seu perfil é gerenciado pelo organizador do evento.") e botão para voltar a `/admin`, sem formulário. Garante que mesmo via URL direta o staff não edite nada.

### 4. i18n (`pt-BR.json`, `es.json`)
- Nova chave `profile.staffManagedByAdmin` com o texto do aviso em PT-BR e ES.

## Fora de escopo
- Não alterar o fluxo de admin gerenciar staff (já existe em `admin-auth.functions.ts` / aba Usuários). Caso falte algum campo editável pelo admin sobre o staff, tratamos em pedido separado.
- Sem mudanças de RLS / server functions (o staff já não tem permissão administrativa; só estamos removendo a UI de auto-edição).