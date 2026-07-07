import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertAdminRole, assertNotCliente } from "@/lib/role-server";
import { performMeetingCancellation, sendMeetingEmail } from "@/lib/booking.server";
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

    // NOTE: `meetings.visitor_profile_id` FK targets `visitor_profiles`, not
    // `profiles` — so a PostgREST embed `visitor:profiles!visitor_profile_id(...)`
    // fails with PGRST200 and silently drops meetings, making every slot look
    // "free" to the visitor. Fetch meetings without the embed, then hydrate
    // company_id via a second query on profiles.
    const [slotsRes, meetingsOnTableRes, myMeetingsRes] = await Promise.all([
      supabaseAdmin
        .from("time_slots")
        .select("id, start_at, end_at")
        .eq("table_id", table.id)
        .eq("is_active", true)
        .order("start_at"),
      supabaseAdmin
        .from("meetings")
        .select("slot_id, table_id, visitor_profile_id, time_slots!meetings_slot_id_fkey!inner(start_at,end_at)")
        .eq("table_id", table.id)
        .eq("status", "scheduled"),
      supabaseAdmin
        .from("meetings")
        .select("slot_id, table_id, time_slots!meetings_slot_id_fkey!inner(start_at)")
        .eq("visitor_profile_id", profile.id)
        .eq("status", "scheduled"),
    ]);
    if (slotsRes.error) throw slotsRes.error;
    if (meetingsOnTableRes.error) throw meetingsOnTableRes.error;
    if (myMeetingsRes.error) throw myMeetingsRes.error;
    const slots = slotsRes.data;
    const meetingsOnTable = meetingsOnTableRes.data ?? [];
    const myMeetings = myMeetingsRes.data ?? [];

    // Hydrate visitor_company_id via profiles (FK does not exist between
    // meetings.visitor_profile_id and profiles, so no embed possible).
    const visitorIds = Array.from(
      new Set(
        (meetingsOnTable as any[])
          .map((m) => m.visitor_profile_id)
          .filter((v): v is string => !!v),
      ),
    );
    const companyByProfile = new Map<string, string | null>();
    if (visitorIds.length > 0) {
      const { data: profRows, error: profErr } = await supabaseAdmin
        .from("profiles")
        .select("id, company_id")
        .in("id", visitorIds);
      if (profErr) throw profErr;
      for (const p of (profRows ?? []) as any[]) {
        companyByProfile.set(p.id, p.company_id ?? null);
      }
    }

    // Normaliza para MeetingLite (fonte canônica em scheduling-rules).
    const pairMeetings: MeetingLite[] = (meetingsOnTable as any[])
      .map((m) => ({
        table_id: m.table_id ?? table.id,
        slot_id: m.slot_id,
        visitor_profile_id: m.visitor_profile_id,
        visitor_company_id: companyByProfile.get(m.visitor_profile_id) ?? null,
        start_at: m.time_slots?.start_at ?? "",
        end_at: m.time_slots?.end_at ?? "",
      }));
    const byPair = indexMeetingsByPair(pairMeetings);

    // Horários (start_at) em que o visitante já tem reunião em OUTRAS mesas.
    const visitorBusyStarts = new Set<string>();
    const visitorTables = new Set<string>();
    for (const m of myMeetings as any[]) {
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

// `sendMeetingEmail` and `performMeetingCancellation` live in booking.server.ts
// so the visitor cancel flow and the admin cancel flows share the exact same
// mutation core (blindaged UPDATE + best-effort side effects).
async function safeSendMeetingEmail(
  params: Parameters<typeof sendMeetingEmail>[0],
) {
  try {
    await sendMeetingEmail(params);
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

    // 2-step para evitar filtro/ordenação ambígua em `meetings -> time_slots`
    // (a tabela tem 2 FKs: slot_id e original_slot_id, e PostgREST não aceita
    // path `time_slots!fk.coluna` em .eq/.gte/.order → erro
    // "column meetings.time_slots does not exist").
    // Same FK caveat as listVisitorBookingSlots: no `profiles` embed possible
    // on meetings.visitor_profile_id — hydrate company_id via a second query.
    const [myMtgsRes, pairMtgsRes, sameEventMtgsRes] = await Promise.all([
      supabaseAdmin
        .from("meetings")
        .select("id, table_id, slot_id, visitor_profile_id")
        .eq("visitor_profile_id", profile.id)
        .eq("status", "scheduled"),
      supabaseAdmin
        .from("meetings")
        .select("id, table_id, slot_id, visitor_profile_id")
        .eq("table_id", data.tableId)
        .eq("slot_id", data.slotId)
        .eq("status", "scheduled"),
      profile.company_id
        ? supabaseAdmin
            .from("meetings")
            .select("id, table_id, slot_id, visitor_profile_id")
            .eq("event_id", data.eventId)
            .eq("status", "scheduled")
        : Promise.resolve({ data: [] as any[], error: null as any }),
    ]);
    if ((myMtgsRes as any).error) throw (myMtgsRes as any).error;
    if ((pairMtgsRes as any).error) throw (pairMtgsRes as any).error;
    if ((sameEventMtgsRes as any).error) throw (sameEventMtgsRes as any).error;
    const myMtgsRaw = (myMtgsRes as any).data ?? [];
    const pairMtgsRaw = (pairMtgsRes as any).data ?? [];
    const sameEventMtgsRaw = (sameEventMtgsRes as any).data ?? [];

    // Hydrate visitor_company_id for rule 1 / rule 5.
    const visitorIdsForCompany = Array.from(
      new Set(
        [
          ...((pairMtgsRaw ?? []) as any[]),
          ...((sameEventMtgsRaw ?? []) as any[]),
        ]
          .map((m) => m.visitor_profile_id)
          .filter((v): v is string => !!v),
      ),
    );
    const companyByProfile = new Map<string, string | null>();
    if (visitorIdsForCompany.length > 0) {
      const { data: profRows, error: profRowsErr } = await supabaseAdmin
        .from("profiles")
        .select("id, company_id")
        .in("id", visitorIdsForCompany);
      if (profRowsErr) throw profRowsErr;
      for (const p of (profRows ?? []) as any[]) {
        companyByProfile.set(p.id, p.company_id ?? null);
      }
    }

    const allSlotIds = Array.from(
      new Set(
        [
          ...((myMtgsRaw ?? []) as any[]),
          ...((pairMtgsRaw ?? []) as any[]),
          ...((sameEventMtgsRaw ?? []) as any[]),
        ]
          .map((m) => m.slot_id)
          .filter((v): v is string => !!v),
      ),
    );
    const slotMap = new Map<string, { start_at: string; end_at: string }>();
    if (allSlotIds.length > 0) {
      const { data: slotsRows } = await supabaseAdmin
        .from("time_slots")
        .select("id, start_at, end_at")
        .in("id", allSlotIds);
      for (const s of (slotsRows ?? []) as any[]) {
        slotMap.set(s.id, { start_at: s.start_at, end_at: s.end_at });
      }
    }
    const withSlot = (m: any) => ({
      ...m,
      time_slots: slotMap.get(m.slot_id) ?? { start_at: "", end_at: "" },
      visitor: { company_id: companyByProfile.get(m.visitor_profile_id) ?? null },
    });
    const myMtgs = ((myMtgsRaw ?? []) as any[]).map(withSlot);
    const pairMtgs = ((pairMtgsRaw ?? []) as any[]).map(withSlot);
    // Filtro do sameEventMeetingsAtStart aplicado em JS (start_at + end_at do novo slot)
    const startMtgs = ((sameEventMtgsRaw ?? []) as any[])
      .map(withSlot)
      .filter(
        (m) =>
          m.time_slots.start_at === newSlot.start_at &&
          m.time_slots.end_at === newSlot.end_at,
      );

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
      await safeSendMeetingEmail({
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

    const res = await performMeetingCancellation({
      meetingId: data.meetingId,
      reason: data.reason,
      cancellingProfile: {
        id: profile.id,
        full_name: profile.full_name,
        email: profile.email,
        preferred_language: profile.preferred_language,
      },
      visitorScope: profile.id,
      origin: "visitor_self",
      actorType: "visitor",
    });
    if (!res.ok) {
      // Preserva o comportamento observável do endpoint antigo, que lançava
      // erro quando o UPDATE não afetava linha (reunião inexistente, já
      // cancelada ou de outro visitante).
      throw new Error(res.detail ?? "Meeting not cancellable");
    }
    return { ok: true };
  });

// ============================================================================
// Admin-only cancellation surface — used by the "Ver reuniões" / "Cancelar
// reuniões futuras" actions in registrants-tab. Does NOT touch
// profiles.is_active, user_roles, visitor_profiles, or exhibitor_profiles.
// ============================================================================

async function loadAdminProfileByAuthUserId(authUserId: string) {
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, email, preferred_language")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (!profile) throw new Error("Admin profile not found");
  return profile;
}

async function writeAdminCancelAuditLog(params: {
  actorProfileId: string;
  eventId: string;
  meetingId: string;
  visitorProfileId: string;
  tableId: string;
  slotId: string;
  reason: string | null | undefined;
  emailFailed: boolean;
}) {
  try {
    await supabaseAdmin.from("audit_logs").insert({
      event_id: params.eventId,
      actor_profile_id: params.actorProfileId,
      action: "meeting.admin_cancelled",
      payload: {
        meeting_id: params.meetingId,
        visitor_profile_id: params.visitorProfileId,
        table_id: params.tableId,
        slot_id: params.slotId,
        reason: params.reason ?? null,
        email_failed: params.emailFailed,
      },
    });
  } catch (e) {
    console.warn("[cancel] audit_logs insert failed", { meetingId: params.meetingId, e });
  }
}

export const adminCancelMeeting = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        meetingId: z.string().uuid(),
        reason: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await assertAdminRole(supabaseAdmin, userId);

    const adminProfile = await loadAdminProfileByAuthUserId(userId);

    const res = await performMeetingCancellation({
      meetingId: data.meetingId,
      reason: data.reason,
      cancellingProfile: {
        id: adminProfile.id,
        full_name: adminProfile.full_name,
        email: adminProfile.email,
        preferred_language: adminProfile.preferred_language,
      },
      // no visitorScope: admin can cancel any meeting
      origin: "admin_manual",
      actorType: "admin",
    });

    if (!res.ok) {
      throw new Error(res.reason);
    }

    await writeAdminCancelAuditLog({
      actorProfileId: adminProfile.id,
      eventId: res.eventId,
      meetingId: res.meetingId,
      visitorProfileId: res.visitorProfileId,
      tableId: res.tableId,
      slotId: res.slotId,
      reason: data.reason ?? null,
      emailFailed: res.emailFailed,
    });

    return {
      ok: true as const,
      meetingId: res.meetingId,
      tableId: res.tableId,
      slotId: res.slotId,
      visitorProfileId: res.visitorProfileId,
      emailFailed: res.emailFailed,
    };
  });

export const adminCancelVisitorFutureMeetings = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        visitorProfileId: z.string().uuid(),
        reason: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await assertAdminRole(supabaseAdmin, userId);

    const adminProfile = await loadAdminProfileByAuthUserId(userId);

    // 2-step: pega scheduled desse visitante, depois filtra por start_at
    // consultando time_slots por id (evita path ambíguo em .gte).
    const nowIso = new Date().toISOString();
    const { data: candidatesRaw, error: candErr } = await supabaseAdmin
      .from("meetings")
      .select("id, slot_id")
      .eq("visitor_profile_id", data.visitorProfileId)
      .eq("status", "scheduled");
    if (candErr) throw new Error(candErr.message);
    const candSlotIds = Array.from(
      new Set(
        ((candidatesRaw ?? []) as any[])
          .map((m) => m.slot_id)
          .filter((v): v is string => !!v),
      ),
    );
    const futureSlotIds = new Set<string>();
    if (candSlotIds.length > 0) {
      const { data: futureSlots } = await supabaseAdmin
        .from("time_slots")
        .select("id")
        .in("id", candSlotIds)
        .gte("start_at", nowIso);
      for (const s of (futureSlots ?? []) as any[]) futureSlotIds.add(s.id);
    }
    const ids = ((candidatesRaw ?? []) as any[])
      .filter((m) => m.slot_id && futureSlotIds.has(m.slot_id))
      .map((m) => m.id as string);

    const cancelled: Array<{
      meetingId: string;
      tableId: string;
      slotId: string;
      eventId: string;
      emailFailed: boolean;
    }> = [];
    const failed: Array<{ meetingId: string; reason: string; detail?: string }> = [];

    for (const meetingId of ids) {
      try {
        const res = await performMeetingCancellation({
          meetingId,
          reason: data.reason,
          cancellingProfile: {
            id: adminProfile.id,
            full_name: adminProfile.full_name,
            email: adminProfile.email,
            preferred_language: adminProfile.preferred_language,
          },
          origin: "admin_cancel_all_future",
          actorType: "admin",
        });
        if (res.ok) {
          cancelled.push({
            meetingId: res.meetingId,
            tableId: res.tableId,
            slotId: res.slotId,
            eventId: res.eventId,
            emailFailed: res.emailFailed,
          });
        } else {
          failed.push({ meetingId, reason: res.reason, detail: res.detail });
        }
      } catch (e) {
        failed.push({ meetingId, reason: "unexpected", detail: String(e) });
      }
    }

    return {
      attempted: ids.length,
      cancelled,
      failed,
    };
  });

