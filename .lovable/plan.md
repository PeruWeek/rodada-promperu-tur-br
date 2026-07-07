## Root cause

`src/lib/booking.functions.ts` → `listVisitorBookingSlots` reads meetings on the exhibitor's table with:

```
supabaseAdmin.from("meetings").select("... visitor:profiles!visitor_profile_id(company_id)")
```

There is no FK from `meetings.visitor_profile_id` to `profiles` (the FK targets `visitor_profiles`). PostgREST rejects the query with:

```
PGRST200 Could not find a relationship between 'meetings' and 'profiles'
Hint: Perhaps you meant 'visitor_profiles' instead of 'profiles'.
```

The destructuring `{ data: meetingsOnTable }` silently swallows the error, so `meetingsOnTable` is `null`. `pairMeetings` becomes `[]`, `classifySlotForVisitor` sees `meetingsOnPair.length === 0` for every slot, and returns `"free"` for all 20 slots — regardless of the 19 real `scheduled` meetings in the DB. That is exactly why TIERRA BIRU, TRIP360 and VIPAC show every horário as livre no visitor flow while the admin availability tab (which uses SQL directly) shows only 1 vaga.

The same broken join exists in `bookMeeting` for `pairMtgsRaw` and `sameEventMtgsRaw`; the preflight rule checks degrade to no-op, but the DB triggers (`trg_meetings_no_conflict`, `trg_meetings_one_company_per_slot`, `uq_meetings_visitor_table_scheduled`) still enforce concurrency, so no bad inserts have gotten through.

## Fix (frontend + server function only, no schema change)

1. In `src/lib/booking.functions.ts` → `listVisitorBookingSlots.handler`:
   - Replace the broken embedded join. Fetch meetings on the table without the profiles embed:
     ```
     supabaseAdmin.from("meetings")
       .select("slot_id, table_id, visitor_profile_id, time_slots!meetings_slot_id_fkey!inner(start_at,end_at)")
       .eq("table_id", table.id).eq("status", "scheduled")
     ```
   - Collect the distinct `visitor_profile_id`s and do a second query:
     ```
     supabaseAdmin.from("profiles").select("id, company_id").in("id", ids)
     ```
     Build a `profileId → company_id` map and hydrate `visitor_company_id` on each `MeetingLite`.
   - Add explicit error checks: if any of the three parallel queries returns `error`, throw. Silent `?? []` on a failed query is what hid this bug.

2. Apply the same two-step pattern in `bookMeeting.handler` for `pairMtgsRaw` and `sameEventMtgsRaw` so `assertCanBook` rules 1 and 5 use real `visitor_company_id`s instead of `null`. Behavior on success is unchanged; failures move from DB trigger to friendlier `SchedulingError` messages.

3. Add error propagation to the destructured `Promise.all`s so future FK/embed regressions fail loudly instead of silently returning "everything free".

No changes to:
- `BookingDialog` UI (already consumes `status` correctly)
- classification rules in `scheduling-rules.ts`
- DB schema, RLS, triggers
- admin availability tab, exhibitor detail, `available_slots_count`
- exports, dedupe, cancellation, reminders

## Validation

- Manual: re-run the PostgREST call after the fix (2 queries) against TIERRA BIRU's `table_id = 5acf1012-5965-4a18-9e2e-70a9606995f6` and confirm 19 slots come back with `visitor_company_id` populated, 1 slot has no meeting.
- End-to-end: sign in as a visitor from a different company, open BookingDialog for each of the 3 tables, confirm exactly 1 slot is enabled and the other 19 render as `other_company` (disabled, tooltip "Ocupado por outra empresa").
- Parity: numbers match `available_slots_count` in the admin availability tab and in `public_exhibitor_detail`.
- Regression: booking a free slot still succeeds; booking an occupied one fails with the friendly "ocupado por outra empresa" toast.

## Files touched

- `src/lib/booking.functions.ts` (two handlers, no signature change)

## Evidence to report back

- diff of `listVisitorBookingSlots` and `bookMeeting`
- PGRST200 payload as proof of the root cause
- before/after slot counts for the 3 companies matching admin numbers
