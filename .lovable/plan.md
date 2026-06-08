## Desativar verificação HIBP

Desativar a verificação de senhas vazadas (HIBP) no backend para que você consiga trocar sua senha de admin usando a mesma senha atual.

### Ações
1. Chamar `supabase--configure_auth` com `password_hibp_enabled: false` (mantendo os outros parâmetros atuais).
2. Atualizar a memória de segurança registrando que HIBP foi desativado a pedido do admin (risco aceito: usuários poderão usar senhas presentes em vazamentos públicos, com mínimo de 8 caracteres ainda exigido).

### Impacto
- Admin consegue salvar a senha atual sem erro.
- Visitantes continuam se cadastrando normalmente — apenas sem o bloqueio de senhas vazadas.
- Nenhuma alteração de código é necessária.
