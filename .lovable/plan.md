## Diagnóstico

O usuário `comercial@kronedesign.com.br` (empresa "Teste Expositor") tem o papel `exhibitor` no `user_roles`, mas **não possui linha em `exhibitor_profiles`**.

A página de busca (Explore) lista expositores fazendo `SELECT FROM exhibitor_profiles` com join em `companies` e `profiles`. Sem a linha em `exhibitor_profiles`, o expositor não aparece nas buscas dos visitantes — mesmo tendo o papel correto.

Causa provável: o papel foi atribuído por uma via que não passou pelo trigger de aprovação de `exhibitor_requests` (que é o que cria automaticamente a linha em `exhibitor_profiles`). Verificado: é o único expositor nessa situação.

## O que vou fazer

1. **Backfill via migração**: inserir a linha em `exhibitor_profiles` para o profile `de3f87be-f26f-4e81-aec8-32debf09e490` (com `ON CONFLICT DO NOTHING`), para que o expositor passe a aparecer imediatamente nas buscas.
2. **Prevenção**: adicionar uma migração com um trigger em `user_roles` que, sempre que um usuário receber `role = 'exhibitor'`, garanta automaticamente a existência da linha correspondente em `exhibitor_profiles` (via `INSERT ... ON CONFLICT DO NOTHING`). Isso evita que esse problema volte a ocorrer por qualquer caminho administrativo futuro.

## Validação

- Após a migração, o expositor "Teste Expositor" deve aparecer na busca em /explore para qualquer visitante.
- Novos perfis promovidos a `exhibitor` por qualquer rota (admin, trigger de request, ou direto) terão a linha em `exhibitor_profiles` criada automaticamente.
