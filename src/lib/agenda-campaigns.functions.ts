/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertAdminRole } from "@/lib/role-server";
import { processTransactionalSend } from "@/lib/email-send.server";
import { listEligibleRecipients } from "@/lib/agenda-campaigns.server";

const CategorySchema = z.enum(["visitor", "exhibitor"]);

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error("invalid_hex");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Bytes(input: Uint8Array): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest("SHA-256", input);
  return new Uint8Array(buf);
}

function randomToken(): Uint8Array {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return b;
}

async function resolveAdminProfileId(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

function getOrigin(): string {
  const req = getRequest();
  if (!req) return "https://rodada.promperu.tur.br";
  try {
    return new URL(req.url).origin;
  } catch {
    return "https://rodada.promperu.tur.br";
  }
}

/* -------------------------------------------------------------------------- */
/*  previewEligibleRecipients                                                 */
/* -------------------------------------------------------------------------- */

export const previewEligibleRecipients = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        eventId: z.string().uuid(),
        category: CategorySchema,
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdminRole(supabaseAdmin, context.userId);
    const list = await listEligibleRecipients({
      eventId: data.eventId,
      category: data.category,
      actingAdminUserId: context.userId,
    });
    return {
      total: list.length,
      sample: list.slice(0, 20),
    };
  });

/* -------------------------------------------------------------------------- */
/*  sendTestAgendaCampaign                                                    */
/* -------------------------------------------------------------------------- */

export const sendTestAgendaCampaign = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        eventId: z.string().uuid(),
        category: CategorySchema,
        subject: z.string().trim().min(1).max(300),
        body_md: z.string().max(20_000).default(""),
        buttonLabel: z.string().trim().min(1).max(80),
        testEmail: z.string().trim().toLowerCase().email(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdminRole(supabaseAdmin, context.userId);

    // Pick the first eligible profile of the category to derive the sample
    // agenda link — this validates end-to-end that a real user in this
    // category would receive something meaningful.
    const eligible = await listEligibleRecipients({
      eventId: data.eventId,
      category: data.category,
      actingAdminUserId: context.userId,
    });
    if (eligible.length === 0) {
      return { ok: false as const, error: "no_eligible_recipients" };
    }
    const sample = eligible[0];

    // One-shot test: not persisted as a campaign. Token is random but the
    // link is not registered anywhere — pure preview to the admin's test
    // address. The admin should still be able to click the download button
    // on a REAL campaign afterwards.
    const origin = getOrigin();
    const buttonUrl = `${origin}/agenda`;

    const idempotencyKey = `agenda-test-${context.userId}-${Date.now()}`;
    const res = await processTransactionalSend(supabaseAdmin, {
      templateName: "agenda-delivery",
      recipientEmail: data.testEmail,
      idempotencyKey,
      templateData: {
        visitorName: sample.fullName,
        eventName: "Rodada de Negócios PromPerú",
        bodyText: data.body_md,
        buttonLabel: data.buttonLabel,
        buttonUrl,
        overrideSubject: data.subject,
      },
    });
    return { ok: res.status >= 200 && res.status < 300, status: res.status, body: res.body };
  });

/* -------------------------------------------------------------------------- */
/*  createAndSendAgendaCampaign                                               */
/* -------------------------------------------------------------------------- */

