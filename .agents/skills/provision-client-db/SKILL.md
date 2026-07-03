---
name: provision-client-db
description: Provisiona um novo banco Supabase para cliente aplicando o kit canônico em /mnt/documents/db-audit/sql/ na ordem correta, exigindo parâmetros variáveis, validando policies/triggers/functions e produzindo evidência objetiva. Use quando o usuário pedir para criar/replicar/subir/provisionar o banco de um novo cliente, ambiente ou tenant a partir do template oficial.
---

# Provision Client DB (kit canônico)

Orquestra a aplicação do template oficial validado em `/mnt/documents/db-audit/sql/` para um novo cliente. **Nunca altera** as migrations canônicas. Apenas coleta parâmetros variáveis, executa na ordem correta, valida e gera evidência.

## Fonte da verdade (read-only)

```
/mnt/documents/db-audit/
├── README.md, INVENTORY.md, BUSINESS_RULES.md, GAPS_AND_RISKS.md
└── sql/
    000_extensions_and_schemas.sql
    001_types_and_enums.sql
    002_tables.sql
    003_constraints_and_indexes.sql
    004_views.sql
    005_functions.sql
    006_triggers.sql
    007_rls_and_policies.sql
    008_storage.sql
    009_seed_reference_data.sql
    010_post_deploy_checks.sql
```

Qualquer divergência do canônico exige autorização explícita do usuário e vira arquivo `overrides/<cliente>/*.sql` **fora** de `sql/` — nunca editar `sql/00x_*.sql`.

## Entradas obrigatórias

Antes de qualquer execução, coletar via `questions--ask_questions` se faltar:

1. `client_name` — slug (ex.: `promperu-2027`)
2. `environment` — `dev` | `staging` | `prod`
3. `target_project_ref` — ref Supabase do projeto destino
4. `client_params` — nome do evento, timezone, idioma padrão, URL do app
5. `modules_enabled` — subset de: `pipeline`, `email_queue`, `rag`, `booking_reminders`, `checkin`, `agents`
6. `seed_data` — admin inicial (email), evento ativo, roles bootstrap
7. `branding` (opcional) — logo URL, cores, from_email

Recusar prosseguir sem 1–6. Faltando qualquer um, chamar `ask_questions` uma única vez agregando os pendentes.

## Fluxo interno

Executar em ordem estrita. Parar imediatamente ao primeiro erro (fail-fast).

1. **Pré-check**
   - Verificar existência de `/mnt/documents/db-audit/sql/000..010`.
   - Verificar que o projeto destino está vazio (sem tabelas em `public`) via `supabase--read_query`. Se não estiver: abortar e pedir confirmação explícita para prosseguir.
2. **Aplicar migrations canônicas** (uma por vez, via `supabase--migration`, na ordem 000→008):
   - 000 extensions, 001 enums, 002 tables, 003 constraints/indexes, 004 views, 005 functions, 006 triggers, 007 rls/policies, 008 storage.
   - Cada chamada = uma migration separada; aguardar aprovação/execução antes da próxima.
3. **Seed de referência** — aplicar `009_seed_reference_data.sql` (dados fixos apenas; nunca dado transacional).
4. **Seed variável do cliente** — gerar migration derivada de `client_params` + `seed_data` (evento ativo, admin inicial via `user_roles`, branding). Nunca misturar com 009.
5. **Gaps manuais** — executar itens de `GAPS_AND_RISKS.md` conforme `modules_enabled`:
   - trigger `on_auth_user_created` em `auth.users` (sempre)
   - `pg_cron` + `pgmq` queues + job `process-email-queue` (se `email_queue`)
   - vault secret `email_queue_service_role_key` (se `email_queue`) via `secrets--add_secret`
   - atualizar URL hardcoded em `public.email_queue_dispatch` para domínio do cliente
6. **Validação final** — rodar `010_post_deploy_checks.sql` via `supabase--read_query` (checks SELECT-only). Rodar `supabase--linter`.
7. **Evidência** — gerar relatório em `/mnt/documents/provisioning/<client_name>-<environment>-<ISO_DATE>.md`.

## Guardrails (invioláveis)

