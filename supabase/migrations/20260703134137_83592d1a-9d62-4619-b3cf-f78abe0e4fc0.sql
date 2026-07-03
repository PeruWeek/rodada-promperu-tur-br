-- Remove absolute uniqueness on (table_id, slot_id) for scheduled meetings.
-- Business rule is "1 slot = 1 company", not "1 slot = 1 meeting":
-- multiple attendees from the SAME company may share a (table, slot).
-- The correct rule is already enforced by the BEFORE trigger
-- `trg_meetings_no_conflict` (advisory lock + company comparison),
-- which raises 23505 only when a DIFFERENT company already occupies the slot.
DROP INDEX IF EXISTS public.uq_meetings_table_slot_scheduled;