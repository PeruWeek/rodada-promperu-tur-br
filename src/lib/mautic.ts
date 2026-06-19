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

// Mapeamento evento -> tag aplicada ao contato no Mautic.
// As tags abaixo casam 1:1 com os segmentos do funil principal, que devem
// ser configurados no Mautic como "Contact tags contém <tag>":
//   - rodada---conta-criada
//   - rodada---cadastro-concluido
//   - rodada---agendamento-realizado
// O segmento amplo `rodada-2026` deve ser definido no Mautic por filtro
// de tag `rodada-2026`, que aplicamos em TODOS os eventos do funil — assim
// qualquer contato que toca a jornada entra automaticamente nele.
const EVENT_SEGMENT_TAGS: Record<MauticEvent, string> = {
  lead_account_created: "rodada---conta-criada",
  lead_signup_completed: "rodada---cadastro-concluido",
  meeting_scheduled: "rodada---agendamento-realizado",
};
const GLOBAL_FUNNEL_TAG = "rodada-2026";

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
  if (alreadySent(dedupe)) {
    console.info("[mautic] skip (dedupe)", { event, dedupeKey: dedupe });
    return;
  }

  const mt = window.mt;
  if (typeof mt !== "function") {
    console.info("[mautic] skip (mt.js indisponível)", { event });
    return;
  }

  const segmentTag = EVENT_SEGMENT_TAGS[event];
  // Tags como string CSV — formato aceito pelo mtc.js para adicionar
  // tags ao contato identificado nesta chamada.
  const tags = [GLOBAL_FUNNEL_TAG, segmentTag].filter(Boolean).join(",");

  try {
    mt("send", "pageview", {
      ...payload,
      mautic_event: event,
      page_title: event,
      tags,
    });
    console.info("[mautic] sent", {
      event,
      segmentTag,
      tags,
      email: payload.email,
      dedupeKey: dedupe,
    });
  } catch {
    // Never break the UI flow because of analytics.
    console.warn("[mautic] tracking failed (ignorado)", { event });
  }
}

export {};