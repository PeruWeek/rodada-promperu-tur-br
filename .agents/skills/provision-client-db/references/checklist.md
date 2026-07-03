# Checklist operacional

## Pré-execução
- [ ] Kit canônico presente em `/mnt/documents/db-audit/sql/` (000..010)
- [ ] Projeto destino vazio ou desvio autorizado
- [ ] Todos os parâmetros obrigatórios coletados
- [ ] Secrets sensíveis (service_role, DB password) NÃO solicitados ao usuário

## Execução (ordem obrigatória)
- [ ] 000 extensions_and_schemas
- [ ] 001 types_and_enums
- [ ] 002 tables (com GRANTs no mesmo arquivo)
- [ ] 003 constraints_and_indexes
- [ ] 004 views
- [ ] 005 functions
- [ ] 006 triggers
- [ ] 007 rls_and_policies
- [ ] 008 storage
- [ ] 009 seed_reference_data (fixo)
- [ ] Seed variável do cliente (migration derivada)

## Gaps manuais (por módulo)
- [ ] Trigger `on_auth_user_created` em `auth.users` → `public.handle_new_user`
- [ ] `pg_cron` habilitado (se email_queue)
- [ ] Queues `pgmq` criadas (se email_queue)
- [ ] Job `process-email-queue` agendado (se email_queue)
- [ ] Vault secret `email_queue_service_role_key` (se email_queue)
- [ ] URL de dispatch atualizada no domínio do cliente
- [ ] OAuth providers configurados via `supabase--configure_social_auth` (se aplicável)

## Validação
- [ ] 010_post_deploy_checks executado (SELECT-only)
- [ ] `supabase--linter` executado
- [ ] Contagem de tabelas em `public` bate com INVENTORY.md
- [ ] Todas as tabelas `public.*` têm `rowsecurity=true`
- [ ] Todas as tabelas `public.*` têm ao menos 1 policy
- [ ] GRANTs por role conferidos
- [ ] Admin inicial existe em `user_roles`

## Encerramento
- [ ] Relatório em `/mnt/documents/provisioning/`
- [ ] `<presentation-artifact>` emitido
- [ ] Pendências listadas explicitamente
- [ ] Status final: SUCCESS | INCOMPLETE (nunca "parcialmente ok")