export type VisitorMeetingRow = {
  meeting_id: string;
  event_id: string;
  start_at: string;
  end_at: string;
  table_id: string;
  table_number: number | null;
  slot_id: string;
  exhibitor_name: string;
};

export const listVisitorMeetings = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ visitorProfileId: z.string().uuid() }).parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<{ rows: VisitorMeetingRow[] }> => {
    const { userId } = context;
    await assertAdminRole(supabaseAdmin, userId);

    // 2-step: meetings + event_tables (FK única) e time_slots por id — evita
    // filtro/ordenação por caminho ambíguo (meetings tem 2 FKs para time_slots).
    const nowIso = new Date().toISOString();
    const { data: rowsRaw, error } = await supabaseAdmin
      .from("meetings")
      .select(
        "id, event_id, table_id, slot_id, event_tables!inner(table_number, exhibitor_profile_id)",
      )
      .eq("visitor_profile_id", data.visitorProfileId)
      .eq("status", "scheduled");
    if (error) throw new Error(error.message);

    const slotIds = Array.from(
      new Set(
        ((rowsRaw ?? []) as any[])
          .map((r) => r.slot_id)
          .filter((v): v is string => !!v),
      ),
    );
    const slotById = new Map<string, { start_at: string; end_at: string }>();
    if (slotIds.length > 0) {
      const { data: slotsData } = await supabaseAdmin
        .from("time_slots")
        .select("id, start_at, end_at")
        .in("id", slotIds)
        .gte("start_at", nowIso);
      for (const s of (slotsData ?? []) as any[]) {
        slotById.set(s.id, { start_at: s.start_at, end_at: s.end_at });
      }
    }
    const rows = ((rowsRaw ?? []) as any[])
      .filter((r) => r.slot_id && slotById.has(r.slot_id))
      .map((r) => ({ ...r, time_slots: slotById.get(r.slot_id)! }))
      .sort((a, b) => a.time_slots.start_at.localeCompare(b.time_slots.start_at));

    const exhibitorIds = Array.from(
      new Set(
        ((rows ?? []) as any[])
          .map((r) => r.event_tables?.exhibitor_profile_id)
          .filter((v): v is string => !!v),
      ),
    );
    const nameByExhibitorId = new Map<string, string>();
    if (exhibitorIds.length > 0) {
      const { data: exhibs } = await supabaseAdmin
        .from("profiles")
        .select("id, companies(trade_name)")
        .in("id", exhibitorIds);
      for (const e of (exhibs ?? []) as any[]) {
        nameByExhibitorId.set(e.id, e.companies?.trade_name ?? "—");
      }
    }

    return {
      rows: ((rows ?? []) as any[]).map((r) => ({
        meeting_id: r.id,
        event_id: r.event_id,
        start_at: r.time_slots?.start_at ?? "",
        end_at: r.time_slots?.end_at ?? "",
        table_id: r.table_id,
        table_number: r.event_tables?.table_number ?? null,
        slot_id: r.slot_id,
        exhibitor_name:
          nameByExhibitorId.get(r.event_tables?.exhibitor_profile_id ?? "") ?? "—",
      })),
    };
  });