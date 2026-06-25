import { describe, expect, it } from "vitest";

import { computeClienteKpis } from "@/lib/cliente-overview";

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