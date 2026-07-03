import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertNotCliente } from "@/lib/role-server";
import {
  assertCanBook,
  buildCompanyBusyStartTables,
  classifySlotForVisitor,
  indexMeetingsByPair,
  type MeetingLite,
  SchedulingError,
} from "@/lib/scheduling-rules";

/**
 * Slots do BookingDialog do visitante — classificados por relação com a
 * empresa do visitante. Fonte da verdade para a regra "1 slot = 1 empresa":
 * slots ocupados pela MESMA empresa são selecionáveis; outra empresa é
 * bloqueio duro (o próprio slot já foi tomado por concorrente).
 */
export type VisitorBookingSlot = {
  id: string;
  start_at: string;
  end_at: string;
  /**
   * - free: nada agendado
   * - mine: reunião do próprio usuário
   * - same_company: outra pessoa da mesma empresa já agendou aqui — usuário pode entrar
   * - other_company: outra empresa segurou o slot — bloqueado
   */
  status: "free" | "mine" | "same_company" | "other_company";
};

export type VisitorBookingSlotsResult = {
  table: { id: string; event_id: string; table_number: number } | null;
  slots: VisitorBookingSlot[];
  /** slots (start_at) em que o usuário já tem reunião em outra mesa — conflito de horário */
  visitor_busy_starts: string[];
};

