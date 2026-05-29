import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const ok = (data ?? []).some((r) => r.role === "admin" || r.role === "staff");
  if (!ok) throw new Error("Forbidden");
}

export const assignExhibitorToTable = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        tableId: z.string().uuid(),
        exhibitorProfileId: z.string().uuid().nullable(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("event_tables")
      .update({ exhibitor_profile_id: data.exhibitorProfileId })
      .eq("id", data.tableId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setUserRole = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        userId: z.string().uuid(),
        role: z.enum(["admin", "staff", "exhibitor", "visitor"]),
        action: z.enum(["add", "remove"]),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    if (data.action === "add") {
      const { data: existing } = await supabaseAdmin
        .from("user_roles")
        .select("id")
        .eq("user_id", data.userId)
        .eq("role", data.role)
        .maybeSingle();
      if (!existing) {
        await supabaseAdmin.from("user_roles").insert({ user_id: data.userId, role: data.role });
      }
    } else {
      await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", data.userId)
        .eq("role", data.role);
    }
    return { ok: true };
  });

export const rebuildSlots = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ eventId: z.string().uuid() }).parse(input))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin.rpc("rebuild_event_time_slots", {
      p_event_id: data.eventId,
      p_deactivate_previous: true,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminSearchProfiles = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        q: z.string().optional(),
        activeOnly: z.boolean().optional(),
        requireAuthUser: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    let q = supabaseAdmin
      .from("profiles")
      .select("id, auth_user_id, full_name, email, company_id")
      .order("full_name")
      .limit(data.limit ?? 50);
    if (data.activeOnly) q = q.eq("is_active", true);
    if (data.requireAuthUser) q = q.not("auth_user_id", "is", null);
    if (data.q?.trim()) q = q.ilike("full_name", `%${data.q.trim()}%`);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { profiles: rows ?? [] };
  });