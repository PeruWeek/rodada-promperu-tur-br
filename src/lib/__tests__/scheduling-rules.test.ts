import { describe, expect, it } from "vitest";
import {
  assertCanBook,
  buildCompanyBusyStartTables,
  classifySlotForVisitor,
  countBookedSlotsPerCompany,
  FRIENDLY_MESSAGES,
  indexMeetingsByPair,
  SchedulingError,
  slotIsPhysicallyBooked,
  type MeetingLite,
  type SlotLite,
} from "@/lib/scheduling-rules";

const TABLE_A = "table-a";
const TABLE_B = "table-b";
const SLOT_1 = "slot-1";
const SLOT_2 = "slot-2";
const START_1 = "2026-07-08T12:00:00Z";
const END_1 = "2026-07-08T12:30:00Z";
const START_2 = "2026-07-08T13:00:00Z";
const END_2 = "2026-07-08T13:30:00Z";
const COMPANY_X = "company-x";
const COMPANY_Y = "company-y";
const VISITOR = "visitor-1";
const COLLEAGUE = "visitor-2";
const OUTSIDER = "visitor-3";

function mk(
  overrides: Partial<MeetingLite> & Pick<MeetingLite, "table_id" | "slot_id" | "visitor_profile_id">,
): MeetingLite {
  return {
    id: overrides.id ?? `${overrides.table_id}-${overrides.slot_id}-${overrides.visitor_profile_id}`,
    start_at: START_1,
    end_at: END_1,
    visitor_company_id: null,
    ...overrides,
  };
}

const slotA1: SlotLite = { id: SLOT_1, table_id: TABLE_A, start_at: START_1, end_at: END_1 };
const slotA2: SlotLite = { id: SLOT_2, table_id: TABLE_A, start_at: START_2, end_at: END_2 };
const slotB1: SlotLite = { id: SLOT_1, table_id: TABLE_B, start_at: START_1, end_at: END_1 };

describe("slotIsPhysicallyBooked", () => {
  it("free when no meetings", () => {
    expect(slotIsPhysicallyBooked([])).toBe(false);
  });
  it("booked when any meeting present (any company)", () => {
    expect(
      slotIsPhysicallyBooked([mk({ table_id: TABLE_A, slot_id: SLOT_1, visitor_profile_id: OUTSIDER })]),
    ).toBe(true);
  });
  it("booked when meeting has null company_id (conservative)", () => {
    expect(
      slotIsPhysicallyBooked([
        mk({ table_id: TABLE_A, slot_id: SLOT_1, visitor_profile_id: OUTSIDER, visitor_company_id: null }),
      ]),
    ).toBe(true);
  });
});

