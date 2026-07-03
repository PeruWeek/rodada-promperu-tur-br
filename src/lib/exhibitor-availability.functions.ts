import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getPrimaryRoleServer } from "@/lib/role-server";
import { bucketGroupFromMeetings } from "@/lib/scheduling-status";
import { getCurrentEventIdWith } from "@/lib/staff-exports.functions";

/**
 * Aba "Disponibilidade Expositoras" — fonte única de verdade:
 *   • bucket via bucketGroupFromMeetings(count real de meetings scheduled);
 *   • slots_free = time_slots ativos − meetings scheduled, por company_id
 *     (múltiplas mesas somam);
 *   • evento atual via helper canônico getCurrentEventIdWith.
 */

export type FreeSlot = {
  slot_id: string;
  table_id: string;
  table_number: number;
  start_at: string;
  end_at: string;
};

export type BookedSlot = {
  slot_id: string;
  table_id: string;
  table_number: number;
  start_at: string;
  end_at: string;
  visitor_profile_id: string;
  visitor_name: string;
  visitor_company_name: string | null;
  visitor_company_id: string | null;
};

export type ExhibitorAvailabilityStatus =
  | "lotada"
  | "com_agendamento"
  | "sem_agendamento";

export type ExhibitorAvailabilityRow = {
  company_id: string;
  trade_name: string;
  city: string | null;
  country_code: string | null;
  tables: Array<{ id: string; table_number: number }>;
  table_numbers_label: string;
  slots_total: number;
  slots_booked: number;
  slots_free: number;
  status: ExhibitorAvailabilityStatus;
  free_slots: FreeSlot[];
  booked_slots: BookedSlot[];
};

export type ExhibitorAvailabilityResult = {
  event_id: string | null;
  rows: ExhibitorAvailabilityRow[];
};

async function assertOperator(userId: string) {
  const role = await getPrimaryRoleServer(supabaseAdmin, userId);
  if (role !== "admin" && role !== "staff" && role !== "cliente") {
    throw new Error("Forbidden");
  }
  return role;
}

