import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const ok = (data ?? []).some((r) => r.role === "admin");
  if (!ok) throw new Error("Forbidden: admin only");
}

async function getOwnProfileId(authUserId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Profile not found");
  return data.id;
}

export const requestExhibitorAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;

    // Block if user already has elevated role
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if ((roles ?? []).some((r) => ["admin", "staff", "exhibitor"].includes(r.role))) {
      throw new Error("Já possui acesso de expositor ou superior.");
    }

    const profileId = await getOwnProfileId(userId);

    // Idempotent: if a request already exists, return it (don't overwrite status)
    const { data: existing } = await supabaseAdmin
      .from("exhibitor_requests")
      .select("id, status")
      .eq("profile_id", profileId)
      .maybeSingle();
    if (existing) return { ok: true, status: existing.status };

    const { error } = await supabaseAdmin
      .from("exhibitor_requests")
      .insert({ profile_id: profileId, status: "pending" });
    if (error) throw new Error(error.message);
    return { ok: true, status: "pending" as const };
  });

export const getMyExhibitorRequest = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const profileId = await getOwnProfileId(context.userId);
    const { data } = await supabaseAdmin
      .from("exhibitor_requests")
      .select("id, status, created_at, reviewed_at, review_note")
      .eq("profile_id", profileId)
      .maybeSingle();
    return { request: data };
  });

export const listExhibitorRequests = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        status: z.enum(["pending", "approved", "rejected", "all"]).optional(),
      })
      .parse(input ?? {}),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    let q = supabaseAdmin
      .from("exhibitor_requests")
      .select("id, profile_id, status, created_at, reviewed_at, review_note")
      .order("created_at", { ascending: false });
    if (data.status && data.status !== "all") q = q.eq("status", data.status);
    const { data: reqs, error } = await q;
    if (error) throw new Error(error.message);

    const profIds = (reqs ?? []).map((r) => r.profile_id);
    const { data: profs } = profIds.length
      ? await supabaseAdmin
          .from("profiles")
          .select("id, full_name, email, company_id")
          .in("id", profIds)
      : { data: [] as Array<{ id: string; full_name: string; email: string | null; company_id: string | null }> };
    const compIds = (profs ?? []).map((p) => p.company_id).filter(Boolean) as string[];
    const { data: comps } = compIds.length
      ? await supabaseAdmin.from("companies").select("id, trade_name, country_code, city").in("id", compIds)
      : { data: [] as Array<{ id: string; trade_name: string; country_code: string; city: string | null }> };

    return {
      requests: (reqs ?? []).map((r) => {
        const p = (profs ?? []).find((x) => x.id === r.profile_id);
        const c = p?.company_id ? (comps ?? []).find((x) => x.id === p.company_id) : null;
        return {
          ...r,
          full_name: p?.full_name ?? "—",
          email: p?.email ?? null,
          company: c ? { trade_name: c.trade_name, country_code: c.country_code, city: c.city } : null,
        };
      }),
    };
  });

export const reviewExhibitorRequest = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        action: z.enum(["approve", "reject"]),
        note: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const reviewerProfileId = await getOwnProfileId(context.userId);
    const { error } = await supabaseAdmin
      .from("exhibitor_requests")
      .update({
        status: data.action === "approve" ? "approved" : "rejected",
        reviewed_by_profile_id: reviewerProfileId,
        reviewed_at: new Date().toISOString(),
        review_note: data.note ?? null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });