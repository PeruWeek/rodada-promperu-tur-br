Criar o usuário admin `rodada@promperu.tur.br` no novo backend, já com email confirmado e role `admin`.

## Passos

1. Rodar um script (via `bun`) usando `SUPABASE_SERVICE_ROLE_KEY` para:
   - Verificar se o email já existe em `auth.users`.
   - Se existir: resetar senha para `RodadaAdmin#2026` e marcar `email_confirm: true`.
   - Se não existir: criar com `email_confirm: true` e metadata `full_name: "Administrador Rodada"`, `preferred_language: "pt-BR"`.
   - O trigger `handle_new_user` cria `profiles` + role `visitor` automaticamente.

2. Promover a `admin` via `INSERT ... ON CONFLICT DO NOTHING` em `public.user_roles` para o `user_id` retornado.

3. Validar com `SELECT` em `auth.users`, `profiles` e `user_roles`.

## Credenciais que serão configuradas

- Email: `rodada@promperu.tur.br`
- Senha temporária: `RodadaAdmin#2026` (trocar depois em Perfil)
- Role: `admin`

Nenhum arquivo do projeto será alterado.