describe("classifySlotForVisitor", () => {
  const baseCtx = {
    visitorProfileId: VISITOR,
    visitorCompanyId: COMPANY_X,
    visitorBusyStarts: new Set<string>(),
    visitorTables: new Set<string>(),
    companyBusyStartTables: new Map<string, Set<string>>(),
  };

  it("free when nothing is booked", () => {
    expect(
      classifySlotForVisitor({ ...baseCtx, slot: slotA1, meetingsOnPair: [] }),
    ).toBe("free");
  });

  it("same-company classification when only own company present", () => {
    expect(
      classifySlotForVisitor({
        ...baseCtx,
        slot: slotA1,
        meetingsOnPair: [
          mk({
            table_id: TABLE_A,
            slot_id: SLOT_1,
            visitor_profile_id: COLLEAGUE,
            visitor_company_id: COMPANY_X,
          }),
        ],
      }),
    ).toBe("same_company");
  });

  it("other-company when another company holds the pair", () => {
    expect(
      classifySlotForVisitor({
        ...baseCtx,
        slot: slotA1,
        meetingsOnPair: [
          mk({
            table_id: TABLE_A,
            slot_id: SLOT_1,
            visitor_profile_id: OUTSIDER,
            visitor_company_id: COMPANY_Y,
          }),
        ],
      }),
    ).toBe("other_company");
  });

  it("REGRESSION: pair meeting with NULL company_id is other_company (never free)", () => {
    // Divergência 1/3 do plano: antes, visão do visitante/reacomodação
    // classificava esse slot como `free` mas listExhibitorAvailability
    // marcava como ocupado.
    const classified = classifySlotForVisitor({
      ...baseCtx,
      slot: slotA1,
      meetingsOnPair: [
        mk({
          table_id: TABLE_A,
          slot_id: SLOT_1,
          visitor_profile_id: OUTSIDER,
          visitor_company_id: null,
        }),
      ],
    });
    expect(classified).toBe("other_company");
  });

  it("REGRESSION: same-company requires ALL meetings to be own company", () => {
    // Mix: colega + estranho sem company_id → não pode virar same_company.
    const classified = classifySlotForVisitor({
      ...baseCtx,
      slot: slotA1,
      meetingsOnPair: [
        mk({
          table_id: TABLE_A,
          slot_id: SLOT_1,
          visitor_profile_id: COLLEAGUE,
          visitor_company_id: COMPANY_X,
        }),
        mk({
          table_id: TABLE_A,
          slot_id: SLOT_1,
          visitor_profile_id: OUTSIDER,
          visitor_company_id: null,
        }),
      ],
    });
    expect(classified).toBe("other_company");
  });

  it("mine wins over everything when visitor is on the pair", () => {
    expect(
      classifySlotForVisitor({
        ...baseCtx,
        slot: slotA1,
        visitorTables: new Set([TABLE_A]),
        meetingsOnPair: [
          mk({
            table_id: TABLE_A,
            slot_id: SLOT_1,
            visitor_profile_id: VISITOR,
            visitor_company_id: COMPANY_X,
          }),
        ],
      }),
    ).toBe("mine");
  });

  it("visitor already busy at same start_at on another table → other_company", () => {
    expect(
      classifySlotForVisitor({
        ...baseCtx,
        slot: slotB1,
        visitorBusyStarts: new Set([START_1]),
        meetingsOnPair: [],
      }),
    ).toBe("other_company");
  });

  it("company already at start on another table → other_company", () => {
    expect(
      classifySlotForVisitor({
        ...baseCtx,
        slot: slotB1,
        companyBusyStartTables: new Map([[START_1, new Set([TABLE_A])]]),
        meetingsOnPair: [],
      }),
    ).toBe("other_company");
  });

  it("company own meeting only on this table is fine", () => {
    expect(
      classifySlotForVisitor({
        ...baseCtx,
        slot: slotA2,
        companyBusyStartTables: new Map([[START_2, new Set([TABLE_A])]]),
        meetingsOnPair: [],
      }),
    ).toBe("free");
  });
});

