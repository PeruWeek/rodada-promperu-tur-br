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

// =====================================================================
// Unified participant search (companies + contacts).
//
// Used by the cliente/staff/admin tabs Empresas, Inscritos and Agenda so
// the same needle returns the same set of rows in every tab (each tab may
// still apply its own universe filter — e.g. Agenda restricts to rows
// with `scheduled_meetings_count > 0` — but the textual match semantics
// are identical).
//
// Match fields: trade_name, legal_name, tax_id, contact full_name and
// contact email. Normalisation: trim + lower-case + accent-insensitive.
// Ranking: exact > prefix > partial; below partial the row is dropped.
// =====================================================================

export type SearchableContact = {
  full_name?: string | null;
  email?: string | null;
};

export type SearchableParticipant = SearchableCompany & {
  full_name?: string | null;
  email?: string | null;
  contacts?: SearchableContact[] | null;
};

export function participantSearchRank(row: SearchableParticipant, rawNeedle: string): number {
  const needle = normalizeCompanySearchValue(rawNeedle);
  if (!needle) return 0;
  const fields: string[] = [
    normalizeCompanySearchValue(row.trade_name),
    normalizeCompanySearchValue(row.legal_name),
    normalizeCompanySearchValue(row.tax_id),
    normalizeCompanySearchValue(row.full_name),
    normalizeCompanySearchValue(row.email),
  ];
  for (const c of row.contacts ?? []) {
    fields.push(normalizeCompanySearchValue(c.full_name));
    fields.push(normalizeCompanySearchValue(c.email));
  }
  const nonEmpty = fields.filter((f) => f.length > 0);
  if (nonEmpty.some((f) => f === needle)) return 0;
  if (nonEmpty.some((f) => f.startsWith(needle))) return 1;
  if (nonEmpty.some((f) => f.includes(needle))) return 2;
  return 3;
}

export function filterAndRankParticipants<T extends SearchableParticipant>(
  rows: T[],
  rawNeedle?: string | null,
): T[] {
  const needle = rawNeedle?.trim();
  if (!needle) return rows;
  return rows
    .map((row) => ({ row, rank: participantSearchRank(row, needle) }))
    .filter(({ rank }) => rank < 3)
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return (a.row.trade_name ?? "").localeCompare(b.row.trade_name ?? "", "pt-BR");
    })
    .map(({ row }) => row);
}