export const createAndSendAgendaCampaign = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        eventId: z.string().uuid(),
        category: CategorySchema,
        subject: z.string().trim().min(1).max(300),
        body_md: z.string().max(20_000).default(""),
        buttonLabel: z.string().trim().min(1).max(80),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdminRole(supabaseAdmin, context.userId);
    const actorProfileId = await resolveAdminProfileId(context.userId);

    // 1. Create the campaign row (status = sending).
    const { data: campRow, error: campErr } = await supabaseAdmin
      .from("agenda_email_campaigns")
      .insert({
        event_id: data.eventId,
        category: data.category,
        subject: data.subject,
        body_md: data.body_md,
        button_label: data.buttonLabel,
        created_by: actorProfileId,
        status: "sending",
        totals: {},
      } as any)
      .select("id")
      .single();
    if (campErr || !campRow) throw new Error(campErr?.message ?? "Failed to create campaign");
    const campaignId = campRow.id as string;

    // 2. Resolve eligible.
    const eligible = await listEligibleRecipients({
      eventId: data.eventId,
      category: data.category,
      actingAdminUserId: context.userId,
    });
    const eligibleCount = eligible.length;

    // 3. Suppression check (bulk).
    const emails = Array.from(new Set(eligible.map((r) => r.email.toLowerCase())));
    const suppressedSet = new Set<string>();
    if (emails.length > 0) {
      const { data: sup } = await supabaseAdmin
        .from("suppressed_emails")
        .select("email")
        .in("email", emails);
      for (const s of (sup ?? []) as Array<{ email: string }>) {
        suppressedSet.add(s.email.toLowerCase());
      }
    }

    const origin = getOrigin();
    let sentCount = 0;
    let failedCount = 0;
    let suppressedCount = 0;

    for (const rec of eligible) {
      const normalizedEmail = rec.email.toLowerCase();
      // Suppressed → log row and skip send.
      if (suppressedSet.has(normalizedEmail)) {
        await supabaseAdmin.from("agenda_email_campaign_recipients").insert({
          campaign_id: campaignId,
          event_id: data.eventId,
          profile_id: rec.profileId,
          role_category: rec.role,
          recipient_email: rec.email,
          subject_snapshot: data.subject,
          body_snapshot: data.body_md,
          button_label_snapshot: data.buttonLabel,
          // No usable token for a suppressed recipient — store a random
          // per-row byte string so the unique index stays satisfied but
          // the token can never authenticate a click (would 404).
          token_hash: Buffer.from(await sha256Bytes(randomToken())),
          send_status: "suppressed",
        } as any);
        suppressedCount++;
        continue;
      }

      // 4. Token + row insert.
      const token = randomToken();
      const tokenHex = toHex(token);
      const tokenHash = await sha256Bytes(token);
      const idempotencyKey = `campaign-${campaignId}-${rec.profileId}`;

      const { data: insertedRec, error: recErr } = await supabaseAdmin
        .from("agenda_email_campaign_recipients")
        .insert({
          campaign_id: campaignId,
          event_id: data.eventId,
          profile_id: rec.profileId,
          role_category: rec.role,
          recipient_email: rec.email,
          subject_snapshot: data.subject,
          body_snapshot: data.body_md,
          button_label_snapshot: data.buttonLabel,
          token_hash: Buffer.from(tokenHash),
          send_status: "pending",
          metadata: { idempotency_key: idempotencyKey },
        } as any)
        .select("id")
        .single();
      if (recErr || !insertedRec) {
        failedCount++;
        continue;
      }
      const recipientId = insertedRec.id as string;

      const buttonUrl = `${origin}/api/public/agenda-download/${campaignId}/${tokenHex}`;

      // 5. Send via transactional pipeline.
      const res = await processTransactionalSend(supabaseAdmin, {
        templateName: "agenda-delivery",
        recipientEmail: rec.email,
        idempotencyKey,
        templateData: {
          visitorName: rec.fullName,
          eventName: "Rodada de Negócios PromPerú",
          bodyText: data.body_md,
          buttonLabel: data.buttonLabel,
          buttonUrl,
          overrideSubject: data.subject,
        },
      });

      if (res.status >= 200 && res.status < 300 && (res.body as any)?.success !== false) {
        sentCount++;
        await supabaseAdmin
          .from("agenda_email_campaign_recipients")
          .update({
            send_status: "sent",
            sent_at: new Date().toISOString(),
          } as any)
          .eq("id", recipientId);
      } else if ((res.body as any)?.reason === "email_suppressed") {
        suppressedCount++;
        await supabaseAdmin
          .from("agenda_email_campaign_recipients")
          .update({ send_status: "suppressed" } as any)
          .eq("id", recipientId);
      } else {
        failedCount++;
        await supabaseAdmin
          .from("agenda_email_campaign_recipients")
          .update({
            send_status: "failed",
            error_message: String(
              (res.body as any)?.error ??
                (res.body as any)?.details ??
                `send_failed_${res.status}`,
            ).slice(0, 500),
          } as any)
          .eq("id", recipientId);
      }
    }

    // 6. Consolidate totals + finalize status.
    const totals = {
      eligible: eligibleCount,
      sent: sentCount,
      failed: failedCount,
      suppressed: suppressedCount,
    };
    const finalStatus: "sent" | "failed" =
      sentCount === 0 && eligibleCount > 0 && suppressedCount < eligibleCount
        ? "failed"
        : "sent";
    await supabaseAdmin
      .from("agenda_email_campaigns")
      .update({ status: finalStatus, totals } as any)
      .eq("id", campaignId);

    return { ok: true as const, campaignId, totals, status: finalStatus };
  });

