## Situação

O hook de e-mail de cadastro **executou com sucesso** no Auth às 22:06:07 para `peruweek@gmail.com` (status 200 no `api.lovable.dev/.../email-hook`). Ou seja: o Supabase chamou o serviço de e-mail do Lovable, que aceitou e enfileirou o envio.

Mesmo assim você não recebeu. As causas possíveis, em ordem de probabilidade:

1. **Caixa de spam / promoções do Gmail** — o mais comum quando "antes chegava e agora não".
2. **Endereço suprimido pelo provedor** — se em testes anteriores o Gmail devolveu bounce ou você clicou em "marcar como spam", o endereço entra numa lista de supressão e os próximos envios são silenciosamente bloqueados.
3. **Throttling temporário do Gmail** para o domínio remetente (`rsvp.promperu.tur.br`) por excesso de testes recentes para o mesmo endereço.

Hoje o projeto **não tem a infraestrutura padrão de logs de e-mail instalada** (`email_send_log`, `suppressed_emails`, fila pgmq). A tabela existente `email_delivery_logs` está vazia e não é alimentada por nada. Por isso não consigo ver no banco se o e-mail saiu, foi entregue, deu bounce ou foi suprimido — só vejo que o Auth chamou o hook.

## Plano

### 1. Ação imediata sua (sem código)
- Verificar **Spam**, **Promoções** e **Lixeira** do Gmail filtrando por `rsvp.promperu.tur.br` ou "Rodada".
- Se encontrar, marcar como "Não é spam" / mover para Caixa de entrada — isso destrava entregas futuras.
- Tentar **reenviar a confirmação** pela tela de login (já existe o botão "Reenviar confirmação" quando o link expira) ou se cadastrar com um endereço alternativo (ex.: outro Gmail, Outlook) para confirmar que o envio funciona em geral.

### 2. Instalar a infraestrutura de e-mails do Lovable
Para que daqui em diante tenhamos rastreabilidade real (e não dependamos só de "o hook respondeu 200"):

- Rodar `setup_email_infra` para criar:
  - tabela `email_send_log` (status por mensagem: pending / sent / dlq / suppressed / bounced / complained)
  - tabela `suppressed_emails` (endereços bloqueados por bounce/spam)
  - fila pgmq + cron de processamento + retries
- Migrar o hook de auth atual para a versão enfileirada via `scaffold_auth_email_templates` (com `confirm_overwrite: true`), preservando os templates existentes em `src/lib/email-templates/signup.tsx` etc. Isso passa o envio pelo `email_send_log`.

Depois disso eu consigo te responder com precisão "o e-mail para peruweek@gmail.com saiu? bounceu? está suprimido?" — basta consultar a tabela.

### 3. Painel de e-mails na dashboard admin (opcional, mas recomendado)
Como você já tem a dashboard admin/staff em `/admin`, faz sentido adicionar uma aba **"E-mails"** com:
- filtros por período (24h / 7d / 30d / custom), template e status
- contadores de enviados / falhos / suprimidos (deduplicados por `message_id`)
- tabela com último status de cada envio (template, destinatário, status, timestamp, erro)
- ação rápida "remover da supressão" para liberar um endereço

Assim qualquer falha futura ("fulano não recebeu") é resolvida sem precisar me chamar.

## Fora de escopo
- Trocar provedor de e-mail (Resend/SendGrid). O domínio `rsvp.promperu.tur.br` já está verificado e delegado ao Lovable; trocar agora exigiria remover NS no registrador e esperar até 72h.
- Mexer em templates de e-mail (visual, copy) — fica para outro pedido se precisar.
- Mexer em RLS de outras tabelas.

## O que eu preciso de você antes de implementar
Confirma só duas coisas:
1. Você já checou Spam/Promoções? (para sabermos se é entrega ou supressão)
2. Posso seguir com os passos **2 e 3** (infra de logs + aba "E-mails" na dashboard admin)?
