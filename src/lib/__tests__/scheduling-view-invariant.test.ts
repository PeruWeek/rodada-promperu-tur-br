import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * INVARIANTE — o ramo `exhibitor` da view `v_company_event_pipeline` deve
 * contar pares DISTINTOS `(m.table_id, m.slot_id)`, não `count(*)` cru de
 * meetings. `count(*)` cru infla quando o mesmo slot físico tem múltiplas
 * pessoas da mesma empresa (regra permitida) e provocou o card
 * "Com agendamento · 21/22" no incidente 1-slot-1-empresa 2026-07-03.
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function readLastViewDefinition(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  let last: string | null = null;
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    if (/create\s+or\s+replace\s+view\s+public\.v_company_event_pipeline/i.test(sql)) {
      last = sql;
    }
  }
  if (!last) throw new Error("v_company_event_pipeline não encontrada em nenhuma migration");
  return last;
}

describe("v_company_event_pipeline exhibitor branch invariant", () => {
  it("exhibitor branch counts DISTINCT (table_id, slot_id) — never raw count(*) of meetings", () => {
    const sql = readLastViewDefinition().toLowerCase();
    // Deve mencionar DISTINCT m.table_id, m.slot_id no ramo exhibitor.
    expect(sql).toMatch(/distinct\s+m\.table_id\s*,\s*m\.slot_id/);
    // Deve ter o CASE por company_role.
    expect(sql).toMatch(/case\s+cep\.company_role/);
  });
});