/* -------------------------------------------------------------------------- */
/*  listAgendaCampaigns                                                       */
/* -------------------------------------------------------------------------- */

export const listAgendaCampaigns = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        eventId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(200).default(50),
      })
      .parse(input ?? {}),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdminRole(supabaseAdmin, context.userId);
    let q = supabaseAdmin
      .from("agenda_email_campaigns")
      .select(
        "id, event_id, category, subject, button_label, status, totals, created_at, updated_at, created_by",
      )
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.eventId) q = q.eq("event_id", data.eventId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    // Fresh KPIs from recipients (in case totals is stale for in-flight campaigns).
    const ids = (rows ?? []).map((r: any) => r.id);
    const liveTotals: Record<
      string,
      { eligible: number; sent: number; failed: number; suppressed: number; clicked: number; downloaded: number }
    > = {};
    if (ids.length > 0) {
      const { data: recs } = await supabaseAdmin
        .from("agenda_email_campaign_recipients")
        .select("campaign_id, send_status, clicked_at, downloaded_at")
        .in("campaign_id", ids);
      for (const r of (recs ?? []) as Array<{
        campaign_id: string;
        send_status: string;
        clicked_at: string | null;
        downloaded_at: string | null;
      }>) {
        const t =
          liveTotals[r.campaign_id] ??
          (liveTotals[r.campaign_id] = {
            eligible: 0,
            sent: 0,
            failed: 0,
            suppressed: 0,
            clicked: 0,
            downloaded: 0,
          });
        t.eligible++;
        if (r.send_status === "sent") t.sent++;
        else if (r.send_status === "failed") t.failed++;
        else if (r.send_status === "suppressed") t.suppressed++;
        if (r.clicked_at) t.clicked++;
        if (r.downloaded_at) t.downloaded++;
      }
    }

    return { rows: rows ?? [], liveTotals };
  });

/* -------------------------------------------------------------------------- */
/*  getCampaignRecipients                                                     */
/* -------------------------------------------------------------------------- */

export const getCampaignRecipients = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        campaignId: z.string().uuid(),
        filters: z
          .object({
            send_status: z
              .enum(["pending", "sent", "suppressed", "failed"])
              .optional(),
            clicked: z.boolean().optional(),
            downloaded: z.boolean().optional(),
            email: z.string().trim().max(200).optional(),
          })
          .partial()
          .optional(),
        limit: z.number().int().min(1).max(1000).default(500),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdminRole(supabaseAdmin, context.userId);
    let q = supabaseAdmin
      .from("agenda_email_campaign_recipients")
      .select(
        "id, campaign_id, profile_id, role_category, recipient_email, send_status, error_message, sent_at, clicked_at, click_count, downloaded_at, download_count, created_at",
      )
      .eq("campaign_id", data.campaignId)
      .order("created_at", { ascending: false })
      .limit(data.limit);

    const f = data.filters ?? {};
    if (f.send_status) q = q.eq("send_status", f.send_status);
    if (f.clicked === true) q = q.not("clicked_at", "is", null);
    if (f.clicked === false) q = q.is("clicked_at", null);
    if (f.downloaded === true) q = q.not("downloaded_at", "is", null);
    if (f.downloaded === false) q = q.is("downloaded_at", null);
    if (f.email) q = q.ilike("recipient_email", `%${f.email}%`);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [] };
  });

// Exported helpers for reuse (public download route hashes tokens too).
export const _agendaCampaignInternals = { hexToBytes, sha256Bytes };