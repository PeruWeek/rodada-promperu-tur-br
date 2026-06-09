# Migrar envio de e-mails para SendGrid

## Objetivo

Trocar o provedor de envio dos e-mails transacionais (confirmação/cancelamento de reunião, e quaisquer próximos templates) da infra interna Lovable para a API do SendGrid, usando como remetente:

- **From:** `Rodada de Negócios PromPerú <rodada@promperu.tur.br>`
- **Reply-To:** `rodada@promperu.tur.br`

O sender `rodada@promperu.tur.br` já está validado no SendGrid (Single Sender ou domínio autenticado), então não é necessário mexer em DNS.

## O que preciso de você

1. **`SENDGRID_API_KEY`** — uma API Key do SendGrid com permissão **Mail Send** (Restricted Access → Mail Send: Full). Vou abrir um campo seguro pra você colar; nunca aparece no código.
2. Confirmação de que `rodada@promperu.tur.br` está mesmo verificado no SendGrid (Settings → Sender Authentication). Se for Single Sender, ok; se for domínio autenticado em `promperu.tur.br`, melhor ainda (DKIM já assina).
3. Um e-mail destino para o teste de envio (pode ser o seu).

Não precisa mexer em DNS nem desligar a infra Lovable atual — o domínio `rsvp.promperu.tur.br` continua delegado à Lovable mas deixa de ser usado pra envio. Os e-mails de **autenticação** (signup, recuperação de senha, etc.) continuarão pela Lovable, porque o Supabase Auth chama um webhook próprio; só os **transacionais do app** mudam para SendGrid.

## O que vai mudar no código

### 1. Reescrever o `POST /lovable/email/transactional/send`
Em vez de chamar `supabase.rpc('enqueue_email', ...)` (fila pgmq + dispatcher Lovable), o handler:
- Renderiza o template React Email (igual hoje).
- Faz `POST https://api.sendgrid.com/v3/mail/send` com `Authorization: Bearer ${SENDGRID_API_KEY}`.
- Mantém todas as checagens atuais: autenticação Supabase do chamador, supressão (`suppressed_emails`), token de unsubscribe (`email_unsubscribe_tokens`), log em `email_send_log` (status `sent` / `failed` + `error_message` do SendGrid).
- Adiciona header `Reply-To: rodada@promperu.tur.br` e categoria/`custom_args` com `template_name` e `message_id` pra rastreio no painel SendGrid.

### 2. Footer de unsubscribe
Hoje a infra Lovable injeta o rodapé automaticamente. Com SendGrid, isso some — então passo a inserir o link `https://rodada.promperu.tur.br/unsubscribe?token=...` no HTML/texto renderizado antes do envio (mesma página de unsubscribe que já existe).

### 3. Webhook de bounces/spam (opcional, recomendado)
Crio uma rota pública `/api/public/sendgrid-webhook` que recebe Event Webhook do SendGrid (`bounce`, `dropped`, `spamreport`, `unsubscribe`) e insere em `suppressed_emails`. Assim a lista de supressão continua viva. Verifica assinatura ECDSA do SendGrid (`X-Twilio-Email-Event-Webhook-Signature`).

Se você não quiser configurar webhook agora, pulo esse item — supressão por bounce deixa de ser automática.

### 4. Botão de teste no Admin
Adiciono na aba **Auditoria** (ou crio uma aba **E-mails**) um botão "Enviar e-mail de teste" que dispara o template `meeting-confirmation` com dados fictícios para um endereço informado, e mostra o resultado (id do SendGrid + status gravado em `email_send_log`).

## O que NÃO muda

- Templates React Email em `src/lib/email-templates/` (visual idêntico).
- Tabelas `email_send_log`, `suppressed_emails`, `email_unsubscribe_tokens`, página `/unsubscribe`.
- Fluxo de auth (signup/recuperação) continua pela Lovable.
- Domínio `rsvp.promperu.tur.br` permanece configurado (pode remover depois se quiser; não atrapalha).

## Passos da execução (quando você aprovar)

1. Você fornece `SENDGRID_API_KEY` no campo seguro.
2. Reescrevo o handler de envio + injeção do footer de unsubscribe.
3. (Opcional) Crio o webhook de eventos e te passo a URL pra colar em SendGrid → Settings → Mail Settings → Event Webhook.
4. Adiciono o botão de teste no Admin.
5. Disparo um teste pro endereço que você indicar e te mostro o registro em `email_send_log`.

## Me confirma antes de eu começar

- Pode usar **Reply-To** = `rodada@promperu.tur.br` e **From name** = "Rodada de Negócios PromPerú"? (ou prefere outro nome de exibição)
- Quer o **webhook de bounces/spam** do SendGrid agora ou deixa pra depois?
- Qual e-mail usar no teste final?
