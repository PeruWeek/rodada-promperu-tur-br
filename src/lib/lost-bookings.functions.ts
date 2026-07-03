import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getPrimaryRoleServer } from "@/lib/role-server";
import { getCurrentEventIdWith } from "@/lib/staff-exports.functions";

/**
 * Aba admin "Histórico de perdas" — visão read-only.
 *
 * Lista reuniões canceladas por dedupe/conflito e resolve a "vencedora"
 * do mesmo (table_id, slot_id) sem usar `meetings.updated_at`.
 *
 * Resolução da vencedora:
 *  1. Se existir audit_log correspondente com `kept_meeting_id`, usa esse ID
 *     → winner_source = 'audit_log'.
 *  2. Caso contrário, escolhe a reunião mais antiga (MIN(created_at)) com
 *     status IN ('scheduled','done','no_show') no mesmo (table_id, slot_id)
 *     → winner_source = 'min_created_at'.
 *
 * Nunca escreve. Não altera motor de agendamento.
 */

const LOSER_REASONS = [
  "admin_dedupe_table_slot",
  "admin_dedupe_table_slot_company",
  "admin_dedupe_company_slot",
  "auto-sanitize:duplicate_table_slot_different_company",
  "auto-sanitize:duplicate_table_slot_different_company_v2",
] as const;

const DEDUPE_AUDIT_ACTIONS = [
  "meeting.deduped_table_slot",
  "meeting.deduped_table_slot_company",
  "meeting.cancelled.company_slot_dedupe",
  "sanitize_meeting_conflict_v2",
] as const;

const WINNER_STATUSES = ["scheduled", "done", "no_show"] as const;

type LossSource =
  | "admin_manual"
  | "auto_sanitize_other_company"
  | "lost_to_earlier_booking"
  | "other_technical";

export type LostBookingRow = {
  meeting_id: string;
  cancelled_at: string; // best-effort: created_at do log; se ausente, created_at da reunião
  cancel_reason: string;
  loss_source: LossSource;
  loss_source_label: string;
  loser: {
    profile_id: string;
    full_name: string | null;
    email: string | null;
    company_id: string | null;
    company_trade_name: string | null;
  };
  slot: {
    table_id: string;
    table_number: number | null;
    slot_id: string;
    start_at: string | null;
    end_at: string | null;
  };
  winner: null | {
    meeting_id: string;
    created_at: string;
    status: string;
    profile_id: string;
    full_name: string | null;
    company_id: string | null;
    company_trade_name: string | null;
    winner_source: "audit_log" | "min_created_at";
  };
};

export type LostBookingCompanyRow = {
  company_id: string | null;
  company_trade_name: string | null;
  contacts_impacted: number;
  lost_total: number;
  by_source: Record<LossSource, number>;
  last_lost_at: string | null;
};

export type ListLostBookingsResult = {
  event_id: string | null;
  rows: LostBookingRow[];
  by_company: LostBookingCompanyRow[];
  total_found: number;
  truncated: boolean;
  limit: number;
};

async function assertAdmin(userId: string) {
  const role = await getPrimaryRoleServer(supabaseAdmin, userId);
  if (role !== "admin") throw new Error("Forbidden");
}

function classifyLossSource(
  cancelReason: string,
  hasWinner: boolean,
  winnerCreatedBefore: boolean,
): { source: LossSource; label: string } {
  if (cancelReason.startsWith("admin_dedupe")) {
    return { source: "admin_manual", label: "Dedupe manual/admin" };
  }
  if (
    cancelReason === "auto-sanitize:duplicate_table_slot_different_company" ||
    cancelReason === "auto-sanitize:duplicate_table_slot_different_company_v2"
  ) {
    return {
      source: "auto_sanitize_other_company",
      label: "Auto-sanitize (outra empresa)",
    };
  }
  if (hasWinner && winnerCreatedBefore) {
    return {
      source: "lost_to_earlier_booking",
      label: "Perdeu para outra empresa (chegou antes)",
    };
  }
  return { source: "other_technical", label: "Outro motivo técnico" };
}

