import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Invariant: the canonical scheduling rules live in `scheduling-rules.ts`
 * (guards + slot classification) and `scheduling-status.ts` (bucket
 * groups). No other file may (a) re-implement `other_company`/`same_company`
 * classification from scratch, nor (b) query `meetings.status = "scheduled"`
 * outside the allow-listed data-access modules.
 *
 * If you need a new place that touches scheduling, import from
 * `@/lib/scheduling-rules`; if a new module truly needs to read meetings,
 * add it to STATUS_SCHEDULED_ALLOWLIST after human review.
 */

const ROOT = join(process.cwd(), "src");

const EXCLUDE_DIRS = new Set([
  "__tests__",
  "test",
  "node_modules",
  "integrations", // generated
]);

/** Modules explicitly allowed to query `meetings.status = 'scheduled'`. */
const STATUS_SCHEDULED_ALLOWLIST = new Set<string>([
  "lib/booking.functions.ts",
  "lib/exhibitor-availability.functions.ts",
  "lib/dedupe-recovery.functions.ts",
  "lib/lost-bookings.functions.ts",
  "lib/table-agenda.functions.ts",
  "lib/checkin.functions.ts",
  "lib/staff-exports.functions.ts",
  "lib/staff.functions.ts",
  "lib/admin.functions.ts",
  "lib/admin-auth.functions.ts",
  "lib/pipeline.functions.ts",
  "lib/booking-reminders.server.ts",
  "lib/booking-reminders.functions.ts",
  "lib/llm/skills.server.ts",
  "lib/cliente-overview.ts",
  "lib/companies-report.ts",
  "components/admin/book-for-registrant-dialog.tsx",
]);

/** Modules explicitly allowed to declare an `SlotClassification`-like literal. */
const CLASSIFICATION_ALLOWLIST = new Set<string>([
  "lib/scheduling-rules.ts",
  "lib/booking.functions.ts", // re-exports VisitorBookingSlot type
  "lib/dedupe-recovery.functions.ts",
]);

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (EXCLUDE_DIRS.has(name)) continue;
      walk(abs, acc);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      acc.push(abs);
    }
  }
  return acc;
}

// Matches `.eq("status", "scheduled")` in either quote style.
const RE_STATUS_SCHEDULED =
  /\.eq\(\s*["']status["']\s*,\s*["']scheduled["']\s*\)/;

// Matches a re-declaration of the classification union type.
const RE_CLASSIFICATION_UNION =
  /["'](?:same_company|other_company)["']\s*\|\s*["'](?:free|mine|same_company|other_company)["']/;

describe("invariant: scheduling rules live in scheduling-rules.ts", () => {
  it("no unlisted file queries meetings.status = 'scheduled'", () => {
    const offenders: string[] = [];
    for (const abs of walk(ROOT)) {
      const rel = relative(ROOT, abs).replaceAll("\\", "/");
      if (STATUS_SCHEDULED_ALLOWLIST.has(rel)) continue;
      const src = readFileSync(abs, "utf8");
      if (RE_STATUS_SCHEDULED.test(src)) offenders.push(rel);
    }
    expect(
      offenders,
      "New file querying meetings.status = 'scheduled' outside the allow-list. " +
        "If this read is legitimate, add the file to STATUS_SCHEDULED_ALLOWLIST " +
        "in src/lib/__tests__/scheduling-rule-source-invariant.test.ts after review.",
    ).toEqual([]);
  });

  it("no unlisted file re-declares the SlotClassification union", () => {
    const offenders: string[] = [];
    for (const abs of walk(ROOT)) {
      const rel = relative(ROOT, abs).replaceAll("\\", "/");
      if (CLASSIFICATION_ALLOWLIST.has(rel)) continue;
      const src = readFileSync(abs, "utf8");
      if (RE_CLASSIFICATION_UNION.test(src)) offenders.push(rel);
    }
    expect(
      offenders,
      "SlotClassification union re-declared outside the allow-list. Import " +
        "`SlotClassification` from @/lib/scheduling-rules instead.",
    ).toEqual([]);
  });
});