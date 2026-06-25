/**
 * Canonical scheduling-bucket helper.
 *
 * SINGLE SOURCE OF TRUTH for the rule that decides whether a company is in
 * the "Sem agendamento" or "Com agendamento" bucket. The decision is always
 * derived from `scheduled_meetings_count` (i.e. the real number of
 * `meetings.status = 'scheduled'` rows). The text column `scheduling_status`
 * is ONLY a complementary operational detail (`agendado_parcial` /
 * `agendado_ok`) for staff/admin drill-down — never used to decide the main
 * bucket. If `scheduling_status` ever disagrees with the count, the count
 * always wins.
 *
 * Do not reimplement the bucket rule elsewhere. Use
 * `bucketGroupFromMeetings`. There is a lint invariant test that enforces
 * this (see `src/lib/__tests__/scheduling-bucket-invariant.test.ts`).
 */

import { EXPECTED_MEETINGS_MIN } from "./pipeline.constants";

// Re-export so consumers can read the operational target from a single place
// and never introduce a new literal `6`.
export { EXPECTED_MEETINGS_MIN };

export type SchedulingGroup = "sem_agendamento" | "com_agendamento";
export type OperationalStatus = "agendado_parcial" | "agendado_ok";

/**
 * Bucket group is derived exclusively from the real meetings count.
 * - count <= 0  → "sem_agendamento"
 * - count >  0  → "com_agendamento"
 */
export function bucketGroupFromMeetings(count: number): SchedulingGroup {
  return count > 0 ? "com_agendamento" : "sem_agendamento";
}

/**
 * Operational sub-status (visible only to staff/admin).
 * - 0                                       → null
 * - 1 .. (EXPECTED_MEETINGS_MIN - 1)        → "agendado_parcial"
 * - >= EXPECTED_MEETINGS_MIN                → "agendado_ok"
 */
export function operationalStatusFromMeetings(
  count: number,
): OperationalStatus | null {
  if (count <= 0) return null;
  if (count < EXPECTED_MEETINGS_MIN) return "agendado_parcial";
  return "agendado_ok";
}

type Translator = (key: string) => string;

export function labelForGroup(group: SchedulingGroup, t: Translator): string {
  return group === "sem_agendamento"
    ? t("scheduling.group.sem")
    : t("scheduling.group.com");
}

export function labelForOperational(
  status: OperationalStatus,
  t: Translator,
): string {
  return status === "agendado_parcial"
    ? t("scheduling.operational.parcial")
    : t("scheduling.operational.ok");
}