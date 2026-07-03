## Objetivo

Consolidar a regra canônica de agendamento numa única fonte reutilizada por todas as camadas, com testes de regressão que falham se qualquer função divergir. Escopo restrito ao agendamento; sem tocar em áreas fora (pipeline, emails, exports que não usem o dataset de slots).

---

## 1. Mapa da regra canônica (situação atual)

| Cálculo | Arquivo/função hoje | Deve virar |
|---|---|---|
| Guardas de inserção (visitante) | `src/lib/booking.functions.ts` → `bookMeeting` | Chamar helper `assertCanBook` |
| Guardas de inserção (admin) | `src/lib/exhibitor-availability.functions.ts` → `bookMeetingForVisitor` | Chamar mesmo `assertCanBook` |
| Classificação de slot p/ visitante | `src/lib/booking.functions.ts` → `listVisitorBookingSlots` | Usar `classifySlot(...)` |
| Classificação de slot p/ reacomodação | `src/lib/dedupe-recovery.functions.ts` → `suggestRecoverySlots` | Usar `classifySlot(...)` |
| Disponibilidade oficial (livre/ocupado por mesa) | `src/lib/exhibitor-availability.functions.ts` → `listExhibitorAvailability` | Usar `slotIsPhysicallyBooked(...)` |
| Lotação por empresa | `listExhibitorAvailability` (já usa `bookedSlotsPerTable` corretamente) | Manter, expor `countBookedSlotsPerCompany` do helper |
| Bucket "sem/com agendamento" | `src/lib/scheduling-status.ts` → `bucketGroupFromMeetings` | Mantido (já é canônico) |
| Agenda operacional / badges | `src/lib/table-agenda.functions.ts`, `staff-exports.functions.ts`, `checkin.functions.ts` | Consumir os mesmos helpers apenas em pontos que classifiquem "livre/ocupado por empresa"; leitura pura de meetings scheduled não muda |
| Histórico de perdas / vencedora | `src/lib/lost-bookings.functions.ts` | Já usa a regra correta (mesma mesa/slot mais antiga válida). Adicionar teste de regressão |
| Trigger DB (verdade absoluta) | `trg_meetings_no_conflict`, `trg_meetings_one_company_per_slot`, índice `uq_meetings_visitor_table_scheduled` | Mantidos — helper TS espelha; testes garantem alinhamento |

### Divergências reais identificadas hoje

1. `suggestRecoverySlots.free` usa `info.companies.size === 0`, o que classifica como `free` slot com meeting de visitor sem `company_id`. `listExhibitorAvailability` marca como ocupado. **Vago numa visão, ocupado noutra.**
2. `suggestRecoverySlots.same_company` não considera meeting com `company_id` NULL misturada com colega da mesma empresa — pode passar como `same_company` slot em estado inconsistente.
3. `listVisitorBookingSlots` marca como `other_company` slots com meeting sem `company_id`? Não — ele exige `cid && cid !== profile.company_id`. Sem company_id, cai em `free`. **Mesma divergência da recovery.**
4. Guardas 2, 3, 3.5 e 4 do backend estão duplicadas byte-a-byte entre `bookMeeting` e `bookMeetingForVisitor`. Manutenção divergente = risco de regressão silenciosa.

---

## 2. Consolidação de regra

### 2.1 Novo módulo: `src/lib/scheduling-rules.ts`

Puro TypeScript, sem I/O. Recebe estruturas já carregadas e devolve decisões. Exporta:

- Tipos `SlotClassification = "free" | "mine" | "same_company" | "other_company" | "self_present"` e `MeetingLite = { table_id, slot_id, visitor_profile_id, visitor_company_id, start_at, end_at, status }`.
- `slotIsPhysicallyBooked(meetingsOnPair: MeetingLite[]): boolean` — `true` se existe qualquer meeting scheduled em `(table_id, slot_id)`. Fonte única do critério "ocupado" da visão oficial.
- `classifySlotForVisitor({ slot, meetingsOnPair, visitorId, visitorCompanyId, visitorBusyStarts, visitorTables })` — retorna `SlotClassification`. Aplica: self-present → `mine`; qualquer meeting de company distinta (incluindo NULL) → `other_company`; sem meeting → `free`; só própria empresa → `same_company`. Cobre conflito pessoal (`visitorBusyStarts.has(start_at)` → `other_company`) e mesma mesa (`visitorTables.has(table_id)` → `other_company`).
- `assertCanBook({ visitor, table, slot, existingScheduledMeetings, sameEventMeetingsAtStart })` — encapsula guardas 2, 3, 3.5, 4. Lança `SchedulingError` com `code` estável (`VISITOR_TIME_CONFLICT`, `DUPLICATE_TABLE`, `SLOT_TAKEN_OTHER_COMPANY`, `COMPANY_ALREADY_AT_START`) e `friendlyMessage`.
- `countBookedSlotsPerCompany(meetings, tablesOfCompany): { total, booked, free }` — regra "1 slot = 1 empresa" (múltiplas da mesma empresa no mesmo par contam 1).

