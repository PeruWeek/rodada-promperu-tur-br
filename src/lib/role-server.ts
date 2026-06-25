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