export function normalizeCompanySearchValue(value: unknown): string {
  return (value ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export type SearchableCompany = {
  trade_name: string | null;
  legal_name?: string | null;
  tax_id?: string | null;
};

export function companySearchRank(company: SearchableCompany, rawNeedle: string): number {
  const needle = normalizeCompanySearchValue(rawNeedle);
  if (!needle) return 0;
  const fields = [
    normalizeCompanySearchValue(company.trade_name),
    normalizeCompanySearchValue(company.legal_name),
    normalizeCompanySearchValue(company.tax_id),
  ];
  if (fields.some((f) => f === needle)) return 0;
  if (fields.some((f) => f.startsWith(needle))) return 1;
  if (fields.some((f) => f.includes(needle))) return 2;
  return 3;
}

export function filterAndRankCompanies<T extends SearchableCompany>(rows: T[], rawNeedle?: string | null): T[] {
  const needle = rawNeedle?.trim();
  if (!needle) return rows;
  return rows
    .map((row) => ({ row, rank: companySearchRank(row, needle) }))
    .filter(({ rank }) => rank < 3)
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return (a.row.trade_name ?? "").localeCompare(b.row.trade_name ?? "", "pt-BR");
    })
    .map(({ row }) => row);
}