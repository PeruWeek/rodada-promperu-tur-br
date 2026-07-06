
# Disparo administrativo de agendas por categoria (visitor / exhibitor)

Fluxo novo no Admin para enviar, por lote e por categoria (`visitor` **ou** `exhibitor`, nunca misto), um e-mail com botão que abre uma rota pública rastreável, entrega o PDF individual da agenda do destinatário e registra `sent`, `clicked` e `downloaded` como eventos distintos.

## 1. Fonte canônica de elegibilidade

- Origem única: `listEventRegistrants` em `src/lib/staff-exports.functions.ts`.
- Filtro obrigatório escolhido pelo admin: `role='visitor'` **ou** `role='exhibitor'` (sem opção `ambos`).
- Critério de agenda individual: **`profile_meetings_count > 0`** (não `scheduled_meetings_count`, que é agregado por empresa).
- `getCompanyAgenda` não entra no fluxo.

Novo helper `src/lib/agenda-campaigns.server.ts`:
- `listEligibleRecipients({ eventId, category })` — chama a impl interna já existente `_listEventRegistrantsImpl`, aplica `role === category` + `profile_meetings_count > 0`, normaliza para `{ profileId, email, fullName, companyId, companyName, role, profileMeetingsCount }`.
- `renderAgendaPdfFor({ eventId, profileId })` — retorna `Uint8Array`.

Sobre a agenda individual: hoje `getParticipantAgenda` é apenas um `createServerFn` — não existe helper puro reutilizável. **Refatorar**: extrair o corpo do handler para uma função pura `buildParticipantAgendaData({ supabase, eventId, profileId })` em `src/lib/agenda-campaigns.server.ts` (ou em novo `src/lib/participant-agenda.server.ts`), e reescrever `getParticipantAgenda` para apenas chamar esse helper. Assim `renderAgendaPdfFor` reusa a mesma lógica canônica, sem duplicação, e monta o PDF via `buildAgendaPdf` de `src/lib/pdf.ts`.

## 2. Schema (migration única)

### `agenda_email_campaigns`
`id uuid pk`, `event_id uuid fk events`, `category text CHECK ('visitor','exhibitor')`, `subject text`, `body_md text`, `button_label text`, `created_by uuid fk profiles(id)` (perfil, não `auth.users`), `test_recipient text`, `status text CHECK ('draft','sending','sent','failed')`, `totals jsonb default '{}'`, `created_at`, `updated_at` + trigger `update_updated_at_column`.

### `agenda_email_campaign_recipients`
`id`, `campaign_id fk cascade`, `event_id`, `profile_id`, `role_category`, `recipient_email`, `subject_snapshot`, `body_snapshot`, `button_label_snapshot`, `token_hash bytea unique`, `sent_at`, `send_status text CHECK ('pending','sent','suppressed','failed')`, `error_message`, `clicked_at`, `click_count int default 0`, `downloaded_at`, `download_count int default 0`, `first_click_ip inet`, `metadata jsonb default '{}'`, `created_at`.

Índices: `(campaign_id)`, `(profile_id, event_id)`, `unique(token_hash)`, `(role_category, send_status)`, `(campaign_id, clicked_at)`, `(campaign_id, downloaded_at)`.

RLS / GRANT (ambas tabelas):
- `GRANT SELECT, INSERT, UPDATE ON ... TO authenticated;`
- `GRANT ALL ON ... TO service_role;`
- sem grants para `anon`.
- Policy única por operação com `USING (public.has_role(auth.uid(),'admin'))` + `WITH CHECK` idem.

## 3. Template

`src/lib/email-templates/agenda-delivery.tsx` (React Email), registrado em `registry.ts` e com defaults em `copy-defaults.ts`.

Props: `visitorName`, `eventName`, `bodyHtml`, `buttonLabel`, `buttonUrl`.

Escopo de conteúdo: `body_md` é tratado como **texto/parágrafos simples**. No envio, o servidor faz split por `\n\n`, escapa o texto e emite `<Text>` por parágrafo (sem HTML arbitrário, sem `dangerouslySetInnerHTML`, sem novas deps de markdown/sanitização). Snapshot por destinatário guarda o texto original em `body_snapshot`. Overrides globais existentes de remetente/estrutura continuam válidos.

## 4. Server functions — `src/lib/agenda-campaigns.functions.ts`

Todas com `.middleware([requireSupabaseAuth])`. No início de cada handler:
```ts
const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
await assertAdminRole(supabaseAdmin, context.userId);
```

