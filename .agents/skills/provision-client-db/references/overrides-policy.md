# Política de overrides

O kit em `/mnt/documents/db-audit/sql/` é **imutável** por esta skill.

## Quando um override é permitido
- O cliente exige comportamento fora do escopo canônico (ex.: campo extra em tabela específica, policy adicional, seed adicional).
- O usuário autoriza explicitamente por escrito nesta conversa.

## Como aplicar
1. Criar arquivo em `/mnt/documents/provisioning/overrides/<client_name>/NNN_<slug>.sql`.
2. NNN começa em `100` (nunca colide com 000–010 canônicos).
3. Aplicar via `supabase--migration` APÓS o passo 4 (seed variável) e ANTES do 010 (validação).
4. Registrar no relatório final na seção **Overrides autorizados** com:
   - motivo
   - autorização textual do usuário
   - impacto esperado
   - reversibilidade

## Proibido
- Editar qualquer `sql/00x_*.sql` do kit.
- Remover policy, trigger ou function do canônico via override.
- "Suavizar" RLS para destravar bug do app — bug se corrige no app, não no banco.
- Override não documentado no relatório.

## Feedback loop
Se um mesmo override aparecer em ≥2 clientes, sinalizar ao usuário que o canônico deveria absorver a mudança — mas a skill **não** faz essa alteração sozinha.