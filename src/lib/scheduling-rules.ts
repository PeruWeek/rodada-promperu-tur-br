/**
 * ============================================================
 * SCHEDULING RULES — CANONICAL SOURCE OF TRUTH
 * ============================================================
 *
 * AI-EDITORS: do not reimplement any of the rules below elsewhere.
 * Every layer (visitor booking, admin booking, exhibitor availability,
 * reaccommodation suggestions, capacity counts, lost-history winner)
 * MUST consume the helpers exported here so all layers stay aligned
 * with the database triggers.
 *
 * The rules mirror the DB guardrails:
 *   - trigger `trg_meetings_no_conflict`          (same table+slot, another company)
 *   - trigger `trg_meetings_one_company_per_slot` (same company, same start_at, other table)
 *   - unique index `uq_meetings_visitor_table_scheduled`
 *
 * Business invariants:
 *   1. "1 slot = 1 empresa" — multiple visitors from the SAME company may
 *      share the same (table_id, slot_id). Another company cannot.
 *      Capacity counts collapse those shared meetings to 1 booked slot.
 *   2. Any scheduled meeting on (table_id, slot_id) physically occupies
 *      that pair. `slotIsPhysicallyBooked` is the ONLY source of the
 *      "livre vs ocupado" flag used by the availability view.
 *   3. A visitor cannot have two scheduled meetings at the same `start_at`
 *      across any table.
 *   4. A visitor cannot have two scheduled meetings on the same table.
 *   5. A company cannot have two scheduled meetings at the same `start_at`
 *      across different tables.
 *
 * Meetings whose `visitor.company_id` is NULL are treated conservatively:
 *   - they COUNT as physically occupying the (table_id, slot_id) pair
 *     (so the classifier returns `other_company` for other visitors and
 *     the availability view marks the pair as booked);
 *   - they never make a slot appear `free` or `same_company` to anyone
 *     other than the meeting's own owner.
 *
 * This module is pure TypeScript: no I/O, no Supabase, no side effects.
 */

export type MeetingLite = {
  id?: string;
  table_id: string;
  slot_id: string;
  visitor_profile_id: string;
  visitor_company_id: string | null;
  start_at: string;
  end_at: string;
};

export type SlotLite = {
  id: string;
  table_id: string;
  start_at: string;
  end_at: string;
};

export type SlotClassification =
  | "mine"
  | "free"
  | "same_company"
  | "other_company";

export type SchedulingErrorCode =
  | "VISITOR_TIME_CONFLICT"
  | "DUPLICATE_TABLE"
  | "SLOT_TAKEN_OTHER_COMPANY"
  | "COMPANY_ALREADY_AT_START";

export class SchedulingError extends Error {
  code: SchedulingErrorCode;
  friendlyMessage: string;
  constructor(code: SchedulingErrorCode, friendlyMessage: string) {
    super(friendlyMessage);
    this.name = "SchedulingError";
    this.code = code;
    this.friendlyMessage = friendlyMessage;
  }
}

/**
 * FRIENDLY_MESSAGES: single source for the user-facing error text of each
 * SchedulingError code. Kept stable so UI can key off `code` and not text.
 */
export const FRIENDLY_MESSAGES: Record<SchedulingErrorCode, string> = {
  VISITOR_TIME_CONFLICT:
    "Conflito: você já tem reunião agendada neste horário.",
  DUPLICATE_TABLE:
    "Você já tem uma reunião agendada com este expositor. Cada participante pode ter no máximo 1 reunião por mesa.",
  SLOT_TAKEN_OTHER_COMPANY:
    "Este horário já está ocupado por outra empresa nesta mesa. Escolha outro slot.",
  COMPANY_ALREADY_AT_START:
    "Esta empresa já possui uma reunião agendada neste horário em outra mesa.",
};

/**
 * Rule 2 — any scheduled meeting on the pair physically occupies it,
 * regardless of visitor company.
 */
export function slotIsPhysicallyBooked(
  meetingsOnPair: readonly MeetingLite[],
): boolean {
  return meetingsOnPair.length > 0;
}

/**
 * Rule 1 — 1 slot = 1 empresa. Given all scheduled meetings and the tables
 * that belong to one exhibitor company, returns totals in booked-slot units
 * (unique `table_id::slot_id` pairs), not raw meeting counts.
 */
export function countBookedSlotsPerCompany(input: {
  slots: readonly SlotLite[];
  meetings: readonly MeetingLite[];
  companyTableIds: readonly string[];
}): { total: number; booked: number; free: number } {
  const tableSet = new Set(input.companyTableIds);
  const total = input.slots.filter((s) => tableSet.has(s.table_id)).length;
  const bookedPairs = new Set<string>();
  for (const m of input.meetings) {
    if (!tableSet.has(m.table_id)) continue;
    bookedPairs.add(`${m.table_id}::${m.slot_id}`);
  }
  const booked = bookedPairs.size;
  return { total, booked, free: Math.max(0, total - booked) };
}

/**
 * Classify a single slot for a specific visitor. Mirrors what
 * `assertCanBook` would allow, so a slot classified `free` or
 * `same_company` is guaranteed to pass rules 1/2/3/4/5 for this visitor
 * (subject only to the DB race window covered by the triggers).
 *
 * The `meetingsOnPair` list must contain every scheduled meeting on the
 * exact `(slot.table_id, slot.id)` pair.
 *
 * `visitorBusyStarts` — set of `start_at` strings where the visitor
 * already has a scheduled meeting on any other table.
 * `visitorTables` — set of `table_id`s where the visitor already has a
 * scheduled meeting (used to enforce "1 reunião por mesa").
 * `companyBusyStartTables` — map `start_at -> Set<table_id>` where the
 * visitor's company already has a scheduled meeting on OTHER tables at
 * that start_at (rule 5). Ignored when `visitorCompanyId` is null.
 */
