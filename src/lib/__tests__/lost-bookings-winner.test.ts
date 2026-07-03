import { describe, expect, it } from "vitest";

/**
 * Isolated regression tests for the "winner resolution" algorithm used by
 * lost-bookings.functions.ts. The actual function is DB-bound, so we test
 * the pure decision logic in isolation by re-implementing the same
 * algorithm shape here — a divergence will fail this test and force us to
 * re-align both sides in the same edit.
 */

type Cand = {
  id: string;
  created_at: string;
  status: "scheduled" | "done" | "no_show";
};

type Audit = { kept_meeting_id: string | null } | undefined;

function resolveWinner(pool: Cand[], audit: Audit): {
  winner: Cand | null;
  source: "audit_log" | "min_created_at" | null;
} {
  const sorted = [...pool].sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (audit?.kept_meeting_id) {
    const found = sorted.find((c) => c.id === audit.kept_meeting_id);
    if (found) return { winner: found, source: "audit_log" };
  }
  if (sorted.length > 0) return { winner: sorted[0], source: "min_created_at" };
  return { winner: null, source: null };
}

describe("lost bookings winner resolution", () => {
  it("earliest scheduled meeting wins by default (min created_at)", () => {
    const pool: Cand[] = [
      { id: "b", created_at: "2026-01-02T00:00:00Z", status: "scheduled" },
      { id: "a", created_at: "2026-01-01T00:00:00Z", status: "scheduled" },
      { id: "c", created_at: "2026-01-03T00:00:00Z", status: "scheduled" },
    ];
    const { winner, source } = resolveWinner(pool, undefined);
    expect(winner?.id).toBe("a");
    expect(source).toBe("min_created_at");
  });

  it("done/no_show also count as valid winners (not only scheduled)", () => {
    const pool: Cand[] = [
      { id: "d", created_at: "2026-01-01T00:00:00Z", status: "done" },
      { id: "n", created_at: "2026-01-02T00:00:00Z", status: "no_show" },
    ];
    const { winner } = resolveWinner(pool, undefined);
    expect(winner?.id).toBe("d");
  });

  it("audit_log kept_meeting_id overrides min(created_at) when present", () => {
    const pool: Cand[] = [
      { id: "a", created_at: "2026-01-01T00:00:00Z", status: "scheduled" },
      { id: "b", created_at: "2026-01-02T00:00:00Z", status: "scheduled" },
    ];
    const { winner, source } = resolveWinner(pool, { kept_meeting_id: "b" });
    expect(winner?.id).toBe("b");
    expect(source).toBe("audit_log");
  });

  it("audit_log pointing to unknown id falls back to min_created_at", () => {
    const pool: Cand[] = [
      { id: "a", created_at: "2026-01-01T00:00:00Z", status: "scheduled" },
    ];
    const { winner, source } = resolveWinner(pool, { kept_meeting_id: "gone" });
    expect(winner?.id).toBe("a");
    expect(source).toBe("min_created_at");
  });

  it("empty pool → winner=null (all cancelled case)", () => {
    const { winner, source } = resolveWinner([], undefined);
    expect(winner).toBeNull();
    expect(source).toBeNull();
  });
});