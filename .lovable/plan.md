## Diagnóstico

A linha **"Teste de cadastro LTda"** existe na tabela de empresas, mas é um registro **órfão**:

- Foi criada em 08/06 às 17:54.
- Tem uma linha no pipeline marcada como `cadastro_concluido`.
- **Não tem perfil de usuário vinculado** (nenhum contato, nenhum responsável).
- **Não existe um usuário autenticado** com essa empresa.

Provavelmente sobrou de um teste manual feito antes de existirem as travas do fluxo atual (o wizard de cadastro só grava a empresa no final, junto com o perfil). Por isso não aparece em nenhum log: a tabela de auditoria está vazia hoje — o sistema **não está registrando eventos de criação/edição de empresas, perfis e cadastros**.

A linha "Teste Expositor" também não tem usuário vinculado, mas tem o e-mail `comercial@kronedesign.com.br` registrado como contato — outro caso de cadastro incompleto.

## Plano de correção

1. **Limpar registros órfãos**
   - Remover a empresa "Teste de cadastro LTda" (sem perfil, sem usuário, sem agendamentos).
   - Remover a empresa "Teste Expositor" se também estiver órfã (sem perfil), preservando "Kronedesign".
   - Remover as linhas correspondentes do pipeline.

2. **Travar criação de empresas sem usuário**
   - Garantir, por regra no banco, que toda nova empresa precise estar vinculada a um perfil/usuário criado pelo wizard de cadastro.
   - Bloquear inserções diretas sem `created_by` válido.

3. **Ativar logs de auditoria de cadastro**
   - Registrar eventos de criação e mudança de status de empresas, perfis e linhas do pipeline na tabela de auditoria.
   - Adicionar uma aba/seção no Admin para visualizar esses eventos (quem criou, quando, qual ação, e-mail envolvido).

4. **Indicador de "cadastro incompleto" na Dashboard**
   - Marcar visualmente empresas sem perfil/usuário vinculado para o admin reconhecer registros parciais.

## Perguntas antes de executar

- Posso apagar "Teste de cadastro LTda" e "Teste Expositor"? (Kronedesign será preservada — tem usuário real.)
- A aba de logs deve incluir só ações de cadastro, ou também ações administrativas (mudança manual de status, atribuição de responsável, exclusão)?