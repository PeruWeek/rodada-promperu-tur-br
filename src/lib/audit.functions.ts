import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listAuditLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { limit?: number; action?: string | null } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const limit = Math.min(Math.max(data.limit ?? 200, 1), 500);
    let q = supabase
      .from("audit_logs")
      .select("id, created_at, action, payload, actor_profile_id, event_id")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (data.action) q = q.eq("action", data.action);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const actorIds = Array.from(
      new Set((rows ?? []).map((r) => r.actor_profile_id).filter(Boolean) as string[])
    );
    let actors: Record<string, { full_name: string | null; email: string | null }> = {};
    if (actorIds.length) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", actorIds);
      for (const p of prof ?? []) actors[p.id] = { full_name: p.full_name, email: p.email };
    }
    return { rows: rows ?? [], actors };
  });