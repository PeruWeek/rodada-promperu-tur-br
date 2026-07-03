/**
 * Simple in-memory bus to preselect a contact in the "Reacomodação" tab
 * when the admin clicks "Reacomodar" from the "Histórico de perdas" tab.
 *
 * Isolated helper — does NOT touch booking, dedupe, availability or any
 * scheduling logic. Only carries UI intent between two admin tabs.
 */

export type RecoveryPreselect = {
  profile_id: string;
  full_name: string | null;
  email: string | null;
  company_id: string | null;
  company_trade_name: string | null;
} | null;

let pending: RecoveryPreselect = null;
const listeners = new Set<(p: RecoveryPreselect) => void>();

export function requestRecovery(p: NonNullable<RecoveryPreselect>) {
  pending = p;
  for (const l of listeners) l(p);
}

export function consumePendingRecovery(): RecoveryPreselect {
  const p = pending;
  pending = null;
  return p;
}

export function subscribeRecovery(fn: (p: RecoveryPreselect) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}