export const listExhibitorAvailability = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ eventId: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<ExhibitorAvailabilityResult> => {
    await assertOperator(context.userId);

    const eventId = await getCurrentEventIdWith(supabaseAdmin, data.eventId);
    if (!eventId) return { event_id: null, rows: [] };

    // 1) Mesas do evento (única origem de expositoras nesta aba —
    //    expositoras sem mesa NÃO entram nesta visão operacional).
    const { data: tables } = await supabaseAdmin
      .from("event_tables")
      .select("id, table_number, exhibitor_profile_id")
      .eq("event_id", eventId)
      .order("table_number");
    const tableList = (tables ?? []) as Array<{
      id: string;
      table_number: number;
      exhibitor_profile_id: string | null;
    }>;

    // 2) Perfis expositores ATIVOS → company_id.
    //    Perfis desativados são descartados aqui.
    const exhProfileIds = tableList
      .map((t) => t.exhibitor_profile_id)
      .filter((v): v is string => !!v);
    const { data: profs } = exhProfileIds.length
      ? await supabaseAdmin
          .from("profiles")
          .select("id, company_id, is_active")
          .in("id", exhProfileIds)
      : { data: [] as Array<{ id: string; company_id: string | null; is_active: boolean | null }> };
    const profileCompany = new Map<string, string | null>(
      (profs ?? [])
        .filter((p) => p.is_active !== false)
        .map((p) => [p.id, p.company_id ?? null]),
    );

    // 3) Metadados de pipeline apenas para enriquecer nome/cidade/país
    //    das companies que JÁ possuem mesa. Não usamos mais para incluir
    //    expositoras "sem mesa" na resposta.
    const { data: pipelineRows } = await supabaseAdmin
      .from("v_company_event_pipeline")
      .select("company_id, company_trade_name, city, country_code, company_role")
      .eq("event_id", eventId)
      .eq("company_role", "exhibitor");
    const pipelineByCompany = new Map<
      string,
      { trade_name: string; city: string | null; country_code: string | null }
    >();
    for (const r of (pipelineRows ?? []) as Array<{
      company_id: string | null;
      company_trade_name: string | null;
      city: string | null;
      country_code: string | null;
    }>) {
      if (!r.company_id) continue;
      pipelineByCompany.set(r.company_id, {
        trade_name: r.company_trade_name ?? "—",
        city: r.city,
        country_code: r.country_code,
      });
    }

    // 4) company_ids alvo: SOMENTE empresas com pelo menos uma mesa
    //    atribuída a perfil expositor ATIVO no evento atual.
    const companyIds = new Set<string>();
    for (const t of tableList) {
      const cid = t.exhibitor_profile_id
        ? profileCompany.get(t.exhibitor_profile_id) ?? null
        : null;
      if (cid) companyIds.add(cid);
    }
    if (companyIds.size === 0) return { event_id: eventId, rows: [] };

    // 5) Metadados de company + status is_active (fonte da verdade
    //    para excluir empresas desativadas).
    const { data: companyRows } = await supabaseAdmin
      .from("companies")
      .select("id, trade_name, city, country_code, is_active")
      .in("id", [...companyIds]);
    const activeCompanyIds = new Set(
      (companyRows ?? [])
        .filter((c) => (c as { is_active?: boolean }).is_active !== false)
        .map((c) => c.id),
    );
    const missingCompanyIds = [...activeCompanyIds].filter((id) => !pipelineByCompany.has(id));
    const extraCompanies = missingCompanyIds.length
      ? await supabaseAdmin
          .from("companies")
          .select("id, trade_name, city, country_code")
          .in("id", missingCompanyIds)
          .then((r) => r.data ?? [])
      : [];
    const companyInfo = new Map<
      string,
      { trade_name: string; city: string | null; country_code: string | null }
    >(pipelineByCompany);
    for (const c of extraCompanies) {
      companyInfo.set(c.id, {
        trade_name: c.trade_name ?? "—",
        city: c.city,
        country_code: c.country_code,
      });
    }

    // 6) Slots + meetings em lote
    const tableIds = tableList.map((t) => t.id);
    const [slotsRes, meetingsRes] = tableIds.length
      ? await Promise.all([
          supabaseAdmin
            .from("time_slots")
            .select("id, table_id, start_at, end_at, is_active")
            .in("table_id", tableIds)
            .eq("is_active", true)
            .order("start_at"),
          supabaseAdmin
            .from("meetings")
            .select("id, table_id, slot_id, visitor_profile_id, status")
            .in("table_id", tableIds)
            .eq("status", "scheduled"),
        ])
      : [{ data: [] as any[] }, { data: [] as any[] }];
    const slots = (slotsRes.data ?? []) as Array<{
      id: string;
      table_id: string;
      start_at: string;
      end_at: string;
    }>;
    const meetings = (meetingsRes.data ?? []) as Array<{
      id: string;
      table_id: string;
      slot_id: string;
      visitor_profile_id: string;
    }>;

    // 7) Visitantes
    const visitorIds = Array.from(
      new Set(meetings.map((m) => m.visitor_profile_id).filter(Boolean)),
    );
    const { data: visitors } = visitorIds.length
      ? await supabaseAdmin
          .from("profiles")
          .select("id, full_name, company_id")
          .in("id", visitorIds)
      : { data: [] as Array<{ id: string; full_name: string; company_id: string | null }> };
    const visitorCompanyIds = Array.from(
      new Set((visitors ?? []).map((v) => v.company_id).filter((x): x is string => !!x)),
    );
    const { data: visitorCompanies } = visitorCompanyIds.length
      ? await supabaseAdmin.from("companies").select("id, trade_name").in("id", visitorCompanyIds)
      : { data: [] as Array<{ id: string; trade_name: string }> };
    const visitorById = new Map(
      (visitors ?? []).map((v) => [
        v.id,
        {
          name: v.full_name,
          companyId: v.company_id ?? null,
          companyName:
            (visitorCompanies ?? []).find((c) => c.id === v.company_id)?.trade_name ?? null,
        },
      ]),
    );

    // 8) Agrupar por company_id (consolida múltiplas mesas)
    type Accum = {
      trade_name: string;
      city: string | null;
      country_code: string | null;
      tables: Array<{ id: string; table_number: number }>;
      slots_total: number;
      slots_booked: number;
      free_slots: FreeSlot[];
      booked_slots: BookedSlot[];
    };
    const byCompany = new Map<string, Accum>();
    const ensure = (companyId: string): Accum => {
      let acc = byCompany.get(companyId);
      if (!acc) {
        const info = companyInfo.get(companyId) ?? {
          trade_name: "—",
          city: null,
          country_code: null,
        };
        acc = {
          trade_name: info.trade_name,
          city: info.city,
          country_code: info.country_code,
          tables: [],
          slots_total: 0,
          slots_booked: 0,
          free_slots: [],
          booked_slots: [],
        };
        byCompany.set(companyId, acc);
      }
      return acc;
    };
    // Só instancia acumuladores para empresas ativas com mesa (loop abaixo).

    const bookedSlotIds = new Set(meetings.map((m) => m.slot_id));
    const meetingsByTable = new Map<string, typeof meetings>();
    for (const m of meetings) {
      const arr = meetingsByTable.get(m.table_id) ?? [];
      arr.push(m);
      meetingsByTable.set(m.table_id, arr);
    }

    for (const t of tableList) {
      const cid = t.exhibitor_profile_id
        ? profileCompany.get(t.exhibitor_profile_id) ?? null
        : null;
      if (!cid) continue;
      if (!activeCompanyIds.has(cid)) continue;
      const acc = ensure(cid);
      acc.tables.push({ id: t.id, table_number: t.table_number });

      const tableSlots = slots.filter((s) => s.table_id === t.id);
      acc.slots_total += tableSlots.length;
      for (const s of tableSlots) {
        if (bookedSlotIds.has(s.id)) continue;
        acc.free_slots.push({
          slot_id: s.id,
          table_id: t.id,
          table_number: t.table_number,
          start_at: s.start_at,
          end_at: s.end_at,
        });
      }

      const tMeetings = meetingsByTable.get(t.id) ?? [];
      acc.slots_booked += tMeetings.length;
      for (const m of tMeetings) {
        const slot = slots.find((s) => s.id === m.slot_id);
        const v = visitorById.get(m.visitor_profile_id);
        acc.booked_slots.push({
          slot_id: m.slot_id,
          table_id: t.id,
          table_number: t.table_number,
          start_at: slot?.start_at ?? "",
          end_at: slot?.end_at ?? "",
          visitor_profile_id: m.visitor_profile_id,
          visitor_name: v?.name ?? "—",
          visitor_company_name: v?.companyName ?? null,
          visitor_company_id: v?.companyId ?? null,
        });
      }
    }

    const rows: ExhibitorAvailabilityRow[] = [];
    for (const [companyId, acc] of byCompany.entries()) {
      // Defesa em profundidade — empresa sem mesa jamais deve aparecer.
      if (acc.tables.length === 0) continue;
      const slots_free = Math.max(0, acc.slots_total - acc.slots_booked);
      let status: ExhibitorAvailabilityStatus;
      if (slots_free === 0 && acc.slots_total > 0) status = "lotada";
      else status = bucketGroupFromMeetings(acc.slots_booked);

      acc.free_slots.sort((a, b) => a.start_at.localeCompare(b.start_at));
      acc.booked_slots.sort((a, b) => a.start_at.localeCompare(b.start_at));
      acc.tables.sort((a, b) => a.table_number - b.table_number);

      rows.push({
        company_id: companyId,
        trade_name: acc.trade_name,
        city: acc.city,
        country_code: acc.country_code,
        tables: acc.tables,
        table_numbers_label: acc.tables.map((t) => t.table_number).join(", "),
        slots_total: acc.slots_total,
        slots_booked: acc.slots_booked,
        slots_free,
        status,
        free_slots: acc.free_slots,
        booked_slots: acc.booked_slots,
      });
    }

    const statusOrder: Record<ExhibitorAvailabilityStatus, number> = {
      sem_agendamento: 1,
      com_agendamento: 2,
      lotada: 3,
    };
    rows.sort((a, b) => {
      const aFree = a.slots_free > 0 ? 0 : 1;
      const bFree = b.slots_free > 0 ? 0 : 1;
      if (aFree !== bFree) return aFree - bFree;
      const so = statusOrder[a.status] - statusOrder[b.status];
      if (so !== 0) return so;
      return a.trade_name.localeCompare(b.trade_name);
    });

    return { event_id: eventId, rows };
  });

