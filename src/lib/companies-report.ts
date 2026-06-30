/**
 * Utilities for reports/lists whose unit is EMPRESA.
 *
 * A company report must never expand one company into multiple rows because
 * it has multiple contacts. The stable identity is `company_id`; in the
 * Companies admin payload that same value is exposed as `id`.
 */
export function dedupeCompanyRows<T extends { id?: string | null; company_id?: string | null }>(
  rows: T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];

  for (const row of rows) {
    const key = row.company_id ?? row.id ?? null;
    if (!key) {
      out.push(row);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }

  return out;
}

/**
 * Returns the CNPJ root (first 8 digits) for a tax_id, or null when the
 * value does not contain at least 8 numeric digits (foreign/legacy data).
 * Matriz (0001) and filial (0002+) share the same root and should be
 * counted as a single economic group across the Empresas flow.
 */
export function cnpjRoot(taxId: string | null | undefined): string | null {
  if (!taxId) return null;
  const digits = taxId.replace(/\D+/g, "");
  if (digits.length < 8) return null;
  return digits.slice(0, 8);
}

type CompanyGroupable = {
  id?: string | null;
  company_id?: string | null;
  tax_id?: string | null;
  trade_name?: string | null;
  legal_name?: string | null;
  role?: "cliente" | "exhibitor" | "visitor" | string | null;
  confirmed?: boolean | null;
  hasActiveOwner?: boolean | null;
  is_active?: boolean | null;
  networking_lunch_participation?: boolean | null;
  scheduled_meetings_count?: number | null;
  scheduling_bucket?: string | null;
  eligible_contacts?: Array<{ id: string; full_name?: string | null; email?: string | null } | Record<string, unknown>> | null;
};

function isMatriz(taxId: string | null | undefined): boolean {
  if (!taxId) return false;
  const digits = taxId.replace(/\D+/g, "");
  // CNPJ branch indicator lives in digits 9-12 (1-indexed). 0001 = matriz.
  return digits.length >= 12 && digits.slice(8, 12) === "0001";
}

function roleRank(role: unknown): number {
  if (role === "cliente") return 3;
  if (role === "exhibitor") return 2;
  if (role === "visitor") return 1;
  return 0;
}

/**
 * Collapse matriz + filial(es) of the same CNPJ root into ONE visual
 * company. Rows without a usable CNPJ root fall back to identity by
 * company_id / id, so foreign or legacy entries never get merged by
 * accident. The representative row is the matriz when present, otherwise
 * the first row in the input order.
 *
 * This runs on the server (admin.functions.ts) so badge, list and
 * XLSX/CSV/PDF exports always share the same unit of count.
 */
export function groupCompaniesByCnpjRoot<T extends CompanyGroupable>(rows: T[]): T[] {
  const groups = new Map<string, T[]>();
  const order: string[] = [];

  for (const row of rows) {
    const root = cnpjRoot(row.tax_id);
    const key = root ?? `id:${row.company_id ?? row.id ?? Math.random().toString(36).slice(2)}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(row);
  }

  const out: T[] = [];
  for (const key of order) {
    const bucket = groups.get(key)!;
    if (bucket.length === 1) {
      out.push(bucket[0]);
      continue;
    }
    // Prefer matriz (/0001) as the representative; fall back to the first row.
    const matrizIdx = bucket.findIndex((r) => isMatriz(r.tax_id));
    const rep = matrizIdx >= 0 ? bucket[matrizIdx] : bucket[0];

    // Merge eligible contacts across matriz + filiais (dedupe by id).
    const seenContacts = new Set<string>();
    const mergedContacts: Array<Record<string, unknown>> = [];
    for (const r of bucket) {
      for (const c of (r.eligible_contacts ?? []) as Array<Record<string, unknown>>) {
        const cid = (c?.id as string | undefined) ?? null;
        if (cid) {
          if (seenContacts.has(cid)) continue;
          seenContacts.add(cid);
        }
        mergedContacts.push(c);
      }
    }

    const sumScheduled = bucket.reduce(
      (acc, r) => acc + Number(r.scheduled_meetings_count ?? 0),
      0,
    );
    const anyConfirmed = bucket.some((r) => !!r.confirmed);
    const anyActiveOwner = bucket.some((r) => !!r.hasActiveOwner);
    const anyActive = bucket.some((r) => r.is_active !== false);
    const lunchVals = bucket
      .map((r) => r.networking_lunch_participation)
      .filter((v) => v !== null && v !== undefined);
    const lunch =
      lunchVals.length === 0
        ? null
        : lunchVals.some((v) => v === true)
          ? true
          : false;
    const topRole = bucket.reduce<unknown>(
      (best, r) => (roleRank(r.role) > roleRank(best) ? r.role : best),
      rep.role,
    );

    const merged: T = {
      ...rep,
      eligible_contacts: mergedContacts as T["eligible_contacts"],
      scheduled_meetings_count: sumScheduled,
      scheduling_bucket: sumScheduled > 0 ? "com_agendamento" : "sem_agendamento",
      confirmed: anyConfirmed,
      hasActiveOwner: anyActiveOwner,
      is_active: anyActive,
      networking_lunch_participation: lunch,
      role: topRole,
    } as T;

    out.push(merged);
  }

  return out;
}