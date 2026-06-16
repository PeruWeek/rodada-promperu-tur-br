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

const completeExhibitorSchema = z.object({
  trade_name: z.string().trim().min(2).max(160),
  city: z.string().trim().min(2).max(120),
  full_name: z.string().trim().min(2).max(160),
  job_title: z.string().trim().min(2).max(120),
  whatsapp: z.string().trim().min(6).max(40),
  preferred_language: z.enum(["pt-BR", "es"]),
  segments: z.array(z.string()).min(1).max(50),
  services: z.array(z.string()).min(1).max(50),
});

/**
 * Finalizes the exhibitor quick signup: creates the company (PE), updates
 * the caller's profile, seeds exhibitor_profiles, and opens a pending
 * exhibitor_request. Idempotent — safe to call twice on retry.
 */
export const completeExhibitorSignup = createServerFn({ method: "POST" })
  .inputValidator((input) => completeExhibitorSchema.parse(input))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { userId } = context;

    // Block if user already has elevated role.
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if ((roles ?? []).some((r) => ["admin", "staff"].includes(r.role))) {
      throw new Error("Conta de admin/staff não pode virar expositor.");
    }

    // Resolve profile.
    const { data: prof, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("id, company_id, email")
      .eq("auth_user_id", userId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!prof) throw new Error("Profile not found");

    // Evaluate match quality against pending pre-registrations.
    // If the form data diverges from a pre-reg claimed at signup, flag for admin review.
    try {
      const { data: quality } = await supabaseAdmin.rpc("pre_reg_match_quality", {
        p_email: (prof.email as string | null) ?? "",
        p_country_code: "PE",
        p_trade_name: data.trade_name,
      });
      const q = quality as { unique?: boolean; reasons?: string[] } | null;
      if (q && q.unique === false && Array.isArray(q.reasons) && q.reasons.length > 0) {
        await supabaseAdmin
          .from("profiles")
          .update({
            review_status: "needs_review",
            review_reasons: q.reasons,
            review_created_at: new Date().toISOString(),
            review_payload: {
              source: "complete_exhibitor_signup",
              submitted: data,
              quality: q,
            },
          })
          .eq("id", prof.id);
      }
    } catch {
      // Non-fatal: continue with signup even if the quality check fails.
    }

    // Create company if the profile doesn't have one yet.
    let companyId = prof.company_id;
    if (!companyId) {
      const { data: comp, error: cErr } = await supabaseAdmin
        .from("companies")
        .insert({
          trade_name: data.trade_name,
          country_code: "PE",
          city: data.city,
        })
        .select("id")
        .single();
      if (cErr) throw new Error(cErr.message);
      companyId = comp.id;
      const { error: linkErr } = await supabaseAdmin
        .from("profiles")
        .update({ company_id: companyId })
        .eq("id", prof.id);
      if (linkErr) throw new Error(linkErr.message);
    } else {
      // Patch core fields if missing.
      await supabaseAdmin
        .from("companies")
        .update({
          trade_name: data.trade_name,
          country_code: "PE",
          city: data.city,
        })
        .eq("id", companyId);
    }

    // Patch personal profile fields.
    await supabaseAdmin
      .from("profiles")
      .update({
        full_name: data.full_name,
        job_title: data.job_title,
        whatsapp: data.whatsapp,
        phone: data.whatsapp,
        preferred_language: data.preferred_language,
      })
      .eq("id", prof.id);

    // Seed exhibitor_profile (upsert by profile_id).
    const { error: epErr } = await supabaseAdmin
      .from("exhibitor_profiles")
      .upsert(
        {
          profile_id: prof.id,
          segments: data.segments,
          services: data.services,
        },
        { onConflict: "profile_id" },
      );
    if (epErr) throw new Error(epErr.message);

    // Open (or reuse) the pending exhibitor request.
    const { data: existing } = await supabaseAdmin
      .from("exhibitor_requests")
      .select("id, status")
      .eq("profile_id", prof.id)
      .maybeSingle();
    if (!existing) {
      const { error: rErr } = await supabaseAdmin
        .from("exhibitor_requests")
        .insert({ profile_id: prof.id, status: "pending" });
      if (rErr) throw new Error(rErr.message);
    }

    return { ok: true };
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