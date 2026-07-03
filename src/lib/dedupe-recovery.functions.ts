import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getPrimaryRoleServer } from "@/lib/role-server";
import { getCurrentEventIdWith } from "@/lib/staff-exports.functions";
import { bookMeetingForVisitor } from "@/lib/exhibitor-availability.functions";

/**
 * Aba admin "Reacomodação" — solução ISOLADA para reagendar contatos
 * impactados pelas dedupes `1 slot = 1 empresa`.
 *
 * Este módulo é read-only + wrapper. NÃO altera regras de booking, trigger,
 * disponibilidade ou lotação. Todo reagendamento passa por
 * `bookMeetingForVisitor` (fluxo admin já estabilizado).
 */

const DEDUPE_REASONS = [
  "admin_dedupe_table_slot_company",
  "auto-sanitize:duplicate_table_slot_different_company",
] as const;

async function assertAdmin(userId: string) {
  const role = await getPrimaryRoleServer(supabaseAdmin, userId);
  if (role !== "admin") throw new Error("Forbidden");
}

export type DedupeImpactedRow = {
  profile_id: string;
  full_name: string | null;
  email: string | null;
  company_id: string | null;
  company_trade_name: string | null;
  scheduled_count: number;
  total_history: number;
  cancelled_by_dedupe: number;
};

export type DedupeImpactedCompanyRow = {
  company_id: string | null;
  company_trade_name: string | null;
  contacts: number;
  scheduled_total: number;
  history_total: number;
  cancelled_by_dedupe: number;
};

export type ListDedupeImpactedResult = {
  event_id: string | null;
  mode: "urgent" | "all";
  by_contact: DedupeImpactedRow[];
  by_company: DedupeImpactedCompanyRow[];
};

export const listDedupeImpacted = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        eventId: z.string().uuid().optional(),
        mode: z.enum(["urgent", "all"]).default("urgent"),
      })
      .parse(input ?? {}),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<ListDedupeImpactedResult> => {
    await assertAdmin(context.userId);

    const eventId = await getCurrentEventIdWith(supabaseAdmin, data.eventId);
    if (!eventId) {
      return { event_id: null, mode: data.mode, by_contact: [], by_company: [] };
    }

    // Todas as reuniões do evento (qualquer status) — universo de análise.
    const { data: meetings, error } = await supabaseAdmin
      .from("meetings")
      .select("visitor_profile_id, status, cancel_reason")
      .eq("event_id", eventId);
    if (error) throw new Error(error.message);

    const agg = new Map<
      string,
      { scheduled: number; total: number; dedupe: number }
    >();
    for (const m of (meetings ?? []) as Array<{
      visitor_profile_id: string | null;
      status: string | null;
      cancel_reason: string | null;
    }>) {
      const pid = m.visitor_profile_id;
      if (!pid) continue;
      const cur = agg.get(pid) ?? { scheduled: 0, total: 0, dedupe: 0 };
      cur.total += 1;
      if (m.status === "scheduled") cur.scheduled += 1;
      if (
        m.status === "cancelled" &&
        m.cancel_reason &&
        (DEDUPE_REASONS as readonly string[]).includes(m.cancel_reason)
      ) {
        cur.dedupe += 1;
      }
      agg.set(pid, cur);
    }

    // Aplica filtro por modo.
    const impactedIds: string[] = [];
    for (const [pid, v] of agg.entries()) {
      if (v.dedupe <= 0) continue;
      if (data.mode === "urgent") {
        if (v.scheduled === 1 && v.total > 1) impactedIds.push(pid);
      } else {
        impactedIds.push(pid);
      }
    }
    if (impactedIds.length === 0) {
      return { event_id: eventId, mode: data.mode, by_contact: [], by_company: [] };
    }

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, company_id, companies(trade_name)")
      .in("id", impactedIds);

    const rows: DedupeImpactedRow[] = (profiles ?? []).map((p: any) => {
      const a = agg.get(p.id)!;
      return {
        profile_id: p.id,
        full_name: p.full_name,
        email: p.email,
        company_id: p.company_id,
        company_trade_name: p.companies?.trade_name ?? null,
        scheduled_count: a.scheduled,
        total_history: a.total,
        cancelled_by_dedupe: a.dedupe,
      };
    });
    rows.sort(
      (a, b) =>
        b.cancelled_by_dedupe - a.cancelled_by_dedupe ||
        b.total_history - a.total_history,
    );

    const companyMap = new Map<string, DedupeImpactedCompanyRow>();
    for (const r of rows) {
      const key = r.company_id ?? "__none__";
      const cur =
        companyMap.get(key) ?? {
          company_id: r.company_id,
          company_trade_name: r.company_trade_name,
          contacts: 0,
          scheduled_total: 0,
          history_total: 0,
          cancelled_by_dedupe: 0,
        };
      cur.contacts += 1;
      cur.scheduled_total += r.scheduled_count;
      cur.history_total += r.total_history;
      cur.cancelled_by_dedupe += r.cancelled_by_dedupe;
      companyMap.set(key, cur);
    }
    const byCompany = [...companyMap.values()].sort(
      (a, b) =>
        b.cancelled_by_dedupe - a.cancelled_by_dedupe ||
        b.history_total - a.history_total,
    );

    return {
      event_id: eventId,
      mode: data.mode,
      by_contact: rows,
      by_company: byCompany,
    };
  });

