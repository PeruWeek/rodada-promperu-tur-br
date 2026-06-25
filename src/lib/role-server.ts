/* eslint-disable @typescript-eslint/no-explicit-any */
// Server-only helper: resolve the caller's primary role from user_roles
// using the same priority as the front-end (`getPrimaryRole`).
// Accepts an injected supabase client so it is trivially mockable from
// unit tests. Production callers pass `supabaseAdmin`.

export type ServerPrimaryRole =
  | "admin"
  | "staff"
  | "cliente"
  | "exhibitor"
  | "visitor"
  | null;

const PRIORITY: Exclude<ServerPrimaryRole, null>[] = [
  "admin",
  "staff",
  "cliente",
  "exhibitor",
  "visitor",
];

export async function getPrimaryRoleServer(
  supabase: any,
  userId: string,
): Promise<ServerPrimaryRole> {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const set = new Set<string>((data ?? []).map((r: { role: string }) => r.role));
  for (const r of PRIORITY) if (set.has(r)) return r;
  return null;
}

export const CLIENTE_ALLOWED_SCHEDULING_STATUSES = [
  "agendado_ok",
  "agendado_parcial",
] as const;

/**
 * Throws `Error("Forbidden")` unless the caller has the `admin` role.
 * Mirrors the contract used by the duplicated `assertAdmin` helpers across
 * `*.functions.ts` modules; exposed here for unit-testable injection.
 */
export async function assertAdminRole(supabase: any, userId: string): Promise<void> {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const ok = ((data ?? []) as Array<{ role: string }>).some((r) => r.role === "admin");
  if (!ok) throw new Error("Forbidden: admin only");
}

/**
 * Throws `Error("Forbidden")` unless the caller has `admin` or `staff`.
 * Used by mutations safe for staff (lunch toggle, etc.).
 */
export async function assertAdminOrStaffRole(
  supabase: any,
  userId: string,
): Promise<void> {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const ok = ((data ?? []) as Array<{ role: string }>).some(
    (r) => r.role === "admin" || r.role === "staff",
  );
  if (!ok) throw new Error("Forbidden");
}