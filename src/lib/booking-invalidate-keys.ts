/**
 * Central invalidation key set for any manual booking flow.
 *
 * Reused by:
 * - `ExhibitorAvailabilityTab` (agendamento manual a partir do expositor)
 * - `BookForRegistrantDialog` (agendamento manual a partir do inscrito)
 *
 * Keep this list in sync with the query keys effectively used across the
 * project so that listagens, badges, KPIs, agenda e pipeline reflitam o
 * novo agendamento sem reload manual.
 */
export const BOOKING_INVALIDATE_KEYS: Array<readonly [string]> = [
  ["exhibitor-availability"],
  ["my-agenda"],
  ["table-agenda"],
  ["staff-agenda"],
  ["booking-slots"],
  ["registrants"],
  ["registrants-completion"],
  ["cliente-overview-base"],
  ["admin-companies"],
  ["pipeline"],
  ["pipeline-list"],
  ["pipeline-scheduling"],
  ["pipeline-kpis"],
  ["pipeline-followups"],
  ["pipeline-alerts"],
  ["visitor-ready"],
];