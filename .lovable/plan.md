## Objetivo
Enviar e-mail transacional ao **visitante** quando uma reunião é agendada ou cancelada, usando a infraestrutura já provisionada em `rsvp.promperu.tur.br`. Bilíngue (PT-BR / ES) conforme `preferred_language` do perfil.

> Nota: o expositor já recebe notificação in-app a cada agendamento/cancelamento. Se quiser e-mail para o expositor também, me avise — por padrão, fica só in-app.

## Templates a criar
Em `src/lib/email-templates/`:

1. **`meeting-confirmation.tsx`** — confirmação ao visitante
   - Props: `language` ("pt-BR"|"es"), `visitorName`, `exhibitorCompany`, `tableNumber`, `slotStart` (ISO), `slotEnd` (ISO), `agendaUrl`
   - Assunto: PT "Reunião confirmada — {exhibitorCompany}" / ES "Reunión confirmada — {exhibitorCompany}"
   - Conteúdo: saudação, dados (empresa, mesa, horário formatado em `America/Sao_Paulo`), CTA "Ver minha agenda" → `agendaUrl`

2. **`meeting-cancelled.tsx`** — cancelamento ao visitante
   - Props iguais
   - Assunto: PT "Reunião cancelada — {exhibitorCompany}" / ES "Reunión cancelada — {exhibitorCompany}"
   - Conteúdo: aviso de cancelamento, dados da reunião, CTA "Agendar outro horário" → `/explore`

Registrar ambos em `src/lib/email-templates/registry.ts` com `previewData`.

## Helper de envio
Criar `src/lib/email/send.ts` com `sendTransactionalEmail()` chamando `POST /lovable/email/transactional/send` com JWT do usuário (padrão da documentação).

## Wiring nos server functions
Em `src/lib/booking.functions.ts`:

- **`bookMeeting`**: após inserir a reunião com sucesso, buscar dados do visitante (nome, e-mail, `preferred_language`), do expositor (`companies.trade_name`), do `event_tables.table_number` e do `time_slot` (start/end). Disparar `sendTransactionalEmail` com `templateName: 'meeting-confirmation'` e `idempotencyKey: meeting-confirm-{meetingId}`. Erro de e-mail **não** deve falhar o agendamento (try/catch + log).
- **`cancelMeeting`**: idem com `meeting-cancelled` e `idempotencyKey: meeting-cancel-{meetingId}`.

Como o `send-transactional-email` valida JWT do chamador autenticado, e estamos chamando server-to-server, vou usar a abordagem recomendada: chamar via `fetch` para a própria origem usando o token do usuário já disponível no `requireSupabaseAuth` middleware (cabeçalho repassado), evitando criar rota pública. URL base via `request.url` / variável de ambiente do site.

## i18n e estilo
- Strings dos e-mails ficam dentro do próprio `.tsx` (branch por `language`), não nos JSONs do app — templates são server-rendered.
- Visual alinhado ao app: tipografia Source Sans 3, fundo `#ffffff`, accent na cor primária do projeto (vou ler `src/styles.css` para extrair). Sem links de unsubscribe (o sistema injeta automaticamente).

## Fora de escopo
- E-mail para o expositor (continua só in-app).
- E-mail de lembrete pré-evento, PDF anexo (não há suporte a anexos — link para agenda já cobre).
- Reenvio em lote / campanhas.

Confirma que sigo assim?
