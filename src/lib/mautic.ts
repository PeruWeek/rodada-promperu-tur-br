// Lightweight Mautic tracking helpers (frontend only).
// The global mtc.js script is loaded in src/routes/__root.tsx and exposes
// `window.mt`. All helpers are no-ops when `mt` is unavailable (SSR, blocked
// by adblock, script failed to load) so they never break the app flow.

declare global {
  interface Window {
    mt?: (
      action: string,
      event: string,
      payload?: Record<string, unknown>,
    ) => void;
    MauticTrackingObject?: string;
  }
}

// Business funnel events. Keep names stable — Mautic segments depend on them.
export type MauticEvent =
  | "lead_account_created"
  | "lead_signup_completed"
  | "meeting_scheduled";

// Guard against double-fires when a flow re-runs (StrictMode, retries, etc.).
const SENT_KEY = "mautic_sent_events_v1";

function alreadySent(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.sessionStorage.getItem(SENT_KEY);
    const set = new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
    if (set.has(key)) return true;
    set.add(key);
    window.sessionStorage.setItem(SENT_KEY, JSON.stringify([...set]));
    return false;
  } catch {
    return false;
  }
}

export interface MauticTrackPayload {
  page_url: string;
  page_title: string;
  email?: string;
  firstname?: string;
  lastname?: string;
  // Free-form extras (UTM, ids, etc.)
  [key: string]: unknown;
}

/**
 * Fire a Mautic business event as a virtual pageview.
 * - Safe to call even if `window.mt` isn't loaded (no-op).
 * - Deduplicates by `event + dedupeKey` per browser session.
 */
export function trackMauticEvent(
  event: MauticEvent,
  payload: MauticTrackPayload,
  options?: { dedupeKey?: string },
): void {
  if (typeof window === "undefined") return;
  const dedupe = `${event}:${options?.dedupeKey ?? payload.page_url}`;
  if (alreadySent(dedupe)) return;

  const mt = window.mt;
  if (typeof mt !== "function") return;

  try {
    mt("send", "pageview", {
      ...payload,
      mautic_event: event,
    });
  } catch {
    // Never break the UI flow because of analytics.
  }
}

export {};