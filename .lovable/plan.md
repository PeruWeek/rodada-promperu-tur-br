## Diagnóstico atualizado

- `cron.job` `process-email-queue` aponta para a URL de **preview** (`id-preview--9163060e-...lovable.app/lovable/email/queue/process`).
- O bundle do preview tem uma `SUPABASE_SERVICE_ROLE_KEY` antiga embutida → rota responde 403 ao comparar `token !== supabaseServiceKey`.
- Republicar atualizou a produção (`rodada-promperu-tur-br.lovable.app`), mas não reescreveu a URL do cron.
- Segredo `email_queue_service_role_key` no Vault está correto (sincronizado com a service-role atual); o problema é só a URL de destino do cron.

## Ação

1. Reexecutar `email_domain--setup_email_infra` para reprovisionar o cron apontando para a URL estável do projeto (`project--9163060e-b183-4ce2-8782-e5a412537db3.lovable.app`), que serve a build publicada (produção).
2. Aguardar 1 ciclo (≤10s) e validar:
   - `net._http_response` voltando 200.
   - `pgmq.q_auth_emails` esvaziando.
   - Linhas em `email_send_log` passando de `pending` → `sent`.
3. Se a mensagem original já tiver expirado (TTL 15 min), pedir um novo "Esqueci minha senha" para confirmar entrega ponta-a-ponta.
4. Se o 403 persistir após a reprovisão, inspecionar logs da rota `/lovable/email/queue/process` para outro motivo de rejeição (ex.: divergência de service-role entre produção e Vault).

## Fora do escopo

- Migrar para SendGrid.
- Alterar formulário, templates ou textos de e-mail.
- Editar manualmente SQL do cron ou segredos do Vault.