describe("assertCanBook", () => {
  const visitor = { id: VISITOR, company_id: COMPANY_X };
  const slot = { id: SLOT_1, table_id: TABLE_A, start_at: START_1, end_at: END_1 };

  it("same-company same-slot is ALLOWED", () => {
    expect(() =>
      assertCanBook({
        visitor,
        slot,
        visitorScheduledMeetings: [],
        meetingsOnPair: [
          mk({
            table_id: TABLE_A,
            slot_id: SLOT_1,
            visitor_profile_id: COLLEAGUE,
            visitor_company_id: COMPANY_X,
          }),
        ],
        sameEventMeetingsAtStart: [],
      }),
    ).not.toThrow();
  });

  it("other-company same-slot BLOCKS with SLOT_TAKEN_OTHER_COMPANY", () => {
    expect(() =>
      assertCanBook({
        visitor,
        slot,
        visitorScheduledMeetings: [],
        meetingsOnPair: [
          mk({
            table_id: TABLE_A,
            slot_id: SLOT_1,
            visitor_profile_id: OUTSIDER,
            visitor_company_id: COMPANY_Y,
          }),
        ],
        sameEventMeetingsAtStart: [],
      }),
    ).toThrow(
      expect.objectContaining({
        code: "SLOT_TAKEN_OTHER_COMPANY",
        friendlyMessage: FRIENDLY_MESSAGES.SLOT_TAKEN_OTHER_COMPANY,
      }),
    );
  });

  it("visitor cross-table time conflict BLOCKS with VISITOR_TIME_CONFLICT", () => {
    expect(() =>
      assertCanBook({
        visitor,
        slot,
        visitorScheduledMeetings: [
          mk({
            table_id: TABLE_B,
            slot_id: SLOT_1,
            visitor_profile_id: VISITOR,
            visitor_company_id: COMPANY_X,
            start_at: START_1,
          }),
        ],
        meetingsOnPair: [],
        sameEventMeetingsAtStart: [],
      }),
    ).toThrow(expect.objectContaining({ code: "VISITOR_TIME_CONFLICT" }));
  });

  it("visitor same-table twice BLOCKS with DUPLICATE_TABLE", () => {
    expect(() =>
      assertCanBook({
        visitor,
        slot,
        visitorScheduledMeetings: [
          mk({
            table_id: TABLE_A,
            slot_id: SLOT_2,
            visitor_profile_id: VISITOR,
            visitor_company_id: COMPANY_X,
            start_at: START_2,
          }),
        ],
        meetingsOnPair: [],
        sameEventMeetingsAtStart: [],
      }),
    ).toThrow(expect.objectContaining({ code: "DUPLICATE_TABLE" }));
  });

  it("company cross-table same start BLOCKS with COMPANY_ALREADY_AT_START", () => {
    expect(() =>
      assertCanBook({
        visitor,
        slot,
        visitorScheduledMeetings: [],
        meetingsOnPair: [],
        sameEventMeetingsAtStart: [
          mk({
            table_id: TABLE_B,
            slot_id: SLOT_1,
            visitor_profile_id: COLLEAGUE,
            visitor_company_id: COMPANY_X,
            start_at: START_1,
          }),
        ],
      }),
    ).toThrow(expect.objectContaining({ code: "COMPANY_ALREADY_AT_START" }));
  });

  it("SchedulingError is throwable and instanceof Error", () => {
    try {
      assertCanBook({
        visitor,
        slot,
        visitorScheduledMeetings: [],
        meetingsOnPair: [
          mk({
            table_id: TABLE_A,
            slot_id: SLOT_1,
            visitor_profile_id: OUTSIDER,
            visitor_company_id: COMPANY_Y,
          }),
        ],
        sameEventMeetingsAtStart: [],
      });
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(SchedulingError);
      expect(e).toBeInstanceOf(Error);
    }
  });
});

describe("countBookedSlotsPerCompany — 1 slot = 1 empresa", () => {
  it("20 meetings da mesma empresa no MESMO par contam como 1 slot ocupado", () => {
    const slots: SlotLite[] = [
      slotA1,
      slotA2,
      { id: "slot-3", table_id: TABLE_A, start_at: "2026-07-08T14:00:00Z", end_at: "2026-07-08T14:30:00Z" },
    ];
    const meetings: MeetingLite[] = Array.from({ length: 20 }, (_, i) =>
      mk({
        id: `m-${i}`,
        table_id: TABLE_A,
        slot_id: SLOT_1,
        visitor_profile_id: `visitor-${i}`,
        visitor_company_id: COMPANY_X,
      }),
    );
    const res = countBookedSlotsPerCompany({
      slots,
      meetings,
      companyTableIds: [TABLE_A],
    });
    expect(res).toEqual({ total: 3, booked: 1, free: 2 });
  });

  it("ignora mesas de outra empresa", () => {
    const slots: SlotLite[] = [slotA1, slotB1];
    const meetings: MeetingLite[] = [
      mk({
        table_id: TABLE_B,
        slot_id: SLOT_1,
        visitor_profile_id: OUTSIDER,
        visitor_company_id: COMPANY_Y,
      }),
    ];
    expect(
      countBookedSlotsPerCompany({
        slots,
        meetings,
        companyTableIds: [TABLE_A],
      }),
    ).toEqual({ total: 1, booked: 0, free: 1 });
  });
});

