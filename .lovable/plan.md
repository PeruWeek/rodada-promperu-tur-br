## Problema

A aba **Inscritos** está mostrando todas as empresas/contatos do pipeline do evento — inclusive os que vieram apenas do **pré-cadastro CSV** (que ainda não criaram conta no site). Pré-cadastro é só pré-preenchimento; só deve virar "inscrito" depois que a pessoa acessar o site e completar o cadastro.

## Causa

`listEventRegistrants` (em `src/lib/staff-exports.functions.ts`) lê a view `v_company_event_pipeline` e devolve **toda** linha que tenha `primary_profile_id`. Pré-cadastros criam um `profiles` com `auth_user_id = NULL` e `pending_signup = true`, mas eles entram na lista mesmo assim.

## Correção (mínima, só leitura)

Em `listEventRegistrants`, ao buscar os perfis para enriquecer, incluir também `auth_user_id` e **filtrar fora** quem tem `auth_user_id IS NULL`. Assim, só aparece em "Inscritos" quem realmente criou conta no site.

### Mudanças

- `src/lib/staff-exports.functions.ts` — no `.select(...)` de `profiles`, adicionar `auth_user_id`; no `.map(...)` final, descartar rows cujo perfil principal tenha `auth_user_id == null`.

Sem migração, sem alterar importador, sem mexer no pipeline. As empresas pré-cadastradas continuam aparecendo no Kanban/Pipeline (que é onde fazem sentido), só somem da aba "Inscritos" até a pessoa se cadastrar.

### Verificação

- Abrir aba Inscritos → contagem deve cair para apenas quem já tem login.
- Após uma pessoa pré-cadastrada se cadastrar pelo site (e `auth_user_id` ser preenchido), ela passa a aparecer automaticamente.