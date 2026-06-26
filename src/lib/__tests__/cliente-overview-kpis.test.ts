import { describe, expect, it } from "vitest";

import {
  computeClienteKpis,
  computeClienteTypeBreakdown,
  formatLocation,
  dedupeByCompany,
} from "@/lib/cliente-overview";

describe("dedupeByCompany — collapses per-profile expansion to unique companies", () => {
  it("keeps unique company_ids, preserving first occurrence", () => {
    const out = dedupeByCompany([
      { company_id: "a", scheduled_meetings_count: 3 },
      { company_id: "a", scheduled_meetings_count: 3 },
      { company_id: "b", scheduled_meetings_count: 0 },
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.company_id)).toEqual(["a", "b"]);
  });

  it("two profiles on the same company count as 1 in KPIs and breakdown", () => {
    const rows = [
      { company_id: "copastur", role: "visitor" as const, scheduled_meetings_count: 9 },
      { company_id: "copastur", role: "visitor" as const, scheduled_meetings_count: 9 },
      { company_id: "blux", role: "visitor" as const, scheduled_meetings_count: 4 },
    ];
    const k = computeClienteKpis(rows);
    expect(k.inscritas).toBe(2);
    expect(k.totalReunioes).toBe(13);
    expect(k.comAgendamento).toBe(2);
    const b = computeClienteTypeBreakdown(rows);
    expect(b.visitantesCount).toBe(2);
    expect(b.visitantesMeetings).toBe(13);
  });
});

describe("computeClienteKpis — derives all KPIs from scheduled_meetings_count", () => {
  it("empty list → all zeros, percent = 0", () => {
    const k = computeClienteKpis([]);
    expect(k).toEqual({
      inscritas: 0,
      comAgendamento: 0,
      totalReunioes: 0,
      percentComAgendamento: 0,
    });
  });

  it("3 companies, all with 1+ meetings → all counted, total summed", () => {
    const k = computeClienteKpis([
      { scheduled_meetings_count: 1 },
      { scheduled_meetings_count: 4 },
      { scheduled_meetings_count: 7 },
    ]);
    expect(k.inscritas).toBe(3);
    expect(k.comAgendamento).toBe(3);
    expect(k.totalReunioes).toBe(12);
    expect(k.percentComAgendamento).toBe(100);
  });

  it("PATHOLOGICAL: count = 0 with legacy text status does NOT count as com_agendamento", () => {
    const k = computeClienteKpis([
      // @ts-expect-error — extra field is irrelevant for the helper
      { scheduled_meetings_count: 0, scheduling_status: "agendado_ok" },
      { scheduled_meetings_count: 2 },
    ]);
    expect(k.inscritas).toBe(2);
    expect(k.comAgendamento).toBe(1);
    expect(k.totalReunioes).toBe(2);
    expect(k.percentComAgendamento).toBe(50);
  });

  it("percentage rounds correctly", () => {
    const one = computeClienteKpis([
      { scheduled_meetings_count: 1 },
      { scheduled_meetings_count: 0 },
      { scheduled_meetings_count: 0 },
    ]);
    expect(one.percentComAgendamento).toBe(33);

    const two = computeClienteKpis([
      { scheduled_meetings_count: 1 },
      { scheduled_meetings_count: 1 },
      { scheduled_meetings_count: 0 },
    ]);
    expect(two.percentComAgendamento).toBe(67);
  });

  it("null counts collapse to 0 safely", () => {
    const k = computeClienteKpis([
      { scheduled_meetings_count: null },
      { scheduled_meetings_count: 3 },
    ]);
    expect(k.comAgendamento).toBe(1);
    expect(k.totalReunioes).toBe(3);
  });
});

describe("computeClienteTypeBreakdown — official role field only", () => {
  it("empty list → all zeros", () => {
    expect(computeClienteTypeBreakdown([])).toEqual({
      visitantesCount: 0,
      expositoresCount: 0,
      visitantesMeetings: 0,
      expositoresMeetings: 0,
    });
  });

  it("mix 2 visitors + 1 exhibitor → correct per-type counts and meeting sums", () => {
    const b = computeClienteTypeBreakdown([
      { role: "visitor", scheduled_meetings_count: 2 },
      { role: "visitor", scheduled_meetings_count: 3 },
      { role: "exhibitor", scheduled_meetings_count: 5 },
    ]);
    expect(b.visitantesCount).toBe(2);
    expect(b.expositoresCount).toBe(1);
    expect(b.visitantesMeetings).toBe(5);
    expect(b.expositoresMeetings).toBe(5);
  });

  it("rows with missing role are excluded from both buckets", () => {
    const rows = [
      { role: "visitor" as const, scheduled_meetings_count: 1 },
      { scheduled_meetings_count: 2 },
      { role: null, scheduled_meetings_count: 3 },
    ];
    const b = computeClienteTypeBreakdown(rows);
    expect(b.visitantesCount + b.expositoresCount).toBeLessThanOrEqual(
      rows.length,
    );
    expect(b.visitantesCount).toBe(1);
    expect(b.expositoresCount).toBe(0);
  });

  it("when all rows have role, per-type meeting sums match totalReunioes", () => {
    const rows = [
      { role: "visitor" as const, scheduled_meetings_count: 1 },
      { role: "exhibitor" as const, scheduled_meetings_count: 4 },
      { role: "exhibitor" as const, scheduled_meetings_count: 7 },
    ];
    const k = computeClienteKpis(rows);
    const b = computeClienteTypeBreakdown(rows);
    expect(b.visitantesMeetings + b.expositoresMeetings).toBe(k.totalReunioes);
    expect(b.visitantesCount + b.expositoresCount).toBe(k.inscritas);
  });
});

describe("formatLocation — concatenates only present fields", () => {
  it("returns em-dash when nothing is provided", () => {
    expect(formatLocation({})).toBe("—");
  });

  it("returns city alone when only city is present", () => {
    expect(formatLocation({ city: "Lima" })).toBe("Lima");
  });

  it("joins city + state when both present", () => {
    expect(formatLocation({ city: "São Paulo", state_code: "SP" })).toBe(
      "São Paulo, SP",
    );
  });

  it("falls back to country when state is absent", () => {
    expect(formatLocation({ city: "Cusco", country_code: "PE" })).toBe(
      "Cusco, PE",
    );
  });
});