/**
 * Agendamento manual por operator (admin/staff/cliente).
 * REAPLICA integralmente as guardas + mensagens + efeitos de bookMeeting.
 */
async function sendMeetingConfirmationEmail(params: {
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
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({
        templateName: "meeting-confirmation",
        recipientEmail: params.recipientEmail,
        idempotencyKey: params.idempotencyKey,
        templateData: params.templateData,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn("[email] send failed", res.status, body.slice(0, 200));
    }
  } catch (err) {
    console.warn("[email] send threw", err);
  }
}

export const bookMeetingForVisitor = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        visitorProfileId: z.string().uuid(),
        slotId: z.string().uuid(),
        tableId: z.string().uuid(),
        eventId: z.string().uuid(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertOperator(context.userId);

    const { data: visitor, error: vErr } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, company_id, email, preferred_language")
      .eq("id", data.visitorProfileId)
      .maybeSingle();
    if (vErr) throw new Error(vErr.message);
    if (!visitor) throw new Error("Visitante não encontrado");

    // Guarda 1 — slot existe
    const { data: newSlot, error: nsErr } = await supabaseAdmin
      .from("time_slots")
      .select("start_at, end_at")
      .eq("id", data.slotId)
      .maybeSingle();
    if (nsErr) throw new Error(nsErr.message);
    if (!newSlot) throw new Error("Slot not found");

    // Guarda 2 — conflito por HORÁRIO do visitante (mesmo start_at, qualquer mesa)
    const { data: existingMeetings } = await supabaseAdmin
      .from("meetings")
      .select("id, slot_id, time_slots!inner(start_at)")
      .eq("visitor_profile_id", visitor.id)
      .eq("status", "scheduled");
    const hasConflict = (existingMeetings ?? []).some(
      (m: any) => m.time_slots?.start_at === newSlot.start_at,
    );
    if (hasConflict) {
      throw new Error("Conflito: você já tem reunião agendada neste horário.");
    }

    // Guarda 3 — mesma mesa/expositor (unique)
    const { data: sameTable } = await supabaseAdmin
      .from("meetings")
      .select("id")
      .eq("visitor_profile_id", visitor.id)
      .eq("table_id", data.tableId)
      .eq("status", "scheduled")
      .maybeSingle();
    if (sameTable) {
      throw new Error(
        "Você já tem uma reunião agendada com este expositor. Cada participante pode ter no máximo 1 reunião por mesa.",
      );
    }

    // Guarda 3.5 — regra "1 slot = 1 EMPRESA" na mesa. Bloqueia apenas se
    // já houver reunião de OUTRA empresa neste (table_id, slot_id). Mesma
    // empresa é permitida. Enforço duro pelo trigger
    // `trg_meetings_no_conflict` (advisory lock + checagem de empresa).
    const { data: slotTaken } = await supabaseAdmin
      .from("meetings")
      .select("id, visitor:profiles!visitor_profile_id(company_id)")
      .eq("table_id", data.tableId)
      .eq("slot_id", data.slotId)
      .eq("status", "scheduled");
    const otherCompanyOnSlot = (slotTaken ?? []).some(
      (m: any) =>
        m.visitor?.company_id &&
        m.visitor.company_id !== visitor.company_id,
    );
    if (otherCompanyOnSlot) {
      throw new Error(
        "Este horário já está ocupado por outra empresa nesta mesa. Escolha outro slot.",
      );
    }

    // Guarda 4 — mesma empresa visitante já no mesmo (start_at, end_at) do evento
    // em qualquer mesa. Enforçado no banco por trg_meetings_one_company_per_slot;
    // aqui é apenas o caminho amigável de erro.
    if (visitor.company_id) {
      const { data: companyClash } = await supabaseAdmin
        .from("meetings")
        .select(
          "id, table_id, slot_id, visitor:profiles!visitor_profile_id(company_id), time_slots!inner(start_at, end_at)",
        )
        .eq("event_id", data.eventId)
        .eq("status", "scheduled")
        .eq("time_slots.start_at", newSlot.start_at)
        .eq("time_slots.end_at", newSlot.end_at);
      const clash = (companyClash ?? []).some(
        (m: any) =>
          m.visitor?.company_id === visitor.company_id &&
          !(m.table_id === data.tableId && m.slot_id === data.slotId),
      );
      if (clash) {
        throw new Error(
          "Esta empresa já possui uma reunião agendada neste horário em outra mesa.",
        );
      }
    }

    const { data: meeting, error: mErr } = await supabaseAdmin
      .from("meetings")
      .insert({
        event_id: data.eventId,
        table_id: data.tableId,
        slot_id: data.slotId,
        visitor_profile_id: visitor.id,
        status: "scheduled",
      })
      .select("id")
      .single();
    if (mErr) throw new Error(mErr.message);

    // Efeitos colaterais idênticos ao bookMeeting
    const { data: tableRow } = await supabaseAdmin
      .from("event_tables")
      .select("table_number, exhibitor_profile_id")
      .eq("id", data.tableId)
      .maybeSingle();

    const { data: visitorCompany } = visitor.company_id
      ? await supabaseAdmin
          .from("companies")
          .select("trade_name")
          .eq("id", visitor.company_id)
          .maybeSingle()
      : { data: null as { trade_name: string } | null };

    let exhibitorCompany = "—";
    if (tableRow?.exhibitor_profile_id) {
      const { data: exhibProfile } = await supabaseAdmin
        .from("profiles")
        .select("company_id, companies(trade_name)")
        .eq("id", tableRow.exhibitor_profile_id)
        .maybeSingle();
      exhibitorCompany =
        (exhibProfile as any)?.companies?.trade_name ?? exhibitorCompany;

      await supabaseAdmin.from("notifications").insert({
        event_id: data.eventId,
        recipient_profile_id: tableRow.exhibitor_profile_id,
        type: "meeting_created",
        channel: "in_app",
        status: "sent",
        title: "Nova reunião agendada",
        body: `${visitorCompany?.trade_name ?? visitor.full_name} agendou uma reunião com você.`,
        data: {
          meeting_id: meeting.id,
          slot_start: newSlot.start_at,
          table_number: tableRow.table_number,
          visitor_name: visitor.full_name,
        },
      });
    }

    if (visitor.email) {
      await sendMeetingConfirmationEmail({
        recipientEmail: visitor.email,
        idempotencyKey: `meeting-confirm-${meeting.id}`,
        templateData: {
          language: visitor.preferred_language ?? "pt-BR",
          visitorName: visitor.full_name,
          exhibitorCompany,
          tableNumber: tableRow?.table_number ?? "—",
          slotStart: newSlot.start_at,
          slotEnd: newSlot.end_at,
          agendaUrl: "https://rodada.promperu.tur.br/agenda",
        },
      });
    }

    return { id: meeting.id };
  });