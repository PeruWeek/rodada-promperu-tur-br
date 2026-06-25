import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Invariant: nobody re-implements the bucket rule outside the canonical
 * helper (`src/lib/scheduling-status.ts`).
 *
 * What this test FLAGS:
 *   - ternários `scheduled_meetings_count <op> 0 ? "sem_agendamento" ...`
 *   - early `return "sem_agendamento"|"com_agendamento"` imediatamente após
 *     uma comparação de `scheduled_meetings_count` com `0`.
 *
 * What this test does NOT flag:
 *   - usar o literal `"sem_agendamento"` ou `"com_agendamento"` sozinho
 *     (filtros, badges, enums, queries),
 *   - comparações `scheduled_meetings_count <op> 0` sozinhas (queries),
 *   - SQL, migrations, fixtures, tests.
 */

const ROOT = join(process.cwd(), "src");
const ALLOWLIST = new Set<string>([
  // The helper itself.
  "lib/scheduling-status.ts",
]);
const EXCLUDE_DIRS = new Set([
  "__tests__",
  "test",
  "node_modules",
  "integrations", // generated supabase code
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

// Ternary form: count <op> 0 ? "sem_agendamento"|"com_agendamento"
const RE_TERNARY =
  /scheduled_meetings_count\s*(?:===?|!==?|<=?|>=?)\s*0\s*\?\s*["'](?:sem_agendamento|com_agendamento)["']/;
// Reverse ternary form: count <op> 0 ? "com_..." : "sem_..."  / etc.
const RE_TERNARY_TAIL =
  /scheduled_meetings_count\s*(?:===?|!==?|<=?|>=?)\s*0[^\n;]{0,80}\?[^\n;]{0,80}["'](?:sem_agendamento|com_agendamento)["']/;
// `return "sem_agendamento"|"com_agendamento"` within ~3 lines after a count check.
function flagsReturnAfterCheck(src: string): boolean {
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!/scheduled_meetings_count\s*(?:===?|!==?|<=?|>=?)\s*0/.test(lines[i])) continue;
    const window = lines.slice(i, Math.min(lines.length, i + 4)).join("\n");
    if (/return\s+["'](?:sem_agendamento|com_agendamento)["']/.test(window)) return true;
  }
  return false;
}

describe("invariant: bucket rule lives only in scheduling-status.ts", () => {
  it("no file re-implements bucketGroupFromMeetings", () => {
    const offenders: Array<{ file: string; pattern: string }> = [];
    for (const abs of walk(ROOT)) {
      const rel = relative(ROOT, abs).replaceAll("\\", "/");
      if (ALLOWLIST.has(rel)) continue;
      const src = readFileSync(abs, "utf8");
      if (RE_TERNARY.test(src)) offenders.push({ file: rel, pattern: "ternary" });
      else if (RE_TERNARY_TAIL.test(src))
        offenders.push({ file: rel, pattern: "ternary-tail" });
      else if (flagsReturnAfterCheck(src))
        offenders.push({ file: rel, pattern: "return-after-check" });
    }
    expect(
      offenders,
      `Bucket rule re-implementation detected. Use bucketGroupFromMeetings ` +
        `from src/lib/scheduling-status.ts instead.\nOffenders: ` +
        JSON.stringify(offenders, null, 2),
    ).toEqual([]);
  });
});