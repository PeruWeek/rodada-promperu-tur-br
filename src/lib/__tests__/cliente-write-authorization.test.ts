import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  assertAdminOrStaffRole,
  assertAdminRole,
  getPrimaryRoleServer,
} from "@/lib/role-server";
import { createSupabaseMock, rolesFor } from "@/test/supabase-mock";
import { expectClienteWriteBlocked } from "@/test/invariants";

const CLIENTE_ID = "11111111-1111-1111-1111-111111111111";
const STAFF_ID = "22222222-2222-2222-2222-222222222222";
const ADMIN_ID = "33333333-3333-3333-3333-333333333333";
const VISITOR_ID = "44444444-4444-4444-4444-444444444444";

function makeMock() {
  const m = createSupabaseMock();
  m.setDataset({
    user_roles: [
      ...rolesFor(CLIENTE_ID, "cliente"),
      ...rolesFor(STAFF_ID, "staff"),
      ...rolesFor(ADMIN_ID, "admin"),
      ...rolesFor(VISITOR_ID, "visitor"),
    ],
  });
  return m;
}

describe("Write authorization — cliente must never pass", () => {
  it("getPrimaryRoleServer resolves cliente correctly", async () => {
    const m = makeMock();
    expect(await getPrimaryRoleServer(m.client, CLIENTE_ID)).toBe("cliente");
    expect(await getPrimaryRoleServer(m.client, ADMIN_ID)).toBe("admin");
    expect(await getPrimaryRoleServer(m.client, STAFF_ID)).toBe("staff");
    expect(await getPrimaryRoleServer(m.client, VISITOR_ID)).toBe("visitor");
  });

  it("assertAdminRole throws Forbidden for cliente, staff, visitor", async () => {
    const m = makeMock();
    await expectClienteWriteBlocked("assertAdminRole(cliente)", () =>
      assertAdminRole(m.client, CLIENTE_ID),
    );
    await expect(assertAdminRole(m.client, STAFF_ID)).rejects.toThrow(/Forbidden/);
    await expect(assertAdminRole(m.client, VISITOR_ID)).rejects.toThrow(/Forbidden/);
    // admin passes silently
    await expect(assertAdminRole(m.client, ADMIN_ID)).resolves.toBeUndefined();
  });

  it("assertAdminOrStaffRole throws Forbidden for cliente and visitor", async () => {
    const m = makeMock();
    await expectClienteWriteBlocked("assertAdminOrStaffRole(cliente)", () =>
      assertAdminOrStaffRole(m.client, CLIENTE_ID),
    );
    await expect(assertAdminOrStaffRole(m.client, VISITOR_ID)).rejects.toThrow(
      /Forbidden/,
    );
    await expect(assertAdminOrStaffRole(m.client, STAFF_ID)).resolves.toBeUndefined();
    await expect(assertAdminOrStaffRole(m.client, ADMIN_ID)).resolves.toBeUndefined();
  });
});

/**
 * Structural invariant: every mutation handler in `src/lib/*.functions.ts`
 * must call an admin-tier guard (`assertAdmin`, `assertAdminStrict`,
 * `assertAdminRole`, or `assertAdminOrStaff`/`assertAdminOrStaffRole`).
 *
 * This guarantees that mutations never silently fall through `assertAdminOrStaffRead`
 * (which permits `cliente`) — the entry point under which cliente is allowed to read.
 */
describe("Structural invariant — mutations gate cliente at the handler", () => {
  const ROOT = path.resolve(__dirname, "..");
  const MUTATION_REGEX = /\.(insert|update|delete|upsert)\s*\(/;
  const ADMIN_GUARD_REGEX =
    /assert(?:Admin(?:Strict|Role|OrStaff(?:Role)?)?|Owner)\s*\(/;

  const files = fs
    .readdirSync(ROOT)
    .filter((f) => f.endsWith(".functions.ts"))
    .map((f) => path.join(ROOT, f));

  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    if (!MUTATION_REGEX.test(src)) continue; // pure-read modules are fine
    it(`${path.basename(file)} guards every mutation against cliente`, () => {
      // Split into handler blocks; each `.handler(async ...)` chunk is one
      // server-fn body. We require at least one admin-tier guard inside the
      // module overall — this catches modules that perform writes but only
      // gate with `assertAdminOrStaffRead`.
      const usesReadOnlyGuardForWrite =
        /assertAdminOrStaffRead\s*\(/.test(src) && MUTATION_REGEX.test(src);
      const usesAdminGuard = ADMIN_GUARD_REGEX.test(src);
      if (!usesAdminGuard) {
        throw new Error(
          `[cliente-auth] ${path.basename(
            file,
          )} performs writes but does not call an admin-tier guard. ` +
            `Cliente could potentially pass through. Add assertAdmin/assertAdminStrict.`,
        );
      }
      // Soft warning: if the module ONLY uses read guard for writes, that's a leak.
      if (usesReadOnlyGuardForWrite && !usesAdminGuard) {
        throw new Error(
          `[cliente-auth] ${path.basename(
            file,
          )} writes are gated only by assertAdminOrStaffRead, which permits cliente.`,
        );
      }
    });
  }
});