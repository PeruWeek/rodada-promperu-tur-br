## Plano: Toggle de visibilidade de senha

### Objetivo
Adicionar botão de "mostrar/ocultar senha" (ícone de olho) em todos os campos de senha do projeto.

### Escopo
1. **Tela de login** (`src/routes/login.tsx`) — campo "Senha"
2. **Tela de cadastro** (`src/routes/signup.tsx`) — campos "Senha" e "Confirmar senha"
3. **Tela de credenciais LLM** (`src/routes/_authenticated/credenciais-llm.tsx`) — campo de senha/ token

### Implementação

Criar componente reutilizável `PasswordInput` em `src/components/ui/password-input.tsx`:
- Baseado no `Input` do shadcn/ui
- Botão de toggle à direita do campo com ícones `Eye` e `EyeOff` (Lucide)
- Alterna entre `type="password"` e `type="text"`
- Acessível: atributo `aria-label` no botão

Substituir os `<Input type="password" ...>` pelos novos componentes nas 3 rotas identificadas.

### Resultado esperado
- Usuário pode clicar no ícone de olho para visualizar a senha digitada
- Ícone muda para olho riscado quando a senha está visível
- Funciona em todas as telas de autenticação do sistema