export type RecoverySlotSuggestion = {
  slot_id: string;
  table_id: string;
  table_number: number;
  exhibitor_profile_id: string | null;
  exhibitor_company_name: string | null;
  start_at: string;
  end_at: string;
  source: "same_company" | "free";
  colleague_name?: string | null;
};

export type SuggestRecoverySlotsResult = {
  event_id: string | null;
  suggestions: RecoverySlotSuggestion[];
};

export const suggestRecoverySlots = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        profileId: z.string().uuid(),
        eventId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(200).default(60),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<SuggestRecoverySlotsResult> => {
    await assertAdmin(context.userId);

    const eventId = await getCurrentEventIdWith(supabaseAdmin, data.eventId);
    if (!eventId) return { event_id: null, suggestions: [] };

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, company_id")
      .eq("id", data.profileId)
      .maybeSingle();
    if (!profile) return { event_id: eventId, suggestions: [] };

    // Mesas do evento + expositora.
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
    const tableIds = tableList.map((t) => t.id);
    if (tableIds.length === 0) return { event_id: eventId, suggestions: [] };

    // Nomes das expositoras.
    const exhibitorIds = [
      ...new Set(
        tableList.map((t) => t.exhibitor_profile_id).filter(Boolean) as string[],
      ),
    ];
    const exhibitorNames = new Map<string, string | null>();
    if (exhibitorIds.length) {
      const { data: exProfiles } = await supabaseAdmin
        .from("profiles")
        .select("id, companies(trade_name)")
        .in("id", exhibitorIds);
      for (const p of (exProfiles ?? []) as any[]) {
        exhibitorNames.set(p.id, p.companies?.trade_name ?? null);
      }
    }

    // Todos os time_slots ativos das mesas do evento.
    const { data: slots } = await supabaseAdmin
      .from("time_slots")
      .select("id, table_id, start_at, end_at")
      .in("table_id", tableIds)
      .eq("is_active", true)
      .order("start_at");
    const slotList = (slots ?? []) as Array<{
      id: string;
      table_id: string;
      start_at: string;
      end_at: string;
    }>;

    // Reuniões scheduled do evento (para computar ocupação por slot).
    const { data: allMeetings } = await supabaseAdmin
      .from("meetings")
      .select(
        "id, table_id, slot_id, visitor_profile_id, time_slots!inner(start_at,end_at), visitor:profiles!visitor_profile_id(full_name, company_id)",
      )
      .eq("event_id", eventId)
      .eq("status", "scheduled");
    const meetingList = (allMeetings ?? []) as any[];

    // Conflitos pessoais do contato: horários (start_at) já ocupados por ele.
    const myStarts = new Set<string>();
    const myTables = new Set<string>();
    for (const m of meetingList) {
      if (m.visitor_profile_id === profile.id) {
        const s = m.time_slots?.start_at;
        if (s) myStarts.add(s);
        if (m.table_id) myTables.add(m.table_id);
      }
    }

    // Índice de meetings por (table_id, slot_id).
    type SlotInfo = {
      companies: Set<string>;
      sameCompanyMeeting?: { colleague_name: string | null };
      selfPresent: boolean;
    };
    const bySlot = new Map<string, SlotInfo>();
    const keyOf = (t: string, s: string) => `${t}::${s}`;
    for (const m of meetingList) {
      const k = keyOf(m.table_id, m.slot_id);
      const cur =
        bySlot.get(k) ?? { companies: new Set<string>(), selfPresent: false };
      const cid = m.visitor?.company_id ?? null;
      if (cid) cur.companies.add(cid);
      if (m.visitor_profile_id === profile.id) cur.selfPresent = true;
      if (
        profile.company_id &&
        cid === profile.company_id &&
        m.visitor_profile_id !== profile.id
      ) {
        cur.sameCompanyMeeting = {
          colleague_name: m.visitor?.full_name ?? null,
        };
      }
      bySlot.set(k, cur);
    }

    const tableById = new Map(tableList.map((t) => [t.id, t]));

    const sameCompany: RecoverySlotSuggestion[] = [];
    const free: RecoverySlotSuggestion[] = [];

    for (const s of slotList) {
      const table = tableById.get(s.table_id);
      if (!table) continue;
      // Regras comuns: sem conflito pessoal por horário e sem reunião já dele nesta mesa.
      if (myStarts.has(s.start_at)) continue;
      if (myTables.has(s.table_id)) continue;

      const info = bySlot.get(keyOf(s.table_id, s.id));
      if (info?.selfPresent) continue;

      const base = {
        slot_id: s.id,
        table_id: s.table_id,
        table_number: table.table_number,
        exhibitor_profile_id: table.exhibitor_profile_id,
        exhibitor_company_name:
          (table.exhibitor_profile_id &&
            exhibitorNames.get(table.exhibitor_profile_id)) ||
          null,
        start_at: s.start_at,
        end_at: s.end_at,
      };

      if (info?.sameCompanyMeeting) {
        // Slot compartilhável: só a própria empresa presente.
        const onlyOwnCompany =
          info.companies.size === 1 &&
          profile.company_id !== null &&
          info.companies.has(profile.company_id);
        if (onlyOwnCompany) {
          sameCompany.push({
            ...base,
            source: "same_company",
            colleague_name: info.sameCompanyMeeting.colleague_name,
          });
          continue;
        }
      }

      if (!info || info.companies.size === 0) {
        free.push({ ...base, source: "free" });
      }
    }

    const suggestions = [...sameCompany, ...free].slice(0, data.limit);
    return { event_id: eventId, suggestions };
  });

