## Objetivo (ajustado ao comportamento real)

Admin (somente `admin`, não `staff`) cancela reunião de visitante:
- muda `meetings.status` de `scheduled` para `cancelled`
- opcionalmente registra `meetings.cancel_reason`
- **não** grava outros campos temporais (o schema real de `meetings` não tem `cancelled_at`; ver §Confirmação de schema)
- **não** toca em `profiles.is_active`, `user_roles`, `visitor_profiles`, `exhibitor_profiles`, cadastro ou inscrição

Fluxo `cancelMeeting` do visitante mantém contrato e comportamento.

## Confirmação de schema (consultado no banco real)

`public.meetings`: `id, event_id, table_id, slot_id, visitor_profile_id, status, cancel_reason, requested_start_at, original_slot_id, original_start_at, created_at`.

- ✅ `cancel_reason` existe
- ❌ **`cancelled_at` NÃO existe** — o `UPDATE` grava apenas `status` e (opcional) `cancel_reason`. Nenhum `cancelled_at` na proposta.
- ❌ **`exhibitor_profile_id` NÃO existe em `meetings`** — vem de `public.event_tables.exhibitor_profile_id` (join por `meetings.table_id = event_tables.id`). O helper resolve o expositor por esse join, como já faz o `cancelMeeting` atual.

Consequência prática: mesmo `(table_id, slot_id)` pode ter **N reuniões `scheduled` de visitantes da mesma empresa**; a ocupação física é do par, não do visitante — ver §Validação #2.

## Arquivos alterados

- **NOVO** `src/lib/booking.server.ts` — `performMeetingCancellation` + `sendMeetingEmail` (movido)
- `src/lib/booking.functions.ts` — `cancelMeeting` delega ao helper; adiciona `adminCancelMeeting`, `adminCancelVisitorFutureMeetings`, `listVisitorMeetings`
- `src/components/admin/registrants-tab.tsx` — 2 botões + dialog + invalidação
- `src/lib/i18n/pt-BR.json`, `src/lib/i18n/es.json`

Reuso: `assertAdminRole`, `supabaseAdmin`, `requireSupabaseAuth`, `BOOKING_INVALIDATE_KEYS`, `listAuditLogs`.

## 1. Helper `performMeetingCancellation`

```ts
performMeetingCancellation({ meetingId, reason?, cancellingProfile, visitorScope? })
  : Promise<
      | { ok:true; meetingId; tableId; slotId; eventId; visitorProfileId; exhibitorProfileId; emailFailed:boolean }
      | { ok:false; reason:'not_scheduled'|'db_error'; detail?:string }
    >
```

Ordem sequencial, cada etapa independente:

1. **UPDATE blindado** — única operação que decide sucesso:
   ```ts
   supabaseAdmin.from('meetings')
     .update({ status: 'cancelled', cancel_reason: reason ?? null })   // sem cancelled_at
     .eq('id', meetingId)
     .eq('status', 'scheduled')                                        // blindagem idempotência
     [visitorScope ? .eq('visitor_profile_id', visitorScope) : identity]
     .select('id, table_id, slot_id, event_id, visitor_profile_id')
     .maybeSingle();
   ```
   - `data === null` ⇒ `{ ok:false, reason:'not_scheduled' }` (aborta).
   - erro ⇒ `{ ok:false, reason:'db_error', detail }`.
2. **Resolve `event_tables` (table_number, table_label, exhibitor_profile_id)** e **`time_slots` (start_at/end_at)** — `try/catch`, log em falha, prossegue com `null`.
3. **Resolve `exhibitorCompany`** via `profiles → companies.trade_name` a partir de `exhibitor_profile_id` do passo 2 — `try/catch`.
4. **Notificação in-app** ao expositor — `try/catch`.
5. **`sendMeetingEmail` — side effect não bloqueante**:
   ```ts
   let emailFailed = false;
   try { await sendMeetingEmail(...); } catch(e){ emailFailed=true; console.error(...) }
   ```
6. Retorna `{ ok:true, ..., emailFailed }`.

**Invariante:** após o UPDATE afetar linha, o retorno é sempre `ok:true`. Sem escritas em `profiles.is_active`, `user_roles`, `visitor_profiles`, `exhibitor_profiles`.

## 2. `cancelMeeting` (visitante) refatorado

