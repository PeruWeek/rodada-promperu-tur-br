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
  role?: "visitor" | "exhibitor" | null;
  /**
   * Used to dedupe per-profile expansions back to unique companies. When
   * omitted, the row is treated as its own unique entity (legacy inputs).
   */
  company_id?: string | null;
  // Other fields exist but are irrelevant for KPIs.
};

export type ClienteKpis = {
  inscritas: number;
  comAgendamento: number;
  totalReunioes: number;
  percentComAgendamento: number;
};

/**
 * Collapses a per-profile expanded list down to one entry per `company_id`.
 * Server functions (`_listEventRegistrantsImpl`, `listClienteOverviewBase`)
 * emit one row per eligible participant so exports can list every contact;
 * KPIs / counters that talk about EMPRESAS must consume the deduped view.
 */
export function dedupeByCompany<T extends ClienteOverviewRow>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    const key = r.company_id ?? null;
    if (key == null) {
      out.push(r);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export function computeClienteKpis(rows: ClienteOverviewRow[]): ClienteKpis {
  const unique = dedupeByCompany(rows);
  const inscritas = unique.length;
  let comAgendamento = 0;
  let totalReunioes = 0;
  for (const r of unique) {
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

export type ClienteTypeBreakdown = {
  visitantesCount: number;
  expositoresCount: number;
  visitantesMeetings: number;
  expositoresMeetings: number;
};

/**
 * Splits rows by the OFFICIAL `role` field returned by the backend
 * (`listEventRegistrants` → `RegistrantRow.role`). Rows with an unknown
 * role are intentionally NOT placed in either bucket — preserving the
 * invariant `visitantesCount + expositoresCount <= rows.length`.
 *
 * No textual heuristics. No inference from company name.
 */
export function computeClienteTypeBreakdown(
  rows: ClienteOverviewRow[],
): ClienteTypeBreakdown {
  let visitantesCount = 0;
  let expositoresCount = 0;
  let visitantesMeetings = 0;
  let expositoresMeetings = 0;
  for (const r of dedupeByCompany(rows)) {
    const count = Number(r.scheduled_meetings_count ?? 0);
    if (r.role === "visitor") {
      visitantesCount += 1;
      visitantesMeetings += count;
    } else if (r.role === "exhibitor") {
      expositoresCount += 1;
      expositoresMeetings += count;
    }
  }
  return {
    visitantesCount,
    expositoresCount,
    visitantesMeetings,
    expositoresMeetings,
  };
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