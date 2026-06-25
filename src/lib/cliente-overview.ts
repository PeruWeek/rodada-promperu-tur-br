/**
 * Pure utilities for the cliente "Visão geral" screen.
 *
 * The bucket rule is delegated to `bucketGroupFromMeetings` from
 * `src/lib/scheduling-status.ts` — the SINGLE SOURCE OF TRUTH. Do not
 * re-implement it here (an invariant test enforces this).
 */

import { bucketGroupFromMeetings } from "./scheduling-status";

export type ClienteOverviewRow = {
  scheduled_meetings_count: number | null;
  // Other fields exist but are irrelevant for KPIs.
};

export type ClienteKpis = {
  inscritas: number;
  comAgendamento: number;
  totalReunioes: number;
  percentComAgendamento: number;
};

export function computeClienteKpis(rows: ClienteOverviewRow[]): ClienteKpis {
  const inscritas = rows.length;
  let comAgendamento = 0;
  let totalReunioes = 0;
  for (const r of rows) {
    const count = Number(r.scheduled_meetings_count ?? 0);
    totalReunioes += count;
    if (bucketGroupFromMeetings(count) === "com_agendamento") {
      comAgendamento += 1;
    }
  }
  const percentComAgendamento =
    inscritas > 0 ? Math.round((comAgendamento / inscritas) * 100) : 0;
  return { inscritas, comAgendamento, totalReunioes, percentComAgendamento };
}

/**
 * Concatenates "City, ST/Country" using only the fields actually present.
 * Returns an em-dash when nothing is available — never invents a fallback.
 */
export function formatLocation(input: {
  city?: string | null;
  state_code?: string | null;
  country_code?: string | null;
}): string {
  const left = (input.city ?? "").trim();
  const right = (input.state_code ?? input.country_code ?? "").trim();
  if (left && right) return `${left}, ${right}`;
  if (left) return left;
  if (right) return right;
  return "—";
}