- ❌ Nunca editar arquivos em `/mnt/documents/db-audit/sql/`.
- ❌ Nunca remover trigger/function/policy de segurança para "fazer funcionar". Falha = investigar, não suprimir.
- ❌ Nunca misturar seed fixo (009) com dado transacional/variável (passo 4).
- ❌ Nunca ignorar falha de RLS, GRANT ou policy — cada `CREATE TABLE public.*` exige GRANT + RLS + POLICY no mesmo passo.
- ❌ Nunca declarar sucesso sem os 010 checks passarem e sem o linter limpo (ou com warnings justificados).
- ❌ Nunca expor service_role_key, senha do banco, ou URLs internas do Supabase ao usuário.
- ✅ Qualquer desvio do canônico → arquivo em `overrides/<client_name>/` + autorização explícita registrada no relatório.

## Saídas obrigatórias

Relatório markdown em `/mnt/documents/provisioning/<client>-<env>-<data>.md` contendo:

1. **Cabeçalho** — cliente, ambiente, project ref, data, operador, versão do kit (hash de `sql/`).
2. **Parâmetros aplicados** — echo de `client_params`, `modules_enabled`, `seed_data` (sem secrets).
3. **Migrations aplicadas** — lista 000..009 + seed variável, com status ✅/❌ e timestamp.
4. **Gaps manuais executados** — checklist de `GAPS_AND_RISKS.md` marcado.
5. **Evidência de validação**:
   - resultado dos checks 010 (contagens de tabelas, policies, triggers, functions esperadas vs encontradas)
   - saída do `supabase--linter`
   - contagem por role dos GRANTs em `public.*`
   - lista de tabelas `public.*` com `rowsecurity=true`
6. **Pendências** — itens que exigem ação humana pós-execução (DNS, domínio de e-mail, OAuth providers, etc.).
7. **Overrides autorizados** — se houver, com justificativa.

Emitir `<presentation-artifact path="provisioning/<arquivo>.md" mime_type="text/markdown"></presentation-artifact>` ao final.

## Tratamento de erro

| Etapa | Falha | Ação |
|---|---|---|
| Migration (000–008) | erro SQL | parar; reportar arquivo + linha; **não** tentar patch no canônico; pedir decisão (retry, override autorizado, abort) |
| Seed 009 | conflito de PK/unique | verificar se o passo 4 vazou para 009; nunca; abortar |
| Seed variável (4) | dado inválido | pedir correção dos `client_params`/`seed_data`; não improvisar valores |
| Policy/RLS | tabela `public.*` sem RLS ou sem GRANT | bloquear; corrigir via nova migration antes de continuar |
| Function/Trigger | `security definer` ausente onde esperado | reinstalar do canônico; investigar diff |
| Storage (008) | bucket já existe | idempotência OK; logar; seguir |
| Validação 010 | qualquer check falha | marcar como ❌ no relatório; **não** encerrar como sucesso; listar em Pendências |
| Vault/secret | `add_secret` falha | pausar módulo dependente; registrar Pendência |

Em qualquer falha: o relatório é escrito com o estado parcial e status `INCOMPLETE`. Nunca reportar sucesso parcial como sucesso.

## Critérios de aceite (self-check antes de encerrar)

- [ ] Todos os parâmetros obrigatórios coletados
- [ ] Migrations 000..009 aplicadas na ordem, sem edição do canônico
- [ ] Seed variável isolado do 009
- [ ] Gaps manuais de `GAPS_AND_RISKS.md` executados conforme `modules_enabled`
- [ ] Checks 010 passaram
- [ ] `supabase--linter` limpo ou warnings justificados
- [ ] Relatório gerado e artifact emitido
- [ ] Nenhum secret exposto no relatório

Se qualquer item ficar `[ ]`, o status final é `INCOMPLETE` e a lista de pendências é obrigatória.

## Referências

- `references/checklist.md` — checklist operacional completo
- `references/overrides-policy.md` — quando e como autorizar override
- `/mnt/documents/db-audit/README.md` — kit canônico
- `/mnt/documents/db-audit/GAPS_AND_RISKS.md` — ações manuais obrigatórias