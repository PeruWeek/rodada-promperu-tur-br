// Shared alphabetical sort for exports/downloads across all admin/cliente
// listings. Rule:
//   1. Primary key: company trade name (nome fantasia) when present.
//   2. Fallback: registrant full name (nome do inscrito) when no company.
//   3. Ascending A→Z, case-insensitive, accent-insensitive.
//   4. Stable tiebreak by `id` (technical, non-displayed).

export type ExportSortGetters<T> = {
  tradeName: (row: T) => string | null | undefined;
  fullName: (row: T) => string | null | undefined;
  id: (row: T) => string | number | null | undefined;
};

function normalize(value: unknown): string {
  return (value ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function sortKey<T>(row: T, g: ExportSortGetters<T>): string {
  const trade = normalize(g.tradeName(row));
  if (trade) return trade;
  return normalize(g.fullName(row));
}

export function sortRowsForExport<T>(rows: T[], getters: ExportSortGetters<T>): T[] {
  return rows
    .map((row, index) => ({ row, index, key: sortKey(row, getters) }))
    .sort((a, b) => {
      if (a.key !== b.key) return a.key.localeCompare(b.key, "pt-BR");
      const aid = (getters.id(a.row) ?? "").toString();
      const bid = (getters.id(b.row) ?? "").toString();
      if (aid !== bid) return aid.localeCompare(bid);
      return a.index - b.index;
    })
    .map((entry) => entry.row);
}