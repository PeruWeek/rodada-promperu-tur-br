/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Server-only helpers for meeting cancellation.
 *
 * `performMeetingCancellation` extracts the canonical mutation core of the
 * visitor `cancelMeeting` flow so both the visitor path and the admin paths
 * behave identically:
 * - blindaged UPDATE: only cancels rows still `status='scheduled'`
 * - never touches `profiles.is_active`, `user_roles`, `visitor_profiles`,
 *   `exhibitor_profiles`, or any registration/role state
 * - side effects (exhibitor lookup, in-app notification, transactional email)
 *   are non-blocking: they log on failure but never invalidate a successful
 *   database cancellation
 *
 * Callers that already gate on the acting profile (visitor `cancelMeeting`)
 * pass `visitorScope` to scope the UPDATE by `visitor_profile_id`. Admin
 * callers omit it (authorization is enforced upstream via `assertAdminRole`).
 */
import { getRequest } from "@tanstack/react-start/server";

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type CancellingProfile = {
  id: string;
  full_name: string;
  email: string | null;
  preferred_language: string | null;
};

export type PerformCancellationOk = {
  ok: true;
  meetingId: string;
  tableId: string;
  slotId: string;
  eventId: string;
  visitorProfileId: string;
  exhibitorProfileId: string | null;
  emailFailed: boolean;
};

export type PerformCancellationErr = {
  ok: false;
  reason: "not_scheduled" | "db_error";
  detail?: string;
};

export type PerformCancellationResult = PerformCancellationOk | PerformCancellationErr;

export async function sendMeetingEmail(params: {
  templateName: "meeting-confirmation" | "meeting-cancelled";
  recipientEmail: string;
  idempotencyKey: string;
  templateData: Record<string, unknown>;
}) {
  const request = getRequest();
  const authHeader = request?.headers.get("authorization");
  if (!authHeader || !request) return;
  const origin = new URL(request.url).origin;
  const res = await fetch(`${origin}/lovable/email/transactional/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`email send failed ${res.status}: ${body.slice(0, 200)}`);
  }
}

export async function performMeetingCancellation(input: {
  meetingId: string;
  reason?: string | null;
  cancellingProfile: CancellingProfile;
  visitorScope?: string;
}): Promise<PerformCancellationResult> {
  const { meetingId, reason, cancellingProfile, visitorScope } = input;

  // 1. Blindaged UPDATE — only decision point for cancellation success.
  let q = supabaseAdmin
    .from("meetings")
    .update({ status: "cancelled", cancel_reason: reason ?? null })
    .eq("id", meetingId)
    .eq("status", "scheduled");
  if (visitorScope) q = q.eq("visitor_profile_id", visitorScope);
  const { data: updated, error: updErr } = await q
    .select("id, table_id, slot_id, event_id, visitor_profile_id")
    .maybeSingle();

  if (updErr) {
    return { ok: false, reason: "db_error", detail: updErr.message };
  }
  if (!updated) {
    return { ok: false, reason: "not_scheduled" };
  }

  // From here on, cancellation is committed. All side effects are best-effort.
  let tableRow: {
    table_number: number | null;
    exhibitor_profile_id: string | null;
  } | null = null;
  let slot: { start_at: string; end_at: string } | null = null;
  let exhibitorCompany = "—";

  try {
    const { data } = await supabaseAdmin
      .from("event_tables")
      .select("table_number, exhibitor_profile_id")
      .eq("id", updated.table_id)
      .maybeSingle();
    tableRow = data ?? null;
  } catch (e) {
    console.warn("[cancel] event_tables lookup failed", { meetingId, e });
  }

  try {
    const { data } = await supabaseAdmin
      .from("time_slots")
      .select("start_at, end_at")
      .eq("id", updated.slot_id)
      .maybeSingle();
    slot = data ?? null;
  } catch (e) {
    console.warn("[cancel] time_slots lookup failed", { meetingId, e });
  }

  if (tableRow?.exhibitor_profile_id) {
    try {
      const { data: exhibProfile } = await supabaseAdmin
        .from("profiles")
        .select("company_id, companies(trade_name)")
        .eq("id", tableRow.exhibitor_profile_id)
        .maybeSingle();
      exhibitorCompany =
        (exhibProfile as any)?.companies?.trade_name ?? exhibitorCompany;
    } catch (e) {
      console.warn("[cancel] exhibitor company lookup failed", { meetingId, e });
    }

    try {
      await supabaseAdmin.from("notifications").insert({
        event_id: updated.event_id,
        recipient_profile_id: tableRow.exhibitor_profile_id,
        type: "meeting_cancelled",
        channel: "in_app",
        status: "sent",
        title: "Reunião cancelada",
        body: `${cancellingProfile.full_name} cancelou uma reunião.`,
        data: {
          meeting_id: updated.id,
          slot_start: slot?.start_at,
          table_number: tableRow.table_number,
        },
      });
    } catch (e) {
      console.warn("[cancel] notification insert failed", { meetingId, e });
    }
  }

  let emailFailed = false;
  if (cancellingProfile.email && slot?.start_at && slot?.end_at) {
    try {
      await sendMeetingEmail({
        templateName: "meeting-cancelled",
        recipientEmail: cancellingProfile.email,
        idempotencyKey: `meeting-cancel-${updated.id}`,
        templateData: {
          language: cancellingProfile.preferred_language ?? "pt-BR",
          visitorName: cancellingProfile.full_name,
          exhibitorCompany,
          tableNumber: tableRow?.table_number ?? "—",
          slotStart: slot.start_at,
          slotEnd: slot.end_at,
          exploreUrl: "https://rodada.promperu.tur.br/explore",
        },
      });
    } catch (e) {
      emailFailed = true;
      console.error("[cancel] email failed", { meetingId, e });
    }
  }

  return {
    ok: true,
    meetingId: updated.id,
    tableId: updated.table_id,
    slotId: updated.slot_id,
    eventId: updated.event_id,
    visitorProfileId: updated.visitor_profile_id,
    exhibitorProfileId: tableRow?.exhibitor_profile_id ?? null,
    emailFailed,
  };
}