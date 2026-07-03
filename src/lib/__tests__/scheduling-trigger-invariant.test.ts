import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * INVARIANTE — `enforce_meeting_no_conflict` deve ser SECURITY DEFINER.
 * Sem isso, a checagem "1 slot = 1 empresa" é silenciada pelo RLS de
 * meetings quando o insert é feito por um visitante comum: a query interna
 * não enxerga reuniões de outros usuários e o conflito passa.
 * (Causa raiz do incidente 2026-07-03.)
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function readLastFunctionDefinition(name: string): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  let last: string | null = null;
  const re = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(\\)[\\s\\S]*?\\$function\\$;`,
    "i",
  );
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    const m = sql.match(re);
    if (m) last = m[0];
  }
  if (!last) throw new Error(`Definição de ${name} não encontrada`);
  return last;
}

describe("enforce_meeting_no_conflict trigger invariant", () => {
  it("last definition is SECURITY DEFINER", () => {
    const def = readLastFunctionDefinition("enforce_meeting_no_conflict").toLowerCase();
    expect(def).toMatch(/security\s+definer/);
  });

  it("last definition still uses pg_advisory_xact_lock for concurrency", () => {
    const def = readLastFunctionDefinition("enforce_meeting_no_conflict").toLowerCase();
    expect(def).toMatch(/pg_advisory_xact_lock/);
  });
});