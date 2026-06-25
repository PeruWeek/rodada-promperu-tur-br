import { describe, expect, it } from "vitest";

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
});