### 2.2 Refatoração de call-sites (sem mudar regra de negócio)

- `booking.functions.ts::bookMeeting` — substitui as 4 guardas por `assertCanBook`. Mantém sido efeitos colaterais (email, notification).
- `exhibitor-availability.functions.ts::bookMeetingForVisitor` — idem, mesma chamada.
- `booking.functions.ts::listVisitorBookingSlots` — usa `classifySlotForVisitor`.
- `dedupe-recovery.functions.ts::suggestRecoverySlots` — descarta bloco atual de `bySlot` e delega a `classifySlotForVisitor`; mantém apenas `same_company` + `free` como sugestões (nunca `other_company`/`mine`).
- `exhibitor-availability.functions.ts::listExhibitorAvailability` — usa `slotIsPhysicallyBooked` no lugar de `bookedSlotIds.has(s.id)`. Contagem por empresa continua via `bookedSlotsPerTable` já correto; opcionalmente delegar a `countBookedSlotsPerCompany` para reduzir código.

### 2.3 Contrato técnico (comentário-cabeçalho do novo módulo)

Bloco fixo com as invariantes:
- 1 slot = 1 empresa (múltiplas pessoas da mesma empresa OK).
- Qualquer meeting scheduled em `(table_id, slot_id)` ocupa fisicamente o par.
- Visitor não pode ter 2 scheduled com mesmo `start_at`.
- Visitor não pode ter 2 scheduled na mesma table.
- Company não pode ter 2 scheduled com mesmo `start_at` em tables diferentes.
- Bucket "com/sem agendamento" = `bucketGroupFromMeetings(count)`; nunca reimplementar.

---

## 3. Testes obrigatórios

Novo arquivo `src/lib/__tests__/scheduling-rules.test.ts` (Vitest, puro, sem DB):

- `same-company-same-slot-allowed`
- `other-company-same-slot-blocked` (`SLOT_TAKEN_OTHER_COMPANY`)
- `visitor-cross-table-time-conflict-blocked` (`VISITOR_TIME_CONFLICT`)
- `visitor-same-table-twice-blocked` (`DUPLICATE_TABLE`)
- `company-cross-table-same-start-blocked` (`COMPANY_ALREADY_AT_START`)
- `slot-with-null-company-meeting-classified-other_company-not-free` (regressão da divergência 1/3)
- `same-company-classification-requires-all-meetings-same-company` (regressão da divergência 2)
- `capacity-count-collapses-same-company-shared-slot` — 20 meetings da mesma empresa no mesmo par contam 1
- `physical-booked-flag-consistent-across-classifier-and-availability` — property test: para qualquer `(table, slot)`, se `classifySlotForVisitor === "free"` para um visitor genérico sem conflitos, então `slotIsPhysicallyBooked === false`; contrapositiva também

Novo arquivo `src/lib/__tests__/scheduling-consistency.test.ts`:

- `recovery-and-availability-agree`: monta cenário sintético e verifica que o conjunto `{slots livres em listExhibitorAvailability}` ⊇ `{slots retornados por suggestRecoverySlots}` para qualquer visitor.
- `no-slot-free-in-ui-that-fails-book`: dispara `classifySlotForVisitor === "free"` → `assertCanBook` deve passar; property test cobrindo todas as combinações de guardas.
- `no-lotada-with-free-slot`: se `countBookedSlotsPerCompany.free > 0`, status nunca é `lotada`.

Novo arquivo `src/lib/__tests__/lost-bookings-winner.test.ts`:

- vencedora = meeting mais antiga scheduled/done/no_show no mesmo `(table_id, slot_id)`.
- Regressão: se todas foram canceladas, vencedora = `null`.

### 3.1 Guard-rail estrutural

Novo arquivo `src/lib/__tests__/scheduling-rule-source-invariant.test.ts` (padrão do já existente `scheduling-bucket-invariant.test.ts`):