Resolve `profile` por `auth_user_id`, `assertNotCliente`, delega a `performMeetingCancellation({ ..., visitorScope: profile.id })`. Se `ok:false` com `not_scheduled` ⇒ lança o mesmo erro que a implementação atual lança nesse caso. Se `ok:true` ⇒ retorna `{ ok: true }` (não vaza `emailFailed`).

## 3. Server functions admin-only

`requireSupabaseAuth` + `assertAdminRole`. `staff` **não** cancela via admin.

### `adminCancelMeeting({ meetingId, reason? })`
1. Resolve `adminProfile`.
2. `res = performMeetingCancellation({ ..., cancellingProfile: adminProfile })` (sem `visitorScope`).
3. `res.ok===false` ⇒ throw `Error(res.reason)`; sem audit.
4. `res.ok===true` ⇒ **grava `audit_logs` independentemente do e-mail** (`try/catch` no insert; falha só loga):
   ```
   action: 'meeting.admin_cancelled'
   actor_profile_id: adminProfile.id
   event_id: res.eventId
   payload: { meeting_id, visitor_profile_id, table_id, slot_id, reason, email_failed: res.emailFailed }
   ```
5. Retorna `{ ok:true, meetingId, tableId, slotId, visitorProfileId, emailFailed }`.

### `adminCancelVisitorFutureMeetings({ visitorProfileId, reason? })`

SELECT ids futuras (`visitor_profile_id`, `status='scheduled'`, `time_slots.start_at >= now()` via join). Itera:
- `res.ok:true` ⇒ `cancelled.push({ meetingId, tableId, slotId, eventId, emailFailed })` + audit por reunião.
- `res.ok:false` ⇒ `failed.push({ meetingId, reason, detail? })`.

`failed[]` = realmente não cancelou no banco. Falha só de e-mail ⇒ sempre em `cancelled[]` com `emailFailed:true`.

Retorno:
```ts
{ attempted, cancelled: Array<{...; emailFailed}>, failed: Array<{ meetingId; reason; detail? }> }
```

### `listVisitorMeetings({ visitorProfileId })`
SELECT `meetings` + join `time_slots` + `event_tables` + expositor via `profiles→companies`. Filtro: `visitor_profile_id`, `status='scheduled'`, `time_slots.start_at >= now()`. Ordenado por `start_at`.

## 4. UI `registrants-tab.tsx`

Gate: `isAdmin && r.role === 'visitor' && (r.profile_meetings_count ?? 0) > 0`.

- **Ver reuniões** (`CalendarClock`) → `VisitorMeetingsDialog` com `useQuery(['visitor-meetings', profile_id], listVisitorMeetings)`. Cada linha `Cancelar` → `AlertDialog` + `Textarea` motivo opcional → `adminCancelMeeting`. Toast diferenciado quando `emailFailed`.
- **Cancelar reuniões futuras** (`CalendarX`, `text-destructive`) → `AlertDialog` separado; texto: *"Isso não desativa o inscrito. Cadastro, acesso e inscrição continuam preservados. Apenas as reuniões futuras serão canceladas e os slots liberados quando não houver outra reunião da mesma empresa no mesmo horário."* Textarea motivo. Toast reflete `cancelled.length`/`failed.length`/soma `emailFailed`.
- **Desativar inscrito** (`cancelTarget` + `activeMut`) intacto e separado.

## 5. Invalidação (mesma para sucesso com ou sem `emailFailed`)
```ts
qc.invalidateQueries({ queryKey: ['visitor-meetings', r.profile_id] });
qc.invalidateQueries({ queryKey: ['registrants'] });
qc.invalidateQueries({ queryKey: ['admin-users'] });
for (const k of BOOKING_INVALIDATE_KEYS) qc.invalidateQueries({ queryKey: k });
```

## 6. Traduções pt-BR / es

`admin.registrants.actions.viewMeetings`, `.cancelFutureMeetings`, `admin.registrants.meetings.dialogTitle` / `empty` / `reasonPlaceholder` / `cancelOneTitle` / `cancelOneBody` / `cancelAllTitle` / `cancelAllBody`, `admin.registrants.toasts.meetingCancelled` / `meetingCancelledEmailFailed` / `meetingsCancelled` / `meetingsCancelledEmailPartial` / `meetingsCancelledPartial`.

## 7. Evidências pós-implementação

