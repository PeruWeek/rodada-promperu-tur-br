# Checklist de regressão — agendamento

Executar após qualquer mudança em `scheduling-rules.ts`, `booking.functions.ts`,
`exhibitor-availability.functions.ts`, `dedupe-recovery.functions.ts`,
`lost-bookings.functions.ts` ou em qualquer trigger/índice de `meetings`.

Todas as SQLs abaixo assumem `:event_id` = evento ativo.

## 1. Booking visitante (`bookMeeting`)

- [ ] Agendar em slot livre — sucesso.
- [ ] Tentar slot ocupado por OUTRA empresa → erro amigável `SLOT_TAKEN_OTHER_COMPANY`.
- [ ] Tentar mesmo `start_at` em outra mesa → erro `VISITOR_TIME_CONFLICT`.
- [ ] Tentar mesma mesa duas vezes → erro `DUPLICATE_TABLE`.
- [ ] Agendar em slot com colega da MESMA empresa → sucesso.
- [ ] Empresa já em outra mesa no mesmo `start_at` → erro `COMPANY_ALREADY_AT_START`.

## 2. Booking admin (`bookMeetingForVisitor`)

Repetir os 6 casos acima operando como admin/staff/cliente.

## 3. Disponibilidade do expositor (`listExhibitorAvailability`)

- [ ] `slots_booked` conta pares únicos `(table_id, slot_id)`, não meetings brutos.
- [ ] Status nunca é `lotada` quando `slots_free > 0`.
- [ ] Card `Com agendamento · N` do expositor NUNCA excede o total de slots
      físicos da(s) mesa(s) da empresa. Métrica vem de
      `v_company_event_pipeline.scheduled_meetings_count` (ramo `exhibitor`),
      que deve estar contando `DISTINCT (table_id, slot_id)`.

```sql
-- Pares fisicamente ocupados por mesa
SELECT et.id AS table_id, et.table_number, COUNT(DISTINCT m.slot_id) AS booked_pairs
FROM event_tables et
LEFT JOIN meetings m
  ON m.table_id = et.id AND m.status = 'scheduled'
WHERE et.event_id = :event_id
GROUP BY et.id, et.table_number
ORDER BY et.table_number;
```

## 4. Reacomodação (`suggestRecoverySlots` + `rebookImpacted`)

- [ ] Cada slot sugerido `free` roda `rebookImpacted` com sucesso.
- [ ] Sugestões `same_company` só aparecem quando 100% dos meetings do par são da própria empresa.
- [ ] Após rebook OK, a sugestão desaparece na próxima refetch.
- [ ] Nenhuma sugestão viola guarda 5 (empresa em outra mesa no mesmo `start_at`).

```sql
-- Simular guarda 5 para o contato :profile_id
SELECT ts.start_at, array_agg(DISTINCT m.table_id) AS company_tables
FROM meetings m
JOIN time_slots ts ON ts.id = m.slot_id
JOIN profiles p ON p.id = m.visitor_profile_id
WHERE m.status = 'scheduled'
  AND m.event_id = :event_id
  AND p.company_id = (SELECT company_id FROM profiles WHERE id = :profile_id)
GROUP BY ts.start_at
HAVING COUNT(DISTINCT m.table_id) > 1;
```

## 5. Histórico de perdas (`listLostBookings`)

- [ ] Vencedora existe para todo par `(table_id, slot_id)` com meeting `scheduled|done|no_show`.
- [ ] `winner_source = 'audit_log'` quando `audit_logs.payload.kept_meeting_id` aponta para meeting viva.
- [ ] `total_found` reflete todas as perdas antes do `limit`; `truncated` sinaliza corte.

## 6. Agenda operacional / badges

- [ ] Contagens batem com `meetings.status = 'scheduled'` puro.
- [ ] Nenhum badge deriva de coluna textual `scheduling_status` — usa `bucketGroupFromMeetings`.

## 7. Exports / PDF

- [ ] Exports que dependam de meetings não implementam regra derivada — leitura direta.
- [ ] PDFs de disponibilidade lêem `listExhibitorAvailability` como fonte única.

## Automáticos

Todos os testes em `src/lib/__tests__/scheduling*.test.ts` e
`lost-bookings-winner.test.ts` devem passar antes de publicar:

```sh
bunx vitest run src/lib/__tests__/scheduling-rules.test.ts \
                src/lib/__tests__/scheduling-rule-source-invariant.test.ts \
                src/lib/__tests__/scheduling-bucket-invariant.test.ts \
                src/lib/__tests__/scheduling-status.test.ts \
                src/lib/__tests__/lost-bookings-winner.test.ts
```