export const listLostBookings = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        eventId: z.string().uuid().optional(),
        companyId: z.string().uuid().nullish(),
        profileId: z.string().uuid().nullish(),
        reasons: z.array(z.string()).nullish(),
        dateFrom: z.string().datetime().nullish(),
        dateTo: z.string().datetime().nullish(),
        limit: z.number().int().min(1).max(2000).default(500),
      })
      .parse(input ?? {}),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<ListLostBookingsResult> => {
    await assertAdmin(context.userId);

    const eventId = await getCurrentEventIdWith(supabaseAdmin, data.eventId ?? undefined);
    if (!eventId) {
      return {
        event_id: null,
        rows: [],
        by_company: [],
        total_found: 0,
        truncated: false,
        limit: data.limit,
      };
    }

    // 1. Perdedoras
    const reasonList =
      data.reasons && data.reasons.length > 0
        ? data.reasons
        : (LOSER_REASONS as readonly string[]);

    const { data: losersRaw, error: losersErr } = await supabaseAdmin
      .from("meetings")
      .select(
        "id, event_id, table_id, slot_id, visitor_profile_id, cancel_reason, created_at",
      )
      .eq("event_id", eventId)
      .eq("status", "cancelled")
      .in("cancel_reason", reasonList as string[]);
    if (losersErr) throw new Error(losersErr.message);

    let losers = (losersRaw ?? []) as Array<{
      id: string;
      table_id: string;
      slot_id: string;
      visitor_profile_id: string;
      cancel_reason: string;
      created_at: string;
    }>;

    if (losers.length === 0) {
      return {
        event_id: eventId,
        rows: [],
        by_company: [],
        total_found: 0,
        truncated: false,
        limit: data.limit,
      };
    }

    // 2. Audit logs referenciando essas perdedoras (para winner_source='audit_log')
    const loserIds = losers.map((l) => l.id);
    const { data: auditRows } = await supabaseAdmin
      .from("audit_logs")
      .select("action, payload, created_at")
      .eq("event_id", eventId)
      .in("action", DEDUPE_AUDIT_ACTIONS as unknown as string[]);
    const auditByLoser = new Map<
      string,
      { kept_meeting_id: string | null; created_at: string }
    >();
    for (const a of (auditRows ?? []) as Array<{
      action: string;
      payload: any;
      created_at: string;
    }>) {
      const p = a.payload ?? {};
      const mid = p.meeting_id as string | undefined;
      if (!mid || !loserIds.includes(mid)) continue;
      const prev = auditByLoser.get(mid);
      // se houver múltiplos, guarda o mais recente com kept_meeting_id
      if (!prev || (p.kept_meeting_id && !prev.kept_meeting_id)) {
        auditByLoser.set(mid, {
          kept_meeting_id: (p.kept_meeting_id as string) ?? null,
          created_at: a.created_at,
        });
      }
    }

    // 3. Universo de candidatas a vencedora — mesmas (table_id, slot_id), status vivo
    const slotKeys = Array.from(
      new Set(losers.map((l) => `${l.table_id}::${l.slot_id}`)),
    );
    const tableIds = Array.from(new Set(losers.map((l) => l.table_id)));
    const slotIds = Array.from(new Set(losers.map((l) => l.slot_id)));

    const { data: candidatesRaw } = await supabaseAdmin
      .from("meetings")
      .select("id, table_id, slot_id, visitor_profile_id, status, created_at")
      .eq("event_id", eventId)
      .in("status", WINNER_STATUSES as unknown as string[])
      .in("table_id", tableIds)
      .in("slot_id", slotIds);
    const candidates = (candidatesRaw ?? []) as Array<{
      id: string;
      table_id: string;
      slot_id: string;
      visitor_profile_id: string;
      status: string;
      created_at: string;
    }>;
    const candBySlot = new Map<string, typeof candidates>();
    for (const c of candidates) {
      const k = `${c.table_id}::${c.slot_id}`;
      const arr = candBySlot.get(k) ?? [];
      arr.push(c);
      candBySlot.set(k, arr);
    }
    // ordena por created_at asc
    for (const arr of candBySlot.values()) {
      arr.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }
    void slotKeys;

    // 4. Enriquecimento: profiles / companies / tables / slots
    const allProfileIds = new Set<string>();
    for (const l of losers) allProfileIds.add(l.visitor_profile_id);
    for (const c of candidates) allProfileIds.add(c.visitor_profile_id);
    const profileIds = [...allProfileIds];

    const { data: profs } = profileIds.length
      ? await supabaseAdmin
          .from("profiles")
          .select("id, full_name, email, company_id")
          .in("id", profileIds)
      : { data: [] as any[] };
    const profileById = new Map(
      ((profs ?? []) as any[]).map((p) => [p.id as string, p]),
    );
    const companyIds = [
      ...new Set(
        ((profs ?? []) as any[])
          .map((p) => p.company_id)
          .filter(Boolean) as string[],
      ),
    ];
    const { data: comps } = companyIds.length
      ? await supabaseAdmin
          .from("companies")
          .select("id, trade_name")
          .in("id", companyIds)
      : { data: [] as any[] };
    const companyById = new Map(
      ((comps ?? []) as any[]).map((c) => [c.id as string, c.trade_name as string | null]),
    );

    const { data: tblRows } = await supabaseAdmin
      .from("event_tables")
      .select("id, table_number")
      .in("id", tableIds);
    const tableById = new Map(
      ((tblRows ?? []) as any[]).map((t) => [
        t.id as string,
        t.table_number as number | null,
      ]),
    );

    const { data: slotRows } = await supabaseAdmin
      .from("time_slots")
      .select("id, start_at, end_at")
      .in("id", slotIds);
    const slotById = new Map(
      ((slotRows ?? []) as any[]).map((s) => [
        s.id as string,
        { start_at: s.start_at as string, end_at: s.end_at as string },
      ]),
    );

    // 5. Filtros server-side por company/profile/data (data = cancelled_at)
    const rowsBuilt: LostBookingRow[] = [];
    for (const l of losers) {
      const loserProfile = profileById.get(l.visitor_profile_id);
      if (data.profileId && l.visitor_profile_id !== data.profileId) continue;
      if (
        data.companyId &&
        (loserProfile?.company_id ?? null) !== data.companyId
      )
        continue;

      const audit = auditByLoser.get(l.id);
      const cancelledAt = audit?.created_at ?? l.created_at;
      if (data.dateFrom && cancelledAt < data.dateFrom) continue;
      if (data.dateTo && cancelledAt > data.dateTo) continue;

      // vencedora
      const key = `${l.table_id}::${l.slot_id}`;
      const pool = candBySlot.get(key) ?? [];
      let winnerRow: (typeof candidates)[number] | undefined;
      let winnerSource: "audit_log" | "min_created_at" | null = null;
      if (audit?.kept_meeting_id) {
        const found = pool.find((c) => c.id === audit.kept_meeting_id);
        if (found) {
          winnerRow = found;
          winnerSource = "audit_log";
        }
      }
      if (!winnerRow && pool.length > 0) {
        winnerRow = pool[0]; // MIN(created_at)
        winnerSource = "min_created_at";
      }

      const winnerCreatedBefore = winnerRow
        ? winnerRow.created_at < l.created_at
        : false;
      const { source, label } = classifyLossSource(
        l.cancel_reason,
        !!winnerRow,
        winnerCreatedBefore,
      );

      const loserCompanyId = loserProfile?.company_id ?? null;
      const loserCompanyName = loserCompanyId
        ? companyById.get(loserCompanyId) ?? null
        : null;

      let winnerData: LostBookingRow["winner"] = null;
      if (winnerRow && winnerSource) {
        const wp = profileById.get(winnerRow.visitor_profile_id);
        const wcid = wp?.company_id ?? null;
        winnerData = {
          meeting_id: winnerRow.id,
          created_at: winnerRow.created_at,
          status: winnerRow.status,
          profile_id: winnerRow.visitor_profile_id,
          full_name: wp?.full_name ?? null,
          company_id: wcid,
          company_trade_name: wcid ? companyById.get(wcid) ?? null : null,
          winner_source: winnerSource,
        };
      }

      const slotInfo = slotById.get(l.slot_id);

      rowsBuilt.push({
        meeting_id: l.id,
        cancelled_at: cancelledAt,
        cancel_reason: l.cancel_reason,
        loss_source: source,
        loss_source_label: label,
        loser: {
          profile_id: l.visitor_profile_id,
          full_name: loserProfile?.full_name ?? null,
          email: loserProfile?.email ?? null,
          company_id: loserCompanyId,
          company_trade_name: loserCompanyName,
        },
        slot: {
          table_id: l.table_id,
          table_number: tableById.get(l.table_id) ?? null,
          slot_id: l.slot_id,
          start_at: slotInfo?.start_at ?? null,
          end_at: slotInfo?.end_at ?? null,
        },
        winner: winnerData,
      });
    }

    // ordenação default: mais recente primeiro
    rowsBuilt.sort((a, b) => b.cancelled_at.localeCompare(a.cancelled_at));

    const totalFound = rowsBuilt.length;
    const rows = rowsBuilt.slice(0, data.limit);
    const truncated = totalFound > rows.length;

    // Agregação por empresa (baseada em `rows`, i.e., visíveis)
    const companyMap = new Map<string, LostBookingCompanyRow>();
    const contactsByCompany = new Map<string, Set<string>>();
    for (const r of rows) {
      const key = r.loser.company_id ?? "__none__";
      const cur =
        companyMap.get(key) ?? {
          company_id: r.loser.company_id,
          company_trade_name: r.loser.company_trade_name,
          contacts_impacted: 0,
          lost_total: 0,
          by_source: {
            admin_manual: 0,
            auto_sanitize_other_company: 0,
            lost_to_earlier_booking: 0,
            other_technical: 0,
          },
          last_lost_at: null as string | null,
        };
      cur.lost_total += 1;
      cur.by_source[r.loss_source] += 1;
      if (!cur.last_lost_at || r.cancelled_at > cur.last_lost_at) {
        cur.last_lost_at = r.cancelled_at;
      }
      const set = contactsByCompany.get(key) ?? new Set<string>();
      set.add(r.loser.profile_id);
      contactsByCompany.set(key, set);
      companyMap.set(key, cur);
    }
    for (const [k, v] of companyMap.entries()) {
      v.contacts_impacted = contactsByCompany.get(k)?.size ?? 0;
    }
    const byCompany = [...companyMap.values()].sort(
      (a, b) => b.lost_total - a.lost_total,
    );

    return {
      event_id: eventId,
      rows,
      by_company: byCompany,
      total_found: totalFound,
      truncated,
      limit: data.limit,
    };
  });