## Executado
- Migração aplicada. Auditoria pré: **19 conflitos** em 8 mesas. Auditoria pós: **0**. Índice `uq_meetings_table_slot_scheduled` criado. Para cada uma das 19 reuniões canceladas com `cancel_reason='admin_dedupe_table_slot'` foram gravados `audit_logs` + `notifications` para visitante e expositor.

## Pendente (build mode)

### `src/lib/booking.functions.ts`
Após a guarda `sameTable`, antes da guarda `companyClash`:
```ts
const { data: slotTaken } = await supabaseAdmin
  .from("meetings")
  .select("id").eq("table_id", data.tableId).eq("slot_id", data.slotId)
  .eq("status", "scheduled").maybeSingle();
if (slotTaken) throw new Error(
  "Este horário acabou de ser reservado por outro participante. Escolha outro slot.");
```

### `src/lib/exhibitor-availability.functions.ts`
Mesma guarda inserida após a `Guarda 3 — sameTable`, antes da `Guarda 4 — companyClash`.

### `src/components/booking-dialog.tsx`
No `onError`, detectar `acabou de ser reservado` e `uq_meetings_table_slot_scheduled` → toast dedicado + `qc.invalidateQueries({ queryKey: ["booking-slots", exhibitorProfileId] })`.

### `src/components/admin/book-for-registrant-dialog.tsx`
Substituir `onError: (e) => toast.error(e.message)` por handler que detecta os mesmos marcadores, mostra mensagem canônica em PT-BR e invalida `["exhibitor-availability"]` + `["booking-slots"]`.

## Evidências finais (após build)
- Reexecutar auditoria — 0.
- Tentar INSERT duplicado — falhará com `duplicate key value violates unique constraint "uq_meetings_table_slot_scheduled"`.
- Screenshot da Mesa 3 mostrando 1 ocupante por slot.

## Arquivos alterados
- `supabase/migrations/<ts>_dedupe_table_slot.sql` (aplicado)
- `src/lib/booking.functions.ts`
- `src/lib/exhibitor-availability.functions.ts`
- `src/components/booking-dialog.tsx`
- `src/components/admin/book-for-registrant-dialog.tsx`
