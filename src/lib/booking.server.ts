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

/**
 * Origem canônica de todo cancelamento que passa pelo helper. Triggers /
 * migrations que setam `status='cancelled'` direto no banco NÃO passam por
 * aqui — mas `system_dedupe` / `system_sanitize` ficam reservados para o dia
 * em que passarem.
 */
export type CancellationOrigin =
  | "visitor_self"
  | "admin_manual"
  | "admin_cancel_all_future"
  | "admin_deactivation"
  | "system_dedupe"
  | "system_sanitize"
  | "system_other";

export type CancellationActorType = "visitor" | "admin" | "system";

export const CANCELLATION_ORIGIN_LABELS: Record<CancellationOrigin, string> = {
  visitor_self: "Visitante",
  admin_manual: "Admin — manual",
  admin_cancel_all_future: "Admin — futuras",
  admin_deactivation: "Admin — inativação",
  system_dedupe: "Sistema — dedupe",
  system_sanitize: "Sistema — sanitize",
  system_other: "Sistema — outro",
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
  origin: CancellationOrigin;
  actorType: CancellationActorType;
  actorProfileId?: string | null;
}): Promise<PerformCancellationResult> {
  const { meetingId, reason, cancellingProfile, visitorScope, origin, actorType } = input;
  const actorProfileId = input.actorProfileId ?? cancellingProfile.id ?? null;

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

  const cancelledAt = new Date().toISOString();

  // From here on, cancellation is committed. All side effects are best-effort.
  let tableRow: {
    table_number: number | null;
    exhibitor_profile_id: string | null;
  } | null = null;
  let slot: { start_at: string; end_at: string } | null = null;
  let exhibitorCompany = "—";
  let exhibitorCompanyId: string | null = null;
  let visitorName: string | null = null;
  let visitorCompany: string | null = null;

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
      exhibitorCompanyId = (exhibProfile as any)?.company_id ?? null;
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
          origin,
          actor_type: actorType,
        },
      });
    } catch (e) {
      console.warn("[cancel] notification insert failed", { meetingId, e });
    }
  }

  // Lookup visitor name/company (for audit + admin ops alert body).
  try {
    const { data: vProf } = await supabaseAdmin
      .from("profiles")
      .select("full_name, companies(trade_name)")
      .eq("id", updated.visitor_profile_id)
      .maybeSingle();
    visitorName = (vProf as any)?.full_name ?? null;
    visitorCompany = (vProf as any)?.companies?.trade_name ?? null;
  } catch (e) {
    console.warn("[cancel] visitor profile lookup failed", { meetingId, e });
  }

  // === Audit log — canonical, single line per meeting cancellation ===
  try {
    await supabaseAdmin.from("audit_logs").insert({
      event_id: updated.event_id,
      actor_profile_id: actorType === "system" ? null : actorProfileId,
      action: "meeting.cancelled",
      payload: {
        meeting_id: updated.id,
        event_id: updated.event_id,
        table_id: updated.table_id,
        slot_id: updated.slot_id,
        visitor_profile_id: updated.visitor_profile_id,
        exhibitor_profile_id: tableRow?.exhibitor_profile_id ?? null,
        exhibitor_company_id: exhibitorCompanyId,
        exhibitor_company: exhibitorCompany,
        visitor_name: visitorName,
        visitor_company: visitorCompany,
        actor_type: actorType,
        actor_profile_id: actorProfileId,
        actor_name: cancellingProfile.full_name,
        origin,
        cancel_reason: reason ?? null,
        slot_start: slot?.start_at ?? null,
        slot_end: slot?.end_at ?? null,
        table_number: tableRow?.table_number ?? null,
        cancelled_at: cancelledAt,
      },
    });
  } catch (e) {
    console.warn("[cancel] audit_logs insert failed", { meetingId, e });
  }

  // === Admin ops fan-out — one in-app notification per admin ===
  try {
    const { data: adminRoles } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");
    const authIds = Array.from(
      new Set(
        (adminRoles ?? [])
          .map((r) => r.user_id)
          .filter((v): v is string => !!v),
      ),
    );
    if (authIds.length > 0) {
      const { data: adminProfiles } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .in("auth_user_id", authIds);
      const adminProfileIds = Array.from(
        new Set(
          (adminProfiles ?? [])
            .map((p) => p.id)
            .filter((v): v is string => !!v),
        ),
      );
      if (adminProfileIds.length > 0) {
        const originLabel = CANCELLATION_ORIGIN_LABELS[origin] ?? origin;
        const bodyLines = [
          `Cancelado por: ${cancellingProfile.full_name} (${actorType})`,
          `Visitante: ${visitorName ?? updated.visitor_profile_id}${visitorCompany ? ` — ${visitorCompany}` : ""}`,
          `Expositor: ${exhibitorCompany}${tableRow?.table_number != null ? ` — Mesa ${tableRow.table_number}` : ""}`,
          slot?.start_at ? `Horário: ${slot.start_at}` : null,
          `Motivo: ${reason ?? "—"}`,
        ].filter(Boolean);
        const rows = adminProfileIds.map((pid) => ({
          event_id: updated.event_id,
          recipient_profile_id: pid,
          type: "meeting_cancelled" as const,
          channel: "in_app" as const,
          status: "sent" as const,
          title: `Cancelamento — ${originLabel}`,
          body: bodyLines.join(" • "),
          data: {
            audience: "admin_ops",
            origin,
            actor_type: actorType,
            actor_profile_id: actorProfileId,
            actor_name: cancellingProfile.full_name,
            meeting_id: updated.id,
            visitor_profile_id: updated.visitor_profile_id,
            visitor_name: visitorName,
            visitor_company: visitorCompany,
            exhibitor_profile_id: tableRow?.exhibitor_profile_id ?? null,
            exhibitor_company: exhibitorCompany,
            table_id: updated.table_id,
            table_number: tableRow?.table_number ?? null,
            slot_id: updated.slot_id,
            slot_start: slot?.start_at ?? null,
            slot_end: slot?.end_at ?? null,
            cancel_reason: reason ?? null,
            cancelled_at: cancelledAt,
          },
        }));
        await supabaseAdmin.from("notifications").insert(rows);
      }
    }
  } catch (e) {
    console.warn("[cancel] admin ops fan-out failed", { meetingId, e });
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