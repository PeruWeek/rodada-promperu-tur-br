import { describe, expect, it } from "vitest";

import {
  EXPECTED_MEETINGS_MIN,
  bucketGroupFromMeetings,
  operationalStatusFromMeetings,
} from "@/lib/scheduling-status";

describe("scheduling-status helper — canonical bucket rule", () => {
  it("count = 0 → sem_agendamento, no operational status", () => {
    expect(bucketGroupFromMeetings(0)).toBe("sem_agendamento");
    expect(operationalStatusFromMeetings(0)).toBeNull();
  });

  it("count = 1 → com_agendamento + agendado_parcial", () => {
    expect(bucketGroupFromMeetings(1)).toBe("com_agendamento");
    expect(operationalStatusFromMeetings(1)).toBe("agendado_parcial");
  });

  it("count = EXPECTED_MEETINGS_MIN - 1 → parcial", () => {
    const c = EXPECTED_MEETINGS_MIN - 1;
    expect(bucketGroupFromMeetings(c)).toBe("com_agendamento");
    expect(operationalStatusFromMeetings(c)).toBe("agendado_parcial");
  });

  it("count = EXPECTED_MEETINGS_MIN → agendado_ok", () => {
    expect(bucketGroupFromMeetings(EXPECTED_MEETINGS_MIN)).toBe("com_agendamento");
    expect(operationalStatusFromMeetings(EXPECTED_MEETINGS_MIN)).toBe("agendado_ok");
  });

  it("count = EXPECTED_MEETINGS_MIN + 1 → ok", () => {
    const c = EXPECTED_MEETINGS_MIN + 1;
    expect(bucketGroupFromMeetings(c)).toBe("com_agendamento");
    expect(operationalStatusFromMeetings(c)).toBe("agendado_ok");
  });

  it("negative/garbage counts collapse to sem_agendamento", () => {
    expect(bucketGroupFromMeetings(-3)).toBe("sem_agendamento");
    expect(operationalStatusFromMeetings(-3)).toBeNull();
  });
});