describe("buildCompanyBusyStartTables + indexMeetingsByPair", () => {
  it("build maps grouped correctly", () => {
    const meetings: MeetingLite[] = [
      mk({
        table_id: TABLE_A,
        slot_id: SLOT_1,
        visitor_profile_id: COLLEAGUE,
        visitor_company_id: COMPANY_X,
        start_at: START_1,
      }),
      mk({
        table_id: TABLE_B,
        slot_id: SLOT_1,
        visitor_profile_id: COLLEAGUE,
        visitor_company_id: COMPANY_X,
        start_at: START_1,
      }),
      mk({
        table_id: TABLE_A,
        slot_id: SLOT_2,
        visitor_profile_id: OUTSIDER,
        visitor_company_id: COMPANY_Y,
        start_at: START_2,
      }),
    ];
    const map = buildCompanyBusyStartTables(meetings, COMPANY_X);
    expect(map.get(START_1)?.size).toBe(2);
    expect(map.get(START_2)).toBeUndefined();

    const byPair = indexMeetingsByPair(meetings);
    expect(byPair.get(`${TABLE_A}::${SLOT_1}`)?.length).toBe(1);
    expect(byPair.get(`${TABLE_A}::${SLOT_2}`)?.length).toBe(1);
  });

  it("returns empty map when visitorCompanyId is null", () => {
    const map = buildCompanyBusyStartTables(
      [
        mk({
          table_id: TABLE_A,
          slot_id: SLOT_1,
          visitor_profile_id: OUTSIDER,
          visitor_company_id: COMPANY_X,
          start_at: START_1,
        }),
      ],
      null,
    );
    expect(map.size).toBe(0);
  });
});

describe("consistency: classifier <-> assertCanBook <-> availability", () => {
  it("any (table,slot) marked free-for-visitor also passes assertCanBook", () => {
    // Property-style check across a small combinatorial space.
    const scenarios: MeetingLite[][] = [
      [],
      [mk({ table_id: TABLE_A, slot_id: SLOT_1, visitor_profile_id: COLLEAGUE, visitor_company_id: COMPANY_X })],
    ];
    for (const meetingsOnPair of scenarios) {
      const status = classifySlotForVisitor({
        slot: slotA1,
        meetingsOnPair,
        visitorProfileId: VISITOR,
        visitorCompanyId: COMPANY_X,
        visitorBusyStarts: new Set(),
        visitorTables: new Set(),
        companyBusyStartTables: new Map(),
      });
      if (status === "free" || status === "same_company") {
        expect(() =>
          assertCanBook({
            visitor: { id: VISITOR, company_id: COMPANY_X },
            slot: { id: SLOT_1, table_id: TABLE_A, start_at: START_1, end_at: END_1 },
            visitorScheduledMeetings: [],
            meetingsOnPair,
            sameEventMeetingsAtStart: [],
          }),
        ).not.toThrow();
      }
    }
  });

  it("physical-booked flag agrees with classifier: if free-for-generic-visitor then not booked", () => {
    const pair: MeetingLite[] = [];
    const status = classifySlotForVisitor({
      slot: slotA1,
      meetingsOnPair: pair,
      visitorProfileId: "anyone",
      visitorCompanyId: "any-company",
      visitorBusyStarts: new Set(),
      visitorTables: new Set(),
    });
    expect(status).toBe("free");
    expect(slotIsPhysicallyBooked(pair)).toBe(false);
  });

  it("no lotada when there is a free slot", () => {
    // Total 4, booked 3 (each on its own pair) → free must be 1.
    const slots: SlotLite[] = [
      { id: "s1", table_id: TABLE_A, start_at: "t1", end_at: "t1e" },
      { id: "s2", table_id: TABLE_A, start_at: "t2", end_at: "t2e" },
      { id: "s3", table_id: TABLE_A, start_at: "t3", end_at: "t3e" },
      { id: "s4", table_id: TABLE_A, start_at: "t4", end_at: "t4e" },
    ];
    const meetings: MeetingLite[] = [
      mk({ id: "m1", table_id: TABLE_A, slot_id: "s1", visitor_profile_id: "v1", visitor_company_id: COMPANY_X }),
      mk({ id: "m2", table_id: TABLE_A, slot_id: "s2", visitor_profile_id: "v2", visitor_company_id: COMPANY_X }),
      mk({ id: "m3", table_id: TABLE_A, slot_id: "s3", visitor_profile_id: "v3", visitor_company_id: COMPANY_X }),
    ];
    const res = countBookedSlotsPerCompany({
      slots,
      meetings,
      companyTableIds: [TABLE_A],
    });
    expect(res.free).toBeGreaterThan(0);
    expect(res.total).toBeGreaterThan(res.booked);
  });
});