### Cancelamento efetivo e blindagem
```sql
SELECT status, cancel_reason FROM public.meetings WHERE id = :meeting_id;
-- esperado: 'cancelled', <reason ou NULL>
```
Segundo `adminCancelMeeting` para o mesmo id ⇒ lança `not_scheduled`, **sem** nova linha em `audit_logs`.

### Resiliência de e-mail
Forçar `sendMeetingEmail` a falhar 1× ⇒ `meetings.status='cancelled'` persiste, resposta `ok:true, emailFailed:true`, `audit_logs.payload->>'email_failed' = 'true'`.

### Bulk fiel
Em `adminCancelVisitorFutureMeetings`, reunião cujo e-mail falhou ⇒ aparece em `cancelled[]` com `emailFailed:true`, **nunca** em `failed[]`. `failed[]` só recebe casos em que o UPDATE não afetou linha (`not_scheduled`) ou erro de banco (`db_error`).

### Validação #1 — par `(table_id, slot_id)` LIBERADO
Aplicável quando a reunião cancelada era a **única** `scheduled` naquele par:
```sql
SELECT
  (SELECT COUNT(*) FROM public.meetings m
    WHERE m.table_id = :table_id AND m.slot_id = :slot_id AND m.status = 'scheduled') AS still_scheduled;
-- esperado: 0  ⇒ par liberado, aparece livre na agenda da mesa e na disponibilidade
```

### Validação #2 — mesma empresa no mesmo slot, par CONTINUA OCUPADO
Aplicável quando dois (ou mais) visitantes da mesma empresa têm reuniões no mesmo `(table_id, slot_id)` e apenas um foi cancelado:
```sql
-- antes: 2 reuniões scheduled no par
-- cancela apenas 1
SELECT
  (SELECT COUNT(*) FROM public.meetings m
    WHERE m.table_id = :table_id AND m.slot_id = :slot_id AND m.status = 'scheduled') AS still_scheduled;
-- esperado: >= 1  ⇒ par permanece ocupado; agenda da mesa/disponibilidade NÃO liberam o slot
-- reunião cancelada: status='cancelled'; reuniões da mesma empresa no mesmo par: status='scheduled' inalterado
```
Confirma que ocupação física é por `(table_id, slot_id)` no conjunto `status='scheduled'`, não por visitante.

### Preservação (regra do objetivo)
```sql
SELECT is_active FROM public.profiles WHERE id = :visitor_profile_id;             -- inalterado
SELECT count(*) FROM public.user_roles WHERE user_id = (SELECT auth_user_id FROM public.profiles WHERE id = :visitor_profile_id);  -- inalterado
-- visitor_profiles / exhibitor_profiles do inscrito: nenhuma escrita no diff
```
`git diff` em `booking.server.ts` e `booking.functions.ts` sem novas referências a `is_active`, `user_roles`, `visitor_profiles`, `exhibitor_profiles`.

### Auditoria
```sql
SELECT action, actor_profile_id, event_id, payload
  FROM public.audit_logs
 WHERE action = 'meeting.admin_cancelled'
 ORDER BY created_at DESC LIMIT 10;
```

### Contador
`listEventRegistrants` reduz `profile_meetings_count` do visitante em N (número de cancelamentos efetivos).

### Fluxo visitante
`useServerFn(cancelMeeting)` em `src/routes/_authenticated/agenda.tsx` — mesmo input `{ meetingId }`, mesmo retorno `{ ok:true }`, mesmos efeitos observáveis (update + notificação + email).

## 8. Confirmações explícitas

- Schema real de `meetings` confirmado: sem `cancelled_at`, sem `exhibitor_profile_id`; UPDATE escreve apenas `status` (+ `cancel_reason` opcional).
- Expositor resolvido via `event_tables.exhibitor_profile_id`.
- `profiles.is_active` não é lido nem escrito.
- `user_roles`, `visitor_profiles`, `exhibitor_profiles` não são tocados.
- Endpoints novos são admin-only (`assertAdminRole`), não `assertAdminOrStaffRole`.
- `Desativar inscrito` continua fluxo separado.
- Cancelamento é sucesso a partir do UPDATE afetar linha; e-mail é side effect não bloqueante; auditoria é gravada independentemente do e-mail.
- Ocupação física do par `(table_id, slot_id)` é medida pelo conjunto `status='scheduled'`; mesma empresa no mesmo slot mantém o par ocupado enquanto restar ao menos uma reunião agendada nele.
