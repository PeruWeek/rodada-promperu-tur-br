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