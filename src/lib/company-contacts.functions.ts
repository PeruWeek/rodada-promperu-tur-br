import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { filterAndRankCompanies, normalizeCompanySearchValue } from "@/lib/company-search";

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const ok = (data ?? []).some((r) => r.role === "admin");
  if (!ok) throw new Error("Forbidden: admin only");
}

async function getActorProfileId(userId: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  return data?.id ?? null;
}

const addInput = z.object({
  company_id: z.string().uuid(),
  email: z.string().trim().email().max(255),
  full_name: z.string().trim().max(200).optional(),
  job_title: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  whatsapp: z.string().trim().max(40).optional(),
  preferred_language: z.enum(["pt-BR", "es"]).optional(),
});

export const addCompanyContact = createServerFn({ method: "POST" })
  .inputValidator((input) => addInput.parse(input))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const emailNorm = data.email.trim().toLowerCase();
    const lang = data.preferred_language ?? "pt-BR";

    const { data: company, error: cErr } = await supabaseAdmin
      .from("companies")
      .select("id, trade_name, legal_name")
      .eq("id", data.company_id)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!company) throw new Error("company_not_found");

    // profiles.email is citext, so case-insensitive equality is implicit.
    const { data: existing, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("id, auth_user_id, company_id, pending_signup, full_name, job_title, phone, whatsapp, preferred_language")
      .eq("email", emailNorm)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);

    let profileId: string;
    let status: "created" | "reused";

    if (existing) {
      if (existing.auth_user_id) throw new Error("email_already_active");
      if (existing.company_id && existing.company_id !== data.company_id) {
        throw new Error("email_linked_to_other_company");
      }
      const patch: {
        company_id?: string;
        pending_signup?: boolean;
        full_name?: string;
        job_title?: string;
        phone?: string;
        whatsapp?: string;
      } = {};
      if (!existing.company_id) patch.company_id = data.company_id;
      if (!existing.pending_signup) patch.pending_signup = true;
      if (!existing.full_name && data.full_name) patch.full_name = data.full_name;
      if (!existing.job_title && data.job_title) patch.job_title = data.job_title;
      if (!existing.phone && data.phone) patch.phone = data.phone;
      if (!existing.whatsapp && data.whatsapp) patch.whatsapp = data.whatsapp;
      if (Object.keys(patch).length > 0) {
        const { error: uErr } = await supabaseAdmin
          .from("profiles")
          .update(patch)
          .eq("id", existing.id);
        if (uErr) throw new Error(uErr.message);
      }
      profileId = existing.id;
      status = "reused";
    } else {
      const insertRow: {
        email: string;
        company_id: string;
        full_name: string;
        pending_signup: boolean;
        auth_user_id: null;
        preferred_language: "pt-BR" | "es";
        job_title?: string;
        phone?: string;
        whatsapp?: string;
      } = {
        email: emailNorm,
        company_id: data.company_id,
        full_name: data.full_name ?? "",
        pending_signup: true,
        auth_user_id: null,
        preferred_language: lang,
      };
      if (data.job_title) insertRow.job_title = data.job_title;
      if (data.phone) insertRow.phone = data.phone;
      if (data.whatsapp) insertRow.whatsapp = data.whatsapp;
      const { data: ins, error: iErr } = await supabaseAdmin
        .from("profiles")
        .insert(insertRow)
        .select("id")
        .single();
      if (iErr) throw new Error(iErr.message);
      profileId = ins.id;
      status = "created";
    }

    // Send invite email (best-effort; failures don't roll back profile).
    let inviteSent = false;
    let inviteError: string | null = null;
    try {
      const { processTransactionalSend } = await import("@/lib/email-send.server");
      const firstName = (data.full_name ?? "").trim().split(/\s+/)[0] ?? "";
      const result = await processTransactionalSend(supabaseAdmin, {
        templateName: "company-contact-invite",
        recipientEmail: emailNorm,
        idempotencyKey: `company-contact-invite:${data.company_id}:${emailNorm}`,
        templateData: {
          contactName: firstName,
          companyName: company.trade_name ?? company.legal_name ?? "",
          signupUrl: await (await import("@/lib/site-context.server")).siteUrl("/signup"),
        },
      });
      inviteSent = result.status >= 200 && result.status < 300 && result.body?.success !== false;
      if (!inviteSent) inviteError = String(result.body?.reason ?? result.body?.error ?? "send_failed");
    } catch (e) {
      inviteError = (e as Error).message;
    }

    try {
      const actor = await getActorProfileId(context.userId);
      await supabaseAdmin.from("audit_logs").insert({
        actor_profile_id: actor,
        action: "company_contact_invited",
        payload: {
          company_id: data.company_id,
          profile_id: profileId,
          email: emailNorm,
          status,
          invite_sent: inviteSent,
          invite_error: inviteError,
        },
      });
    } catch {
      /* best-effort audit */
    }

    return {
      profile_id: profileId,
      status,
      invite_sent: inviteSent,
      invite_error: inviteError,
    };
  });

const findInput = z.object({
  query: z.string().trim().min(1).max(200),
  limit: z.number().int().positive().max(50).optional(),
});

