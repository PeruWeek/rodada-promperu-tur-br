import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(userId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (!(data ?? []).some((r) => r.role === "admin")) {
    throw new Error("Forbidden");
  }
}

export type ReviewRow = {
  id: string;
  auth_user_id: string | null;
  full_name: string;
  email: string | null;
  company_id: string | null;
  company_trade_name: string | null;
  company_tax_id: string | null;
  company_country: string | null;
  review_reasons: string[];
  review_created_at: string | null;
  review_payload: Record<string, unknown> | null;
  candidates: Array<{
    id: string;
    full_name: string;
    email: string | null;
    company_trade_name: string | null;
    company_tax_id: string | null;
    company_country: string | null;
  }>;
};

export const listReviewQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { limit?: number } | undefined) => input ?? {})
  .handler(async ({ data, context }): Promise<{ rows: ReviewRow[]; total: number }> => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const limit = Math.min(Math.max(data.limit ?? 200, 1), 500);

    const { data: rows, error } = await supabaseAdmin
      .from("profiles")
      .select(
        "id, auth_user_id, full_name, email, company_id, review_reasons, review_created_at, review_payload",
      )
      .eq("review_status", "needs_review")
      .order("review_created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);

    const list = rows ?? [];
    const companyIds = Array.from(
      new Set(list.map((r) => r.company_id).filter(Boolean) as string[]),
    );
    let companiesById: Record<
      string,
      { id: string; trade_name: string | null; tax_id: string | null; country_code: string | null }
    > = {};
    if (companyIds.length) {
      const { data: comps } = await supabaseAdmin
        .from("companies")
        .select("id, trade_name, tax_id, country_code")
        .in("id", companyIds);
      for (const c of comps ?? []) companiesById[c.id] = c;
    }

    // Find candidate pre-registrations for each row by email or tax_id
    const enriched: ReviewRow[] = [];
    for (const r of list) {
      const tax = companiesById[r.company_id ?? ""]?.tax_id ?? null;
      const emailNorm = (r.email ?? "").trim().toLowerCase();

      let candIds: string[] = [];
      if (emailNorm) {
        const { data: byEmail } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("pending_signup", true)
          .is("auth_user_id", null)
          .ilike("email", emailNorm);
        candIds.push(...(byEmail ?? []).map((p) => p.id));
      }
      if (tax) {
        const { data: companiesByTax } = await supabaseAdmin
          .from("companies")
          .select("id")
          .eq("tax_id", tax);
        const cids = (companiesByTax ?? []).map((c) => c.id);
        if (cids.length) {
          const { data: byTax } = await supabaseAdmin
            .from("profiles")
            .select("id")
            .eq("pending_signup", true)
            .is("auth_user_id", null)
            .in("company_id", cids);
          candIds.push(...(byTax ?? []).map((p) => p.id));
        }
      }
      candIds = Array.from(new Set(candIds)).filter((id) => id !== r.id);

      let candidates: ReviewRow["candidates"] = [];
      if (candIds.length) {
        const { data: cands } = await supabaseAdmin
          .from("profiles")
          .select("id, full_name, email, company_id")
          .in("id", candIds);
        const ccompIds = Array.from(
          new Set((cands ?? []).map((p) => p.company_id).filter(Boolean) as string[]),
        );
        const { data: ccomps } = ccompIds.length
          ? await supabaseAdmin
              .from("companies")
              .select("id, trade_name, tax_id, country_code")
              .in("id", ccompIds)
          : { data: [] as Array<{ id: string; trade_name: string | null; tax_id: string | null; country_code: string | null }> };
        const cmap = new Map((ccomps ?? []).map((c) => [c.id, c]));
        candidates = (cands ?? []).map((p) => {
          const c = p.company_id ? cmap.get(p.company_id) : null;
          return {
            id: p.id,
            full_name: p.full_name,
            email: p.email as string | null,
            company_trade_name: c?.trade_name ?? null,
            company_tax_id: c?.tax_id ?? null,
            company_country: c?.country_code ?? null,
          };
        });
      }

      const co = r.company_id ? companiesById[r.company_id] : null;
      enriched.push({
        id: r.id,
        auth_user_id: r.auth_user_id as string | null,
        full_name: r.full_name,
        email: r.email as string | null,
        company_id: r.company_id as string | null,
        company_trade_name: co?.trade_name ?? null,
        company_tax_id: co?.tax_id ?? null,
        company_country: co?.country_code ?? null,
        review_reasons: (r.review_reasons ?? []) as string[],
        review_created_at: r.review_created_at as string | null,
        review_payload: (r.review_payload ?? null) as Record<string, unknown> | null,
        candidates,
      });
    }

    return { rows: enriched, total: enriched.length };
  });

async function loadActor(userId: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  return data?.id ?? null;
}

async function auditAction(action: string, payload: Record<string, unknown>, actorId: string | null) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("audit_logs")
    .insert({ action, payload, actor_profile_id: actorId });
}

/** Mark review resolved (keep separate). */
export const resolveReviewKeep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ profileId: z.string().uuid(), note: z.string().max(500).optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const actor = await loadActor(context.userId);
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        review_status: "resolved",
        review_resolved_at: new Date().toISOString(),
        review_resolved_by: actor,
      })
      .eq("id", data.profileId);
    if (error) throw new Error(error.message);
    await auditAction("review.keep_separate", { profile_id: data.profileId, note: data.note ?? null }, actor);
    return { ok: true };
  });

/** Soft-discard the duplicate profile under review. */
export const resolveReviewDiscard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ profileId: z.string().uuid(), note: z.string().max(500).optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const actor = await loadActor(context.userId);
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        is_active: false,
        review_status: "resolved",
        review_resolved_at: new Date().toISOString(),
        review_resolved_by: actor,
      })
      .eq("id", data.profileId);
    if (error) throw new Error(error.message);
    await auditAction("review.discard_duplicate", { profile_id: data.profileId, note: data.note ?? null }, actor);
    return { ok: true };
  });

