## Adicionar troca de senha no perfil

Adicionar uma seção "Segurança" na página `/profile` permitindo que o usuário autenticado altere a própria senha.

### O que será feito

1. **Nova seção na página de perfil** (`src/routes/_authenticated/profile.tsx`):
   - Card "Segurança" com formulário de troca de senha
   - Campos: nova senha + confirmar nova senha
   - Validação: mínimo 8 caracteres, senhas coincidem
   - Botão "Atualizar senha" com estado de loading
   - Toast de sucesso/erro

2. **Lógica de atualização**:
   - Usar `supabase.auth.updateUser({ password })` diretamente no cliente (a sessão atual já autoriza essa operação)
   - Após sucesso, limpar os campos e exibir confirmação

### Fora do escopo

- Página `/reset-password` para recuperação por email (pode ser adicionada depois se quiser fluxo "esqueci minha senha")
- Não pediremos a senha atual (Supabase não exige para usuário autenticado), mas posso adicionar verificação reautenticando se preferir mais segurança