- Faz varredura por regex nos arquivos de `src/lib/*.functions.ts` e `src/components/**` e proíbe:
  - novo uso de `"scheduled"` combinado com `slot_id` fora de arquivos allow-list
  - literal `.eq("status", "scheduled")` fora dos módulos autorizados (`booking.functions.ts`, `exhibitor-availability.functions.ts`, `dedupe-recovery.functions.ts`, `lost-bookings.functions.ts`, `table-agenda.functions.ts`, `checkin.functions.ts`, `staff-exports.functions.ts`, `booking-reminders.server.ts`)
  - qualquer arquivo novo que implemente classificação `same_company`/`other_company` sem importar de `@/lib/scheduling-rules`

Efeito: uma nova feature que tente reimplementar a regra falha CI.

---

## 4. Test plan de regressão em produção (checklist manual, `docs/scheduling-regression-checklist.md`)

1. **Booking visitante**: agendar em slot livre; tentar slot com outra empresa → erro amigável; tentar mesmo horário em outra mesa → erro; tentar mesma mesa duas vezes → erro; agendar em slot com colega da mesma empresa → sucesso.
2. **Booking admin (`bookMeetingForVisitor`)**: mesmos 5 casos acima operando por admin.
3. **Disponibilidade do expositor**: contagem `slots_booked` reflete pares únicos, não meetings brutos; status nunca `lotada` com `slots_free > 0`; slot ocupado por empresa X aparece com nome da empresa correta.
4. **Reacomodação**: nenhum slot sugerido `free` falha no rebook; sugestões `same_company` só quando 100% das meetings do par são da própria empresa; após rebook bem-sucedido, sugestão desaparece da próxima refetch.
5. **Histórico de perdas**: cada contato perdido tem vencedora identificada quando existir alguém scheduled/done/no_show no mesmo par mais antigo; `total_found` sinaliza truncamento.
6. **Agenda operacional**: badges de mesa consistentes com dataset (mesma leitura de `status = scheduled`).
7. **PDF/exports** que usem meetings: verificar que continuam usando query direta em `meetings.status = 'scheduled'` — sem regra derivada duplicada.

Cada item tem SQL de verificação anexado no checklist (query pronta para copiar/colar contra o evento ativo).

---

## 5. Guard rails permanentes

- `scheduling-rule-source-invariant.test.ts` (item 3.1) bloqueia introdução de nova classificação paralela.
- `scheduling-bucket-invariant.test.ts` já existe — mantido.
- Comentário-cabeçalho `AI-EDITORS: do not reimplement` no topo de `scheduling-rules.ts` + `scheduling-status.ts`.
- Todas as `SchedulingError` têm `code` estável — UI trata por código, nunca por texto.

---

## 6. Entregáveis finais (quando aprovar o plano)

- **Novos arquivos**: `src/lib/scheduling-rules.ts`, `src/lib/__tests__/scheduling-rules.test.ts`, `src/lib/__tests__/scheduling-consistency.test.ts`, `src/lib/__tests__/lost-bookings-winner.test.ts`, `src/lib/__tests__/scheduling-rule-source-invariant.test.ts`, `docs/scheduling-regression-checklist.md`.
- **Arquivos alterados**: `src/lib/booking.functions.ts`, `src/lib/exhibitor-availability.functions.ts`, `src/lib/dedupe-recovery.functions.ts`. Sem tocar em migrações, triggers, RLS, UI de componentes, emails, exports não-slotless.
- **Prova de verde**: `bunx vitest run` com contagem de testes novos e antes/depois de um caso real (Ambiental Travel Experience e Top Service) mostrando slot que antes divergia e agora bate.

### Riscos residuais que ficarão declarados

- Concorrência real de dois inserts simultâneos continua coberta apenas pelo trigger DB — helper TS reduz janela mas não elimina; teste de invariante DB não cabe no vitest client-side.
- Se um cron/edge function futura fizer insert direto na tabela `meetings` sem passar por `bookMeeting`/`bookMeetingForVisitor`, só os triggers protegem — checklist explicita esse contrato.
- Meetings legadas com `visitor.company_id = NULL` continuarão contando como `other_company` na UI (bloqueio conservador). Auditoria dessa cauda fica fora de escopo.

Nenhuma mudança de regra de negócio, nenhum novo campo, nenhuma alteração de schema. Só consolidação, testes e checklist.
