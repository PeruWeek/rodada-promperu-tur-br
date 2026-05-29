
# Plano — Rodada Peru 2026

O escopo é grande (auth, perfis bilíngues, descoberta, agendamento anti-conflito, agenda + PDF, check-in mobile, notificações in-app + e-mail, admin). Vou entregar em **5 fases**, cada uma testável de ponta a ponta. Você aprova esta fase 1 e seguimos.

## Notas de stack (importantes)

- O template é **TanStack Start** (não Vite SPA puro). Para lógica de servidor da aplicação eu uso **server functions** do TanStack (`createServerFn`), não Supabase Edge Functions. Edge Functions só entram se você precisar de uma URL Supabase fixa (não é o caso aqui).
- **SendGrid**: chamado de dentro de uma server function com `SENDGRID_API_KEY` como secret. Vou pedir o secret no momento de ligar notificações (Fase 4).
- **PDF**: gerado server-side com `pdf-lib` (compatível com o runtime Worker). Sem `puppeteer`/`sharp`.
- **Schema SQL**: aplico o `schema-rodada-peru-2026.sql` integralmente via migration, e adiciono **RLS ativada** desde o início (não comentada), mais tabelas `notifications` e `email_delivery_logs`.
- **i18n**: `react-i18next` + switcher PT/ES no header, persistido em `profiles.preferred_language` (logado) e `localStorage` (anônimo).
- **Design**: tokens em `src/styles.css` em oklch, derivados de #D52B1E / #FFFFFF / #6E6E6E / #111111. Fonte: tentar Source Sans 3 (próxima da peru.travel); se você preferir outra, ajusto.

## Fase 1 — Fundação (esta entrega)

1. **Migration Supabase** com o schema completo + `notifications` + `email_delivery_logs` + função `has_role()` security-definer + RLS ativa em todas as tabelas com policies por role (visitor/exhibitor/staff/admin) + seed do `events` (08/07/2026), `event_tables` (10), `time_slots` (janelas 09:00–14:15, 16:15–18:30, pausa 12:00–12:15).
2. **Design system**: tokens oklch + tipografia + componentes base (Button, Input, Card, Dialog, Badge) seguindo paleta peru.travel.
3. **i18n PT/ES** com switcher no header + persistência.
4. **Auth + onboarding**: login/cadastro Supabase, escolha visitor/exhibitor, criação de `profiles` + `companies` + perfil específico.
5. **Landing pública** bilíngue.
6. **Shell autenticado** com nav (Dashboard, Explorar, Minha Agenda, Perfil; itens extras para exhibitor/staff/admin).

## Fase 2 — Perfis + Descoberta
- Edição de perfil (visitor/exhibitor) com campos `*_pt`/`*_es`, interesses, portfólio, links.
- Lista de expositores com filtros (segmento, destino, serviço) e página do expositor com slots disponíveis.

## Fase 3 — Agendamento + Agenda + PDF
- Server function `bookMeeting` com transação + validação de limite (5/visitante) + reliance no trigger anti-conflito do schema.
- Telas "Minha Agenda" (visitor) e "Agenda da Mesa" (exhibitor).
- Server route `/api/agenda-pdf?scope=me|table|staff` com `pdf-lib`, no idioma do usuário.

## Fase 4 — Notificações (in-app + e-mail SendGrid)
- Tabelas `notifications` + `email_delivery_logs` (já criadas na Fase 1).
- Server function `dispatchNotification` chamada em create/cancel/reschedule.
- Sino/inbox + contador + toast.
- Pedido do secret `SENDGRID_API_KEY` (e `SENDGRID_FROM_EMAIL`) neste momento.

## Fase 5 — Staff/Admin mobile-first
- Gestão de mesas e associação expositor↔mesa.
- Check-in geral + por reunião (botões grandes, busca rápida, 1-toque presente/atraso/no-show).
- Encaixes/walk-in com validação.
- Exports CSV + PDF de contingência.
- Auditoria via `audit_logs`.

## Detalhes técnicos relevantes
- **Roles** em `user_roles` separada (não em `profiles`) para evitar escalonamento — diverge do schema original que põe `role` em `profiles`; vou manter o campo em `profiles` para leitura, mas a autoridade de checagem RLS usa `user_roles` + `has_role()`. Confirmo isso na implementação.
- **Anti-conflito**: confio nos `UNIQUE` parciais + trigger do schema; a server function captura o erro e devolve mensagem amigável bilíngue.
- **PDF runtime**: `pdf-lib` puro JS, sem fontes nativas — embuto fonte standard.

## Pergunta antes de eu começar a Fase 1

Posso seguir com **Fase 1 agora** (migration + design + i18n + auth/onboarding + landing + shell) e depois ir liberando as próximas fases uma a uma? Ou você prefere que eu tente entregar Fases 1+2+3 numa única leva (maior risco de erros, mas menos rounds)?