export const listVisitorBookingSlots = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ exhibitorProfileId: z.string().uuid() }).parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<VisitorBookingSlotsResult> => {
    const { userId } = context;

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, company_id")
      .eq("auth_user_id", userId)
      .maybeSingle();
    if (!profile) return { table: null, slots: [], visitor_busy_starts: [] };

    const { data: table } = await supabaseAdmin
      .from("event_tables")
      .select("id, event_id, table_number")
      .eq("exhibitor_profile_id", data.exhibitorProfileId)
      .maybeSingle();
    if (!table) return { table: null, slots: [], visitor_busy_starts: [] };

    const [{ data: slots }, { data: meetingsOnTable }, { data: myMeetings }] =
      await Promise.all([
        supabaseAdmin
          .from("time_slots")
          .select("id, start_at, end_at")
          .eq("table_id", table.id)
          .eq("is_active", true)
          .order("start_at"),
        supabaseAdmin
          .from("meetings")
          .select("slot_id, table_id, time_slots!inner(start_at,end_at), visitor_profile_id, visitor:profiles!visitor_profile_id(company_id)")
          .eq("table_id", table.id)
          .eq("status", "scheduled"),
        supabaseAdmin
          .from("meetings")
          .select("slot_id, table_id, time_slots!inner(start_at)")
          .eq("visitor_profile_id", profile.id)
          .eq("status", "scheduled"),
      ]);

    // Normaliza para MeetingLite (fonte canônica em scheduling-rules).
    const pairMeetings: MeetingLite[] = ((meetingsOnTable ?? []) as any[])
      .map((m) => ({
        table_id: m.table_id ?? table.id,
        slot_id: m.slot_id,
        visitor_profile_id: m.visitor_profile_id,
        visitor_company_id: m.visitor?.company_id ?? null,
        start_at: m.time_slots?.start_at ?? "",
        end_at: m.time_slots?.end_at ?? "",
      }));
    const byPair = indexMeetingsByPair(pairMeetings);

    // Horários (start_at) em que o visitante já tem reunião em OUTRAS mesas.
    const visitorBusyStarts = new Set<string>();
    const visitorTables = new Set<string>();
    for (const m of (myMeetings ?? []) as any[]) {
      const s = m.time_slots?.start_at as string | undefined;
      if (m.table_id && m.table_id !== table.id) {
        if (s) visitorBusyStarts.add(s);
      }
      if (m.table_id) visitorTables.add(m.table_id);
    }
    // Nota: para o BookingDialog, `visitorTables` inclui esta mesa se ele já
    // tiver meeting aqui — mas nesse caso o slot correspondente cai em "mine"
    // via `selfHere` antes da checagem de `visitorTables`.

    const classified: VisitorBookingSlot[] = (slots ?? []).map((s) => {
      const slotLite = {
        id: s.id,
        table_id: table.id,
        start_at: s.start_at,
        end_at: s.end_at,
      };
      const status = classifySlotForVisitor({
        slot: slotLite,
        meetingsOnPair: byPair.get(`${table.id}::${s.id}`) ?? [],
        visitorProfileId: profile.id,
        visitorCompanyId: profile.company_id,
        visitorBusyStarts,
        visitorTables,
        // Rule 5 not enforced in the same-table BookingDialog view — the
        // dialog only shows slots on ONE table, so cross-table company
        // conflict is caught at booking time by `assertCanBook`.
      });
      return { id: s.id, start_at: s.start_at, end_at: s.end_at, status };
    });

    return {
      table: { id: table.id, event_id: table.event_id, table_number: table.table_number },
      slots: classified,
      visitor_busy_starts: [...visitorBusyStarts],
    };
  });

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

    // Guardas canônicas — delegadas a scheduling-rules.assertCanBook.
    // Concorrência real ainda é coberta pelos triggers no banco
    // (trg_meetings_no_conflict, trg_meetings_one_company_per_slot,
    // uq_meetings_visitor_table_scheduled).
    const { data: newSlot, error: nsErr } = await supabaseAdmin
      .from("time_slots")
      .select("start_at, end_at")
      .eq("id", data.slotId)
      .maybeSingle();
    if (nsErr) throw new Error(nsErr.message);
    if (!newSlot) throw new Error("Slot not found");

    const [{ data: myMtgs }, { data: pairMtgs }, { data: startMtgs }] =
      await Promise.all([
        supabaseAdmin
          .from("meetings")
          .select("id, table_id, slot_id, visitor_profile_id, time_slots!inner(start_at,end_at)")
          .eq("visitor_profile_id", profile.id)
          .eq("status", "scheduled"),
        supabaseAdmin
          .from("meetings")
          .select("id, table_id, slot_id, visitor_profile_id, visitor:profiles!visitor_profile_id(company_id), time_slots!inner(start_at,end_at)")
          .eq("table_id", data.tableId)
          .eq("slot_id", data.slotId)
          .eq("status", "scheduled"),
        profile.company_id
          ? supabaseAdmin
              .from("meetings")
              .select("id, table_id, slot_id, visitor_profile_id, visitor:profiles!visitor_profile_id(company_id), time_slots!inner(start_at,end_at)")
              .eq("event_id", data.eventId)
              .eq("status", "scheduled")
              .eq("time_slots.start_at", newSlot.start_at)
              .eq("time_slots.end_at", newSlot.end_at)
          : Promise.resolve({ data: [] as any[] }),
      ]);

    const toLite = (m: any): MeetingLite => ({
      id: m.id,
      table_id: m.table_id,
      slot_id: m.slot_id,
      visitor_profile_id: m.visitor_profile_id,
      visitor_company_id: m.visitor?.company_id ?? null,
      start_at: m.time_slots?.start_at ?? "",
      end_at: m.time_slots?.end_at ?? "",
    });

    try {
      assertCanBook({
        visitor: { id: profile.id, company_id: profile.company_id },
        slot: {
          id: data.slotId,
          table_id: data.tableId,
          start_at: newSlot.start_at,
          end_at: newSlot.end_at,
        },
        visitorScheduledMeetings: ((myMtgs ?? []) as any[]).map(toLite),
        meetingsOnPair: ((pairMtgs ?? []) as any[]).map(toLite),
        sameEventMeetingsAtStart: ((startMtgs ?? []) as any[]).map(toLite),
      });
    } catch (e) {
      if (e instanceof SchedulingError) throw new Error(e.friendlyMessage);
      throw e;
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