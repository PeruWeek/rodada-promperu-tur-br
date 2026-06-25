import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
      const patch: Record<string, unknown> = {};
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
      const insertRow: Record<string, unknown> = {
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
          signupUrl: "https://rodada.promperu.tur.br/signup",
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
      // Match by digits-only tax_id (ignores formatting).
      const { data: rows, error } = await supabaseAdmin
        .from("companies")
        .select(select)
        .filter("tax_id", "ilike", `%${digits}%`)
        .limit(limit);
      if (error) throw new Error(error.message);
      const filtered = (rows ?? []).filter(
        (r) => (r.tax_id ?? "").replace(/\D+/g, "").includes(digits),
      );
      if (filtered.length > 0) return { rows: filtered };
    }

    const term = `%${data.query.trim()}%`;
    const { data: rows, error } = await supabaseAdmin
      .from("companies")
      .select(select)
      .or(`trade_name.ilike.${term},legal_name.ilike.${term}`)
      .limit(limit);
    if (error) throw new Error(error.message);
    return { rows: rows ?? [] };
  });