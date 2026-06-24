
## Diagnóstico — serviço de e-mail atual

- **Provedor**: SendGrid (HTTP API), enviado de `rodada@promperu.tur.br`.
- **Configuração**: secret `SENDGRID_API_KEY` no backend.
- **Rota de envio**: `src/routes/lovable/email/transactional/send.ts` (TanStack server route) — autenticada por JWT do usuário, renderiza React Email, registra em `email_send_log`, respeita `suppressed_emails` e gera link de unsubscribe.
- **Registry de templates**: `src/lib/email-templates/registry.ts` (hoje só `meeting-confirmation` e `meeting-cancelled`).
- **E-mail nativo do Supabase Auth**: continua existindo (confirmação opcional) e fica separado deste fluxo.

Conclusão: já existe infra própria de transacional via SendGrid. Basta adicionar 1 template novo + 1 disparo idempotente. Nada de tocar no fluxo principal (success 3s → /agenda).

---

## O que vai ser feito

### 1. Novo template `buyer-welcome`

Arquivo novo: `src/lib/email-templates/buyer-welcome.tsx`

- React Email (mesmos componentes/estilo de `_shared.tsx` que `meeting-confirmation` usa: `main`, `container`, `h1`, `text`, `button`, `card`, `small`, `footer`).
- Props: `visitorName?: string`, `agendaUrl?: string` (default `https://rodada.promperu.tur.br/agenda`).
- Conteúdo (pt-BR) conforme template aprovado:
  - Saudação `Olá, {visitorName}!` (fallback `Olá!`)
  - Confirmação de cadastro concluído no PERU MICE Networking Event
  - Aviso que a agenda já está disponível
  - Botão CTA "Acessar minha agenda" → `/agenda`
  - Lista do que pode fazer na plataforma (agenda, atualizações, dados, próximas interações)
  - Recomendação de acesso regular
  - Suporte / encerramento "Equipe PERU MICE Networking Event"
- `subject`: `Cadastro confirmado | PERU MICE Networking Event`
- `displayName`: `Buyer welcome`
- `previewData` para preview no dashboard de e-mails.

### 2. Registrar no registry

Editar `src/lib/email-templates/registry.ts`: import + entrada `'buyer-welcome': buyerWelcome`.

### 3. Disparo único após cadastro do buyer

Editar `src/routes/onboarding.tsx`, dentro do efeito de auto-finalização do buyer, **logo após** `complete_buyer_signup` retornar sucesso e ANTES de `setBuyerSuccess(true)` (não bloqueante — `void` + try/catch que nunca quebra o fluxo):

- Idempotência: ler `user.user_metadata.welcome_email_sent_at`. Se já existir, pular.
- Caso contrário:
  1. `POST /lovable/email/transactional/send` com header `Authorization: Bearer ${session.access_token}` e body:
     ```json
     {
       "templateName": "buyer-welcome",
       "recipientEmail": "<user.email>",
       "idempotencyKey": "buyer-welcome-<user.id>",
       "templateData": { "visitorName": "<primeiro nome>", "agendaUrl": "https://rodada.promperu.tur.br/agenda" }
     }
     ```
  2. Em caso de sucesso, `supabase.auth.updateUser({ data: { welcome_email_sent_at: new Date().toISOString() } })`.
- Erros: apenas `console.warn`. Nunca tocam no `setBuyerSuccess`, nem no timer de 3s, nem no redirect `/agenda`.

Idempotência tem 3 camadas: (a) flag em `user_metadata`, (b) `idempotencyKey` no log, (c) `suppressed_emails` já tratado pela rota.

### 4. Fluxo principal — intocado

- Tela de sucesso 3s, redirect `/agenda`, `/onboarding`, signup, `auth/callback`, expositor/admin/staff/cliente: nenhuma alteração.

---

## Arquivos alterados / criados

- **Novo**: `src/lib/email-templates/buyer-welcome.tsx`
- **Editado**: `src/lib/email-templates/registry.ts` (registra template)
- **Editado**: `src/routes/onboarding.tsx` (disparo idempotente após `complete_buyer_signup`)

## Critérios de aceite

- Buyer conclui cadastro → recebe e-mail `Cadastro confirmado | PERU MICE Networking Event` com CTA para `/agenda`.
- Reentrar em `/onboarding` ou re-disparar o efeito não envia segundo e-mail (flag `welcome_email_sent_at`).
- Falha de envio não bloqueia tela de sucesso nem o redirect de 3s.
- E-mail nativo do Supabase Auth permanece independente.

Aprovado, mando ver.
