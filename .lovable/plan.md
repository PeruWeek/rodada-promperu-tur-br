## Objetivo

Destravar o envio de e-mails (incluindo "Esqueci minha senha") que está parado por erro 403 nas chamadas do cron à rota de processamento da fila.

## Diagnóstico (confirmado nos dados)

- 2 mensagens de `recovery` presas em `pgmq.q_auth_emails` com `read_ct=0`.
- Cron `process-email-queue` roda a cada 5s normalmente.
- Todas as últimas respostas em `net._http_response`: HTTP 403 `{"error":"Forbidden"}`.
- Causa: segredo `email_queue_service_role_key` no Vault está desatualizado em relação à service-role atual.

## Ação

1. Reexecutar a configuração da infra de e-mail (operação idempotente que apenas atualiza o segredo do Vault e reaplica permissões; não recria filas, tabelas nem mexe em templates).
2. Aguardar 1 ciclo do cron e validar:
   - `net._http_response` voltando 200.
   - `pgmq.q_auth_emails` esvaziando.
   - Linhas em `email_send_log` passando de `pending` para `sent`.
3. Se as 2 mensagens atuais já tiverem expirado (TTL auth = 15 min, então provavelmente caíram em DLQ), pedir um novo "Esqueci minha senha" para gerar nova mensagem e confirmar entrega ponta-a-ponta.
4. Caso o 403 persista após o passo 1, investigar logs da rota `/lovable/email/queue/process` para identificar outro motivo de rejeição.

## Não está no escopo

- Migrar para SendGrid (a infra atual usa o pipeline do Lovable; SendGrid não está configurado no projeto).
- Mudar/validar fluxo do formulário de "Esqueci minha senha".
- Alterar templates ou textos de e-mail.