export function classifySlotForVisitor(input: {
  slot: SlotLite;
  meetingsOnPair: readonly MeetingLite[];
  visitorProfileId: string;
  visitorCompanyId: string | null;
  visitorBusyStarts: ReadonlySet<string>;
  visitorTables: ReadonlySet<string>;
  companyBusyStartTables?: ReadonlyMap<string, ReadonlySet<string>>;
}): SlotClassification {
  const {
    slot,
    meetingsOnPair,
    visitorProfileId,
    visitorCompanyId,
    visitorBusyStarts,
    visitorTables,
    companyBusyStartTables,
  } = input;

  // Self-presence wins over everything else so the UI can label "mine".
  const selfHere = meetingsOnPair.some(
    (m) => m.visitor_profile_id === visitorProfileId,
  );
  if (selfHere) return "mine";

  // Rule 4 — visitor already has a meeting on this table (different slot).
  if (visitorTables.has(slot.table_id)) return "other_company";

  // Rule 3 — visitor already busy at this start_at on another table.
  if (visitorBusyStarts.has(slot.start_at)) return "other_company";

  // Rule 5 — company already has a meeting at this start_at on another table.
  if (visitorCompanyId && companyBusyStartTables) {
    const busyTables = companyBusyStartTables.get(slot.start_at);
    if (busyTables && busyTables.size > 0) {
      const onlyThisTable =
        busyTables.size === 1 && busyTables.has(slot.table_id);
      if (!onlyThisTable) return "other_company";
    }
  }

  if (meetingsOnPair.length === 0) return "free";

  // At least one scheduled meeting is here. Rule 1 decides: only the
  // visitor's own company (non-null match) may share the pair.
  const allSameCompany =
    visitorCompanyId !== null &&
    meetingsOnPair.every((m) => m.visitor_company_id === visitorCompanyId);
  return allSameCompany ? "same_company" : "other_company";
}

/**
 * Server-side hard check used by both `bookMeeting` (visitor flow) and
 * `bookMeetingForVisitor` (admin flow). Throws `SchedulingError` with a
 * stable `code` on failure. Callers still rely on DB triggers as the
 * authoritative concurrency guarantee.
 */
export function assertCanBook(input: {
  visitor: { id: string; company_id: string | null };
  slot: { id: string; table_id: string; start_at: string; end_at: string };
  /** All scheduled meetings the visitor currently has (any table). */
  visitorScheduledMeetings: readonly MeetingLite[];
  /** All scheduled meetings on the exact `(table_id, slot_id)` pair. */
  meetingsOnPair: readonly MeetingLite[];
  /**
   * All scheduled meetings in the same event at the same
   * `(start_at, end_at)` window (across any table). Used only for rule 5.
   */
  sameEventMeetingsAtStart: readonly MeetingLite[];
}): void {
  const { visitor, slot } = input;

  // Rule 3 — cross-table time conflict.
  const hasTimeConflict = input.visitorScheduledMeetings.some(
    (m) => m.start_at === slot.start_at,
  );
  if (hasTimeConflict) {
    throw new SchedulingError(
      "VISITOR_TIME_CONFLICT",
      FRIENDLY_MESSAGES.VISITOR_TIME_CONFLICT,
    );
  }

  // Rule 4 — duplicate meeting on same table.
  const dupTable = input.visitorScheduledMeetings.some(
    (m) => m.table_id === slot.table_id,
  );
  if (dupTable) {
    throw new SchedulingError(
      "DUPLICATE_TABLE",
      FRIENDLY_MESSAGES.DUPLICATE_TABLE,
    );
  }

  // Rule 1 — pair already taken by another company (or by a meeting with
  // NULL company_id, which we treat conservatively).
  const otherCompanyOnPair = input.meetingsOnPair.some(
    (m) => m.visitor_company_id !== visitor.company_id,
  );
  if (otherCompanyOnPair) {
    throw new SchedulingError(
      "SLOT_TAKEN_OTHER_COMPANY",
      FRIENDLY_MESSAGES.SLOT_TAKEN_OTHER_COMPANY,
    );
  }

  // Rule 5 — company clash across tables at same start_at.
  if (visitor.company_id) {
    const clash = input.sameEventMeetingsAtStart.some(
      (m) =>
        m.visitor_company_id === visitor.company_id &&
        !(m.table_id === slot.table_id && m.slot_id === slot.id),
    );
    if (clash) {
      throw new SchedulingError(
        "COMPANY_ALREADY_AT_START",
        FRIENDLY_MESSAGES.COMPANY_ALREADY_AT_START,
      );
    }
  }
}

/**
 * Build the `companyBusyStartTables` map used by `classifySlotForVisitor`.
 * `meetings` is expected to be all scheduled meetings in the current event.
 */
export function buildCompanyBusyStartTables(
  meetings: readonly MeetingLite[],
  visitorCompanyId: string | null,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  if (!visitorCompanyId) return map;
  for (const m of meetings) {
    if (m.visitor_company_id !== visitorCompanyId) continue;
    const set = map.get(m.start_at) ?? new Set<string>();
    set.add(m.table_id);
    map.set(m.start_at, set);
  }
  return map;
}

/**
 * Group scheduled meetings by `(table_id::slot_id)`. Convenience helper for
 * classifiers that need to look up meetingsOnPair repeatedly.
 */
export function indexMeetingsByPair(
  meetings: readonly MeetingLite[],
): Map<string, MeetingLite[]> {
  const map = new Map<string, MeetingLite[]>();
  for (const m of meetings) {
    const key = `${m.table_id}::${m.slot_id}`;
    const arr = map.get(key) ?? [];
    arr.push(m);
    map.set(key, arr);
  }
  return map;
}