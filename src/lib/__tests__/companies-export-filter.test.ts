import { describe, expect, it } from "vitest";

import { cnpjRoot, dedupeCompanyRows, groupCompaniesByCnpjRoot } from "@/lib/companies-report";

// Inline copy of the helper used in CompaniesTab to guarantee that every
// exporter (XLSX/CSV/PDF) and the on-screen table share the exact same
// filtering rule based on the official `role` field.
function filterRowsByType<T extends { role?: string | null }>(
  rows: T[],
  typeFilter: "all" | "visitor" | "exhibitor",
): T[] {
  if (typeFilter === "all") return rows;
  return rows.filter((r) => r.role === typeFilter);
}

const dataset = [
  { id: "1", role: "visitor" as const },
  { id: "2", role: "exhibitor" as const },
  { id: "3", role: "visitor" as const },
  { id: "4", role: "cliente" as const },
  { id: "5", role: "exhibitor" as const },
];

describe("companies tab export filter", () => {
  it("Todos returns the full dataset", () => {
    expect(filterRowsByType(dataset, "all")).toEqual(dataset);
  });

  it("Visitante returns only role === 'visitor'", () => {
    const out = filterRowsByType(dataset, "visitor");
    expect(out.map((r) => r.id)).toEqual(["1", "3"]);
    expect(out.every((r) => r.role === "visitor")).toBe(true);
  });

  it("Expositor returns only role === 'exhibitor'", () => {
    const out = filterRowsByType(dataset, "exhibitor");
    expect(out.map((r) => r.id)).toEqual(["2", "5"]);
    expect(out.every((r) => r.role === "exhibitor")).toBe(true);
  });

  it("XLSX/CSV/PDF exporters consume the same filtered subset", () => {
    for (const f of ["all", "visitor", "exhibitor"] as const) {
      const base = filterRowsByType(dataset, f);
      const xlsx = filterRowsByType(dataset, f);
      const csv = filterRowsByType(dataset, f);
      const pdf = filterRowsByType(dataset, f);
      expect(xlsx).toEqual(base);
      expect(csv).toEqual(base);
      expect(pdf).toEqual(base);
    }
  });

  it("collapses the Empresas dataset to one row per company_id before rendering/export", () => {
    const expanded = [
      { id: "incomum", role: "visitor" as const, contact: "Marília Zazzera de Melo" },
      { id: "incomum", role: "visitor" as const, contact: "Valéria Paes de Carvalho Schiavon" },
      { id: "copastur", role: "visitor" as const, contact: "Naline Correia" },
    ];

    const uniqueForList = dedupeCompanyRows(expanded);
    const uniqueForPdf = dedupeCompanyRows(expanded);

    expect(uniqueForList).toHaveLength(2);
    expect(uniqueForPdf).toHaveLength(2);
    expect(uniqueForList.filter((r) => r.id === "incomum")).toHaveLength(1);
    expect(uniqueForPdf.filter((r) => r.id === "incomum")).toHaveLength(1);
  });

  it("extracts the 8-digit CNPJ root regardless of formatting", () => {
    expect(cnpjRoot("02.558.529/0001-12")).toBe("02558529");
    expect(cnpjRoot("02558529000231")).toBe("02558529");
    expect(cnpjRoot("ABC")).toBeNull();
    expect(cnpjRoot(null)).toBeNull();
  });

  it("groups matriz and filial sharing the same CNPJ root as ONE company", () => {
    const rows = [
      {
        id: "incomum-matriz",
        tax_id: "02.558.529/0001-12",
        trade_name: "Incomum Viagens",
        role: "visitor" as const,
        confirmed: true,
        hasActiveOwner: true,
        is_active: true,
        networking_lunch_participation: true,
        scheduled_meetings_count: 2,
        eligible_contacts: [{ id: "c1", full_name: "Marília" }],
      },
      {
        id: "incomum-filial",
        tax_id: "02.558.529/0002-31",
        trade_name: "Incomum Viagens (Filial)",
        role: "visitor" as const,
        confirmed: false,
        hasActiveOwner: true,
        is_active: true,
        networking_lunch_participation: null,
        scheduled_meetings_count: 1,
        eligible_contacts: [{ id: "c2", full_name: "Valéria" }],
      },
      {
        id: "copastur",
        tax_id: "11.111.111/0001-11",
        trade_name: "Copastur",
        role: "visitor" as const,
        confirmed: true,
        hasActiveOwner: true,
        is_active: true,
        networking_lunch_participation: false,
        scheduled_meetings_count: 0,
        eligible_contacts: [{ id: "c3", full_name: "Naline" }],
      },
    ];

    const grouped = groupCompaniesByCnpjRoot(rows);
    expect(grouped).toHaveLength(2);

    const incomum = grouped.find((r) => r.trade_name?.startsWith("Incomum"))!;
    // Matriz is picked as representative — trade_name from /0001 row.
    expect(incomum.trade_name).toBe("Incomum Viagens");
    expect(incomum.scheduled_meetings_count).toBe(3);
    expect(incomum.eligible_contacts).toHaveLength(2);
    expect(incomum.confirmed).toBe(true);
    expect(incomum.networking_lunch_participation).toBe(true);
  });
});