/** Link the new (review) profile to the chosen pre-registration:
 * transfer auth_user_id to the pre-reg, delete/disable the duplicate.
 */
export const resolveReviewLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      profileId: z.string().uuid(),
      candidateProfileId: z.string().uuid(),
      note: z.string().max(500).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const actor = await loadActor(context.userId);

    const { data: rev } = await supabaseAdmin
      .from("profiles")
      .select("id, auth_user_id, company_id, full_name, job_title, phone, whatsapp, preferred_language, email")
      .eq("id", data.profileId)
      .maybeSingle();
    const { data: target } = await supabaseAdmin
      .from("profiles")
      .select("id, auth_user_id, company_id, pending_signup")
      .eq("id", data.candidateProfileId)
      .maybeSingle();
    if (!rev || !target) throw new Error("Profile not found");
    if (target.auth_user_id) throw new Error("Target pre-registration already claimed");
    if (!rev.auth_user_id) throw new Error("Source profile has no auth user");

    // Detach reviewed profile from its auth user before moving it to the target.
    const { error: detachErr } = await supabaseAdmin
      .from("profiles")
      .update({
        auth_user_id: null,
        is_active: false,
        review_status: "resolved",
        review_resolved_at: new Date().toISOString(),
        review_resolved_by: actor,
      })
      .eq("id", data.profileId);
    if (detachErr) throw new Error(detachErr.message);

    const patch: Record<string, unknown> = {
      auth_user_id: rev.auth_user_id,
      pending_signup: false,
    };
    if (!target.company_id && rev.company_id) patch.company_id = rev.company_id;
    if (rev.full_name) patch.full_name = rev.full_name;
    if (rev.job_title) patch.job_title = rev.job_title;
    if (rev.phone) patch.phone = rev.phone;
    if (rev.whatsapp) patch.whatsapp = rev.whatsapp;
    if (rev.preferred_language) patch.preferred_language = rev.preferred_language;

    const { error: linkErr } = await supabaseAdmin
      .from("profiles")
      .update(patch)
      .eq("id", data.candidateProfileId);
    if (linkErr) throw new Error(linkErr.message);

    await auditAction(
      "review.linked",
      {
        profile_id: data.profileId,
        candidate_profile_id: data.candidateProfileId,
        note: data.note ?? null,
      },
      actor,
    );
    return { ok: true };
  });

/** Merge form fields into the pre-registration profile (form wins on filled fields),
 * then discard the duplicate.
 */
export const resolveReviewMerge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      profileId: z.string().uuid(),
      candidateProfileId: z.string().uuid(),
      note: z.string().max(500).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const actor = await loadActor(context.userId);

    const { data: rev } = await supabaseAdmin
      .from("profiles")
      .select("id, auth_user_id, company_id, full_name, job_title, phone, whatsapp, preferred_language")
      .eq("id", data.profileId)
      .maybeSingle();
    const { data: target } = await supabaseAdmin
      .from("profiles")
      .select("id, auth_user_id, company_id, full_name, job_title, phone, whatsapp")
      .eq("id", data.candidateProfileId)
      .maybeSingle();
    if (!rev || !target) throw new Error("Profile not found");
    if (target.auth_user_id) throw new Error("Target pre-registration already claimed");
    if (!rev.auth_user_id) throw new Error("Source profile has no auth user");

    // Merge companies: copy non-null reviewed fields into target's company (or attach reviewed company)
    if (rev.company_id && target.company_id && rev.company_id !== target.company_id) {
      const { data: srcCo } = await supabaseAdmin
        .from("companies")
        .select("*")
        .eq("id", rev.company_id)
        .maybeSingle();
      if (srcCo) {
        const patch: Record<string, unknown> = {};
        for (const k of [
          "trade_name", "legal_name", "tax_id", "registration_id", "country_code",
          "state_code", "city", "website", "instagram", "linkedin", "address",
          "general_phone", "specialty", "import_profile",
        ] as const) {
          const v = (srcCo as Record<string, unknown>)[k];
          if (v !== null && v !== undefined && v !== "") patch[k] = v;
        }
        if (Object.keys(patch).length) {
          await supabaseAdmin.from("companies").update(patch).eq("id", target.company_id);
        }
      }
    }

    // Detach reviewed profile from auth user, then claim the pre-registration
    await supabaseAdmin
      .from("profiles")
      .update({
        auth_user_id: null,
        is_active: false,
        review_status: "resolved",
        review_resolved_at: new Date().toISOString(),
        review_resolved_by: actor,
      })
      .eq("id", data.profileId);

    const patch: Record<string, unknown> = {
      auth_user_id: rev.auth_user_id,
      pending_signup: false,
    };
    if (rev.full_name) patch.full_name = rev.full_name;
    if (rev.job_title) patch.job_title = rev.job_title;
    if (rev.phone) patch.phone = rev.phone;
    if (rev.whatsapp) patch.whatsapp = rev.whatsapp;
    if (rev.preferred_language) patch.preferred_language = rev.preferred_language;
    if (!target.company_id && rev.company_id) patch.company_id = rev.company_id;

    const { error: linkErr } = await supabaseAdmin
      .from("profiles")
      .update(patch)
      .eq("id", data.candidateProfileId);
    if (linkErr) throw new Error(linkErr.message);

    await auditAction(
      "review.merged",
      {
        profile_id: data.profileId,
        candidate_profile_id: data.candidateProfileId,
        note: data.note ?? null,
      },
      actor,
    );
    return { ok: true };
  });