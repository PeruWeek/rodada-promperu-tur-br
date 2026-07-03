import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertNotCliente } from "@/lib/role-server";

async function sendMeetingEmail(params: {
  templateName: "meeting-confirmation" | "meeting-cancelled";
  recipientEmail: string;
  idempotencyKey: string;
  templateData: Record<string, unknown>;
}) {
  try {
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
      console.warn("[email] send failed", res.status, body.slice(0, 200));
    }
  } catch (err) {
    console.warn("[email] send threw", err);
  }
}

// Book a meeting: insert into meetings (as authenticated user, RLS applies),
// then notify exhibitor via admin client.
export const bookMeeting = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        slotId: z.string().uuid(),
        tableId: z.string().uuid(),
        eventId: z.string().uuid(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertNotCliente(supabaseAdmin, userId);

    // Email column is restricted via column-level grants; use admin client for own profile read.
    const { data: profile, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, company_id, email, preferred_language")
      .eq("auth_user_id", userId)
      .maybeSingle();
    if (profErr) throw profErr;
    if (!profile) throw new Error("Profile not found");

    // Cross-table conflict guard: visitor cannot have two scheduled meetings
    // at the same start time, regardless of which table.
    const { data: newSlot, error: nsErr } = await supabaseAdmin
      .from("time_slots")
      .select("start_at, end_at")
      .eq("id", data.slotId)
      .maybeSingle();
    if (nsErr) throw new Error(nsErr.message);
    if (!newSlot) throw new Error("Slot not found");

    const { data: existingMeetings } = await supabaseAdmin
      .from("meetings")
      .select("id, slot_id, time_slots!inner(start_at)")
      .eq("visitor_profile_id", profile.id)
      .eq("status", "scheduled");
    const hasConflict = (existingMeetings ?? []).some(
      (m: any) => m.time_slots?.start_at === newSlot.start_at,
    );
    if (hasConflict) {
      throw new Error("Conflito: você já tem reunião agendada neste horário.");
    }

    // Same-exhibitor guard: a visitor can have at most ONE scheduled meeting
    // per table (one meeting per exhibitor). The DB also enforces this via
    // a unique partial index (uq_meetings_visitor_table_scheduled), so this
    // check is the friendly error path; the index is the hard guarantee.
    const { data: sameTable } = await supabaseAdmin
      .from("meetings")
      .select("id")
      .eq("visitor_profile_id", profile.id)
      .eq("table_id", data.tableId)
      .eq("status", "scheduled")
      .maybeSingle();
    if (sameTable) {
      throw new Error(
        "Você já tem uma reunião agendada com este expositor. Cada participante pode ter no máximo 1 reunião por mesa.",
      );
    }

    // Slot-mesa guard: regra de negócio é "1 slot = 1 EMPRESA", não
    // "1 slot = 1 reunião". Múltiplas pessoas da mesma empresa podem
    // dividir o mesmo (table_id, slot_id). Bloqueia apenas se já houver
    // reunião de outra empresa. Enforço duro no banco pelo trigger
    // `trg_meetings_no_conflict` (advisory lock + comparação de empresa).
    const { data: slotTaken } = await supabaseAdmin
      .from("meetings")
      .select("id, visitor:profiles!visitor_profile_id(company_id)")
      .eq("table_id", data.tableId)
      .eq("slot_id", data.slotId)
      .eq("status", "scheduled");
    const otherCompanyOnSlot = (slotTaken ?? []).some(
      (m: any) =>
        m.visitor?.company_id &&
        m.visitor.company_id !== profile.company_id,
    );
    if (otherCompanyOnSlot) {
      throw new Error(
        "Este horário já está ocupado por outra empresa nesta mesa. Escolha outro slot.",
      );
    }

    // Company-slot guard: same visitor company cannot occupy the same
    // (start_at, end_at) window in the same event across different tables.
    // The DB trigger `trg_meetings_one_company_per_slot` enforces the hard
    // guarantee; this is the friendly error path.
    if (profile.company_id) {
      const { data: companyClash } = await supabaseAdmin
        .from("meetings")
        .select(
          "id, visitor:profiles!visitor_profile_id(company_id), time_slots!inner(start_at, end_at)",
        )
        .eq("event_id", data.eventId)
        .eq("status", "scheduled")
        .eq("time_slots.start_at", newSlot.start_at)
        .eq("time_slots.end_at", newSlot.end_at);
      const clash = (companyClash ?? []).some(
        (m: any) => m.visitor?.company_id === profile.company_id,
      );
      if (clash) {
        throw new Error(
          "Esta empresa já possui uma reunião agendada neste horário.",
        );
      }
    }

    const { data: meeting, error: mErr } = await supabase
      .from("meetings")
      .insert({
        event_id: data.eventId,
        table_id: data.tableId,
        slot_id: data.slotId,
        visitor_profile_id: profile.id,
        status: "scheduled",
      })
      .select("id")
      .single();
    if (mErr) throw new Error(mErr.message);

    // Notify exhibitor (admin client, bypasses RLS)
    const { data: tableRow } = await supabaseAdmin
      .from("event_tables")
      .select("table_number, exhibitor_profile_id")
      .eq("id", data.tableId)
      .maybeSingle();

    const { data: slot } = await supabaseAdmin
      .from("time_slots")
      .select("start_at, end_at")
      .eq("id", data.slotId)
      .maybeSingle();

    const { data: company } = profile.company_id
      ? await supabaseAdmin
          .from("companies")
          .select("trade_name")
          .eq("id", profile.company_id)
          .maybeSingle()
      : { data: null };

    let exhibitorCompany = "—";
    if (tableRow?.exhibitor_profile_id) {
      const { data: exhibProfile } = await supabaseAdmin
        .from("profiles")
        .select("company_id, companies(trade_name)")
        .eq("id", tableRow.exhibitor_profile_id)
        .maybeSingle();
      exhibitorCompany =
        (exhibProfile as any)?.companies?.trade_name ?? exhibitorCompany;
    }

    if (tableRow?.exhibitor_profile_id) {
      await supabaseAdmin.from("notifications").insert({
        event_id: data.eventId,
        recipient_profile_id: tableRow.exhibitor_profile_id,
        type: "meeting_created",
        channel: "in_app",
        status: "sent",
        title: "Nova reunião agendada",
        body: `${company?.trade_name ?? profile.full_name} agendou uma reunião com você.`,
        data: {
          meeting_id: meeting.id,
          slot_start: slot?.start_at,
          table_number: tableRow.table_number,
          visitor_name: profile.full_name,
        },
      });
    }

    if (profile.email && slot?.start_at && slot?.end_at) {
      await sendMeetingEmail({
        templateName: "meeting-confirmation",
        recipientEmail: profile.email,
        idempotencyKey: `meeting-confirm-${meeting.id}`,
        templateData: {
          language: profile.preferred_language ?? "pt-BR",
          visitorName: profile.full_name,
          exhibitorCompany,
          tableNumber: tableRow?.table_number ?? "—",
          slotStart: slot.start_at,
          slotEnd: slot.end_at,
          agendaUrl: "https://rodada.promperu.tur.br/agenda",
        },
      });
    }

    return { id: meeting.id };
  });

