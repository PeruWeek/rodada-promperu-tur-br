
## Causa raiz

`suggestRecoverySlots` (em `src/lib/dedupe-recovery.functions.ts`) reproduz apenas 3 das 4 guardas de `bookMeetingForVisitor`:

| Guarda backend | Recovery reproduz? |
|---|---|
| G2 — visitor já tem reunião no mesmo `start_at` (qualquer mesa) | ✅ `myStarts` |
| G3 — visitor já tem reunião na mesma mesa | ✅ `myTables` |
| G3.5 — outra empresa já ocupa `(table_id, slot_id)` | ✅ `bySlot.companies` |
| **G4 — a empresa do visitor já tem reunião no mesmo `start_at` em OUTRA mesa** | ❌ **não checado** |

Consequência real: se o colega João (mesma empresa) tem reunião às 10:30 na mesa 5, e a mesa 12 tem o slot das 10:30 vazio, `suggestRecoverySlots` classifica como `free`. Ao confirmar, o backend dispara G4: *"Esta empresa já possui uma reunião agendada neste horário em outra mesa."* → o slot exibido como `livre` é rejeitado como `ocupado`.

O mesmo vale para o branch `same_company`: se além do colega no próprio slot existir um segundo colega da mesma empresa em outra mesa no mesmo `start_at`, G4 também rejeita.

Bug secundário: as sugestões não são invalidadas após um rebook bem-sucedido, então o admin pode ver um slot já consumido por ele mesmo.

## Correção

**Arquivo:** `src/lib/dedupe-recovery.functions.ts` (único arquivo backend alterado)

1. Além de `myStarts`/`myTables`, computar `companyStartTables: Map<start_at, Set<table_id>>` a partir de `meetingList`, considerando apenas meetings cuja `visitor.company_id === profile.company_id` (quando `profile.company_id != null`).
2. Ao avaliar um slot `s` para a mesa `t`:
   - `free`: exigir também `!companyStartTables.has(s.start_at)` OU (o único table_id registrado é `t` — cobre o caso de colega já sentado na mesma mesa, tratado no branch `same_company`).
   - `same_company`: além das checagens atuais, exigir que `companyStartTables.get(s.start_at)` contenha somente `t` (nenhuma outra mesa da mesma empresa naquele horário).
3. Não alterar semântica da UI dos rótulos: `free`, `same_company` continuam existindo; agora refletem exatamente o que o backend aceita.

**Arquivo:** `src/components/admin/dedupe-recovery-tab.tsx` (UI)

4. Após `rebookImpacted` retornar `ok: true`, invalidar as queries `["dedupe-recovery-suggestions", profileId]` e `["dedupe-impacted", ...]` para forçar refetch antes de nova sugestão. Se já existe, apenas garantir que a invalidação ocorra.
5. Configurar `useQuery` das sugestões com `staleTime: 0` e `refetchOnWindowFocus: true` (leve, só nessa aba) para reduzir janela de stale.
6. No handler que confirma a sugestão, se o backend responder `SLOT_TAKEN_OTHER_COMPANY` ou `SLOT_CONFLICT`, refetch imediato das sugestões e mostrar toast "Sugestões atualizadas".

## Isolamento

- **Zero mudanças** em `bookMeetingForVisitor`, `booking.functions.ts`, triggers, migrations, índices, RLS, `lost-bookings.functions.ts`, `dedupe-recovery-bus.ts`.
- Ajuste é 100% na classificação e no refetch da aba Reacomodação.
- Semântica de `bookForRegistrant`/booking normal permanece intocada.

## Evidências que vou coletar após aprovar

- Antes: caso real da Top Service onde slot X está `free` mas rebook falha com clash de empresa.
- Depois: mesmo caso, slot X não aparece nem como `free` nem como `same_company`; slots realmente livres continuam agendando com sucesso.
- Query SQL usada para reproduzir G4 e provar que o filtro `companyStartTables` remove exatamente os slots que o backend rejeita.
- Lista final de arquivos alterados (2): `src/lib/dedupe-recovery.functions.ts`, `src/components/admin/dedupe-recovery-tab.tsx`.