export type RebookResult =
  | { ok: true; meetingId: string }
  | {
      ok: false;
      code:
        | "SLOT_TAKEN_OTHER_COMPANY"
        | "VISITOR_TIME_CONFLICT"
        | "DUPLICATE_TABLE"
        | "SLOT_CONFLICT"
        | "UNKNOWN";
      friendlyMessage: string;
    };

function classifyError(msg: string): {
  code:
    | "SLOT_TAKEN_OTHER_COMPANY"
    | "VISITOR_TIME_CONFLICT"
    | "DUPLICATE_TABLE"
    | "SLOT_CONFLICT"
    | "UNKNOWN";
  friendlyMessage: string;
} {
  const m = msg.toLowerCase();
  if (m.includes("outra empresa") || m.includes("one_company_per_slot")) {
    return {
      code: "SLOT_TAKEN_OTHER_COMPANY",
      friendlyMessage:
        "Este horário acabou de ser ocupado por outra empresa. Escolha outro slot sugerido.",
    };
  }
  if (m.includes("já tem reunião agendada neste horário")) {
    return {
      code: "VISITOR_TIME_CONFLICT",
      friendlyMessage:
        "O contato já tem uma reunião em outro expositor neste horário.",
    };
  }
  if (m.includes("no máximo 1 reunião por mesa")) {
    return {
      code: "DUPLICATE_TABLE",
      friendlyMessage: "O contato já possui reunião com esta mesa.",
    };
  }
  if (m.includes("conflito")) {
    return {
      code: "SLOT_CONFLICT",
      friendlyMessage:
        "Este horário deixou de estar disponível. Recarregue as sugestões.",
    };
  }
  return {
    code: "UNKNOWN",
    friendlyMessage:
      "Não foi possível reagendar. A ação foi registrada; tente outro slot.",
  };
}

export const rebookImpacted = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        profileId: z.string().uuid(),
        tableId: z.string().uuid(),
        slotId: z.string().uuid(),
        source: z.enum(["same_company", "free"]),
        priorCancelledByDedupe: z.number().int().min(0).default(0),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<RebookResult> => {
    await assertAdmin(context.userId);

    const eventId = await getCurrentEventIdWith(supabaseAdmin, undefined);
    if (!eventId) {
      return {
        ok: false,
        code: "UNKNOWN",
        friendlyMessage:
          "Nenhum evento ativo encontrado. Recarregue e tente novamente.",
      };
    }

    const { data: actor } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    const actorProfileId = actor?.id ?? null;

    try {
      const res = await bookMeetingForVisitor({
        data: {
          visitorProfileId: data.profileId,
          slotId: data.slotId,
          tableId: data.tableId,
          eventId,
        },
      });
      await supabaseAdmin.from("audit_logs").insert({
        event_id: eventId,
        actor_profile_id: actorProfileId,
        action: "dedupe_recovery_rebook",
        payload: {
          status: "succeeded",
          profile_id: data.profileId,
          meeting_id: res.id,
          target_table_id: data.tableId,
          target_slot_id: data.slotId,
          source: data.source,
          prior_cancelled_by_dedupe: data.priorCancelledByDedupe,
        },
      });
      return { ok: true, meetingId: res.id };
    } catch (err: any) {
      const raw = err?.message ?? String(err);
      const { code, friendlyMessage } = classifyError(raw);
      await supabaseAdmin.from("audit_logs").insert({
        event_id: eventId,
        actor_profile_id: actorProfileId,
        action: "dedupe_recovery_rebook",
        payload: {
          status: "failed",
          profile_id: data.profileId,
          target_table_id: data.tableId,
          target_slot_id: data.slotId,
          source: data.source,
          error_code: code,
          error_message: raw,
        },
      });
      return { ok: false, code, friendlyMessage };
    }
  });