export const cancelMeeting = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ meetingId: z.string().uuid(), reason: z.string().max(500).optional() }).parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await assertNotCliente(supabaseAdmin, userId);

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, preferred_language")
      .eq("auth_user_id", userId)
      .maybeSingle();
    if (!profile) throw new Error("Profile not found");

    // Visitor UPDATE RLS policy removed for security; mutate via admin client after verifying ownership.
    const { data: updated, error: updErr } = await supabaseAdmin
      .from("meetings")
      .update({ status: "cancelled", cancel_reason: data.reason ?? null })
      .eq("id", data.meetingId)
      .eq("visitor_profile_id", profile.id)
      .select("id, table_id, slot_id, event_id")
      .single();
    if (updErr) throw new Error(updErr.message);

    const { data: tableRow } = await supabaseAdmin
      .from("event_tables")
      .select("table_number, exhibitor_profile_id")
      .eq("id", updated.table_id)
      .maybeSingle();
    const { data: slot } = await supabaseAdmin
      .from("time_slots")
      .select("start_at, end_at")
      .eq("id", updated.slot_id)
      .maybeSingle();

    let exhibitorCompany = "—";
    if (tableRow?.exhibitor_profile_id) {
      const { data: exhibProfile } = await supabaseAdmin
        .from("profiles")
        .select("company_id, companies(trade_name)")
        .eq("id", tableRow.exhibitor_profile_id)
        .maybeSingle();
      exhibitorCompany =
        (exhibProfile as any)?.companies?.trade_name ?? exhibitorCompany;
    }

    if (tableRow?.exhibitor_profile_id) {
      await supabaseAdmin.from("notifications").insert({
        event_id: updated.event_id,
        recipient_profile_id: tableRow.exhibitor_profile_id,
        type: "meeting_cancelled",
        channel: "in_app",
        status: "sent",
        title: "Reunião cancelada",
        body: `${profile.full_name} cancelou uma reunião.`,
        data: {
          meeting_id: updated.id,
          slot_start: slot?.start_at,
          table_number: tableRow.table_number,
        },
      });
    }

    if (profile.email && slot?.start_at && slot?.end_at) {
      await sendMeetingEmail({
        templateName: "meeting-cancelled",
        recipientEmail: profile.email,
        idempotencyKey: `meeting-cancel-${updated.id}`,
        templateData: {
          language: profile.preferred_language ?? "pt-BR",
          visitorName: profile.full_name,
          exhibitorCompany,
          tableNumber: tableRow?.table_number ?? "—",
          slotStart: slot.start_at,
          slotEnd: slot.end_at,
          exploreUrl: "https://rodada.promperu.tur.br/explore",
        },
      });
    }

    return { ok: true };
  });