export const findCompanyForContact = createServerFn({ method: "POST" })
  .inputValidator((input) => findInput.parse(input))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const limit = data.limit ?? 10;

    const digits = data.query.replace(/\D+/g, "");
    const looksLikeCnpj = digits.length >= 8;
    const select = "id, trade_name, legal_name, tax_id, city, state_code";

    if (looksLikeCnpj) {
      // Match by digits-only tax_id (ignores formatting). We fetch then filter
      // because tax_id can be stored formatted.
      const { data: rows, error } = await supabaseAdmin
        .from("companies")
        .select(select)
        .limit(5000);
      if (error) throw new Error(error.message);
      const filtered = (rows ?? []).filter(
        (r) => (r.tax_id ?? "").replace(/\D+/g, "").includes(digits),
      );
      if (filtered.length > 0) return { rows: filtered.slice(0, limit) };
    }

    const { data: rows, error } = await supabaseAdmin
      .from("companies")
      .select(select)
      .limit(5000);
    if (error) throw new Error(error.message);
    const ranked = filterAndRankCompanies(
      rows ?? [],
      normalizeCompanySearchValue(data.query),
    ).slice(0, limit);
    return { rows: ranked };
  });

const lookupInput = z.object({
  email: z.string().trim().email().max(255),
});

export const lookupProfileByEmail = createServerFn({ method: "POST" })
  .inputValidator((input) => lookupInput.parse(input))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const emailNorm = data.email.trim().toLowerCase();

    const { data: profile, error } = await supabaseAdmin
      .from("profiles")
      .select("id, auth_user_id, full_name, email, company_id, pending_signup, is_active")
      .eq("email", emailNorm)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!profile) return { found: false as const };

    let company: {
      id: string;
      trade_name: string;
      legal_name: string | null;
      tax_id: string | null;
      city: string | null;
      state_code: string | null;
    } | null = null;
    if (profile.company_id) {
      const { data: c } = await supabaseAdmin
        .from("companies")
        .select("id, trade_name, legal_name, tax_id, city, state_code")
        .eq("id", profile.company_id)
        .maybeSingle();
      company = c ?? null;
    }
    return {
      found: true as const,
      profile: {
        id: profile.id,
        auth_user_id: profile.auth_user_id,
        full_name: profile.full_name,
        email: profile.email,
        company_id: profile.company_id,
        pending_signup: profile.pending_signup,
        is_active: profile.is_active,
      },
      current_company: company,
    };
  });

const reassignInput = z.object({
  email: z.string().trim().email().max(255),
  target_company_id: z.string().uuid(),
  reason: z.string().trim().min(10).max(500),
  confirm: z.literal(true),
});

export const reassignCompanyContact = createServerFn({ method: "POST" })
  .inputValidator((input) => reassignInput.parse(input))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const emailNorm = data.email.trim().toLowerCase();

    const { data: profile, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("id, auth_user_id, company_id, is_active, email, full_name")
      .eq("email", emailNorm)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!profile) throw new Error("profile_not_found");
    if (!profile.auth_user_id) throw new Error("profile_not_active");

    const { data: targetCompany, error: cErr } = await supabaseAdmin
      .from("companies")
      .select("id, trade_name")
      .eq("id", data.target_company_id)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!targetCompany) throw new Error("target_company_not_found");

    const previousCompanyId = profile.company_id;
    if (previousCompanyId === data.target_company_id) {
      throw new Error("already_in_target_company");
    }

    const { error: uErr } = await supabaseAdmin
      .from("profiles")
      .update({ company_id: data.target_company_id })
      .eq("id", profile.id);
    if (uErr) throw new Error(uErr.message);

    // Defense in depth: the DB trigger `trg_profiles_company_change_recalc`
    // already recalculates scheduling_status for both companies and clears
    // stale `primary_profile_id` on the old pipeline row. We explicitly
    // re-run the recalc here so any caller-side cache/observer sees the
    // updated consolidated immediately, and surface failures to the admin
    // UI rather than swallowing them. The rule is single-sourced:
    // "the company considered everywhere is the profile's current company".
    try {
      const { data: events } = await supabaseAdmin
        .from("company_event_pipeline")
        .select("event_id, company_id")
        .in("company_id", [previousCompanyId, data.target_company_id].filter(Boolean) as string[]);
      for (const row of events ?? []) {
        await supabaseAdmin.rpc("pipeline_recalc_scheduling", {
          p_event_id: row.event_id,
          p_company_id: row.company_id,
        });
      }
    } catch (e) {
      console.warn("[reassignCompanyContact] recalc warning", (e as Error).message);
    }

    try {
      const actor = await getActorProfileId(context.userId);
      await supabaseAdmin.from("audit_logs").insert({
        actor_profile_id: actor,
        action: "company_contact_reassigned",
        payload: {
          profile_id: profile.id,
          auth_user_id: profile.auth_user_id,
          email: emailNorm,
          previous_company_id: previousCompanyId,
          new_company_id: data.target_company_id,
          reason: data.reason,
        },
      });
    } catch {
      /* best-effort audit */
    }

    return {
      profile_id: profile.id,
      previous_company_id: previousCompanyId,
      new_company_id: data.target_company_id,
    };
  });