- `previewEligibleRecipients({ eventId, category })` → `{ total, sample: [primeiros 20] }`.
- `sendTestAgendaCampaign({ eventId, category, subject, body_md, buttonLabel, testEmail })` → toma o primeiro elegível da categoria como amostra da agenda (o token e o link não são persistidos como campanha; envio one-shot para `testEmail`), `idempotencyKey = agenda-test-{admin}-{Date.now()}`.
- `createAndSendAgendaCampaign({ eventId, category, subject, body_md, buttonLabel })`:
  1. Resolve `profileId` do admin via `profiles.auth_user_id = context.userId`.
  2. INSERT `agenda_email_campaigns` (`status='sending'`, `created_by = profileId`).
  3. Resolve elegíveis via helper.
  4. Consulta `suppressed_emails` (por `email`); esses viram row com `send_status='suppressed'` e não são enviados.
  5. Para cada restante: `token = crypto.randomBytes(32)`, `token_hash = sha256(token)`, INSERT recipient com snapshots.
  6. `buttonUrl = ${origin}/api/public/agenda-download/${campaignId}/${token.toString('hex')}` (`origin` vem de `getRequest().url`).
  7. `processTransactionalSend(supabaseAdmin, { templateName:'agenda-delivery', recipientEmail, idempotencyKey:'campaign-{campaignId}-{profileId}', templateData: {...} })`. Comportamento real: SendGrid direto + `email_send_log` (sem fila `transactional_emails`).
  8. UPDATE `send_status`/`sent_at`/`error_message`, com `metadata.idempotency_key`.
  9. Consolida `totals` no lote (`eligible`, `sent`, `failed`, `suppressed`) e move `status` para `sent` (ou `failed` se 100% falhou).
- `listAgendaCampaigns({ filters })` — paginado.
- `getCampaignRecipients({ campaignId, filters: { send_status?, clicked?, downloaded?, email? } })`.

## 5. Rota pública rastreável

Arquivo: `src/routes/api/public/agenda-download.$campaignId.$token.ts` → `createFileRoute("/api/public/agenda-download/$campaignId/$token")`. Path: `/api/public/agenda-download/:campaignId/:token`.

Handler `GET`:
1. Import dinâmico de `supabaseAdmin`.
2. `tokenHash = sha256(hexToBytes(params.token))`.
3. SELECT recipient por `campaign_id = params.campaignId` + `token_hash = tokenHash`. Se ausente → `new Response('Not found', { status: 404 })` genérico.
4. **UPDATE clique isolado (antes do PDF)**:
   ```sql
   UPDATE agenda_email_campaign_recipients
   SET clicked_at = COALESCE(clicked_at, now()),
       click_count = click_count + 1,
       first_click_ip = COALESCE(first_click_ip, :ip),
       metadata = metadata || jsonb_build_object('last_ua', :ua)
   WHERE id = :id
   ```
5. `pdfBytes = await renderAgendaPdfFor({ eventId, profileId })`.
6. **UPDATE download isolado (só após PDF)**:
   ```sql
   UPDATE agenda_email_campaign_recipients
   SET downloaded_at = COALESCE(downloaded_at, now()),
       download_count = download_count + 1
   WHERE id = :id
   ```
7. Response `application/pdf`, `Content-Disposition: attachment; filename="agenda.pdf"`.

Semântica: `clicked` = link válido acessado; `downloaded` = PDF gerado e devolvido pelo servidor.

Segurança: token 256 bits, só hash persistido, 404 genérico em qualquer falha (token inexistente, campanha errada, PDF sem dados), zero eco de dados.

## 6. UI Admin

Novo `src/components/admin/agenda-campaigns-tab.tsx`, nova aba "Disparo de agendas" em `src/routes/_authenticated/admin.tsx`.

- Radio obrigatório `Visitantes` | `Expositores`.
- Select de evento (default: evento ativo).
- Botão "Contar elegíveis" → mostra total + tabela dos primeiros 20 (nome, empresa, e-mail, nº reuniões).
- Inputs `Assunto`, `Texto` (textarea), `Label do botão`, `E-mail de teste`.
- Botões "Enviar teste" e "Disparar lote" (Dialog de confirmação com total + categoria).
- Painel "Histórico" — lista de campanhas com KPIs `elegíveis / enviados / falhas / cliques / downloads`; expandir mostra destinatários com filtros (status, clicou, baixou, e-mail).

## 7. Integração com infraestrutura existente

- `processTransactionalSend` (SendGrid direto + `email_send_log`).
- `suppressed_emails` respeitado antes do envio.
- Unsubscribe segue o padrão atual do sistema.
- SendGrid click tracking não é fonte de verdade — verdade vive nas tabelas novas.
- Nenhuma alteração na agenda funcional além da refatoração de `getParticipantAgenda` para extrair o helper puro.

## 8. Evidências entregues ao final

- Lista de arquivos criados/alterados.
- Migration SQL, com nomes de tabelas e índices.
- Nomes das server functions.
- Path exato: `/api/public/agenda-download/:campaignId/:token`.
- Trecho do helper mostrando reuso de `_listEventRegistrantsImpl` + filtro `profile_meetings_count > 0`.
- Trecho mostrando `getParticipantAgenda` refatorado para chamar `buildParticipantAgendaData`, e `renderAgendaPdfFor` reusando o mesmo helper + `buildAgendaPdf`.
- Trecho da rota com UPDATE isolado de `clicked_at` (passo 4) e UPDATE isolado de `downloaded_at` (passo 6).
- Screenshots (Playwright headless) do Admin: fluxo `visitor` isolado, fluxo `exhibitor` isolado, histórico com colunas de clique e download separadas.
- Confirmação de que perfil com `profile_meetings_count = 0` não aparece em `previewEligibleRecipients` nem no lote.

## Fora do escopo

Automação recorrente; lote misto; envio para perfis sem agenda individual; uso de `getCompanyAgenda`; SendGrid tracking como verdade; mudanças na agenda funcional além da refatoração necessária para reusar o helper puro.
