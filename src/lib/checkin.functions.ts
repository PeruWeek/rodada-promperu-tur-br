import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function isAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  return (data ?? []).some((r) => r.role === "admin");
}

async function isAdminOrStaff(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  return (data ?? []).some((r) => r.role === "admin" || r.role === "staff");
}

async function actorProfileId(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  return data?.id ?? null;
}

async function audit(
  userId: string,
  eventId: string,
  action: string,
  payload: Record<string, unknown>,
) {
  const actor = await actorProfileId(userId);
  await supabaseAdmin.from("audit_logs").insert({
    event_id: eventId,
    actor_profile_id: actor,
    action,
    payload: payload as never,
  });
}

// List of profiles eligible for general check-in at an event.
// Eligibility = operational presence in the event (union of three sources):
//  1) visitor_profile_id of meetings with status scheduled|done|no_show
//  2) exhibitor_profile_id of event_tables referenced by those meetings
//  3) exhibitor_profile_id owning ANY event_tables of the event (with or without meetings)
// pipeline registration_status is INFORMATIONAL only (no longer filters).
export const listCheckinEligible = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        eventId: z.string().uuid().optional(),
        q: z.string().trim().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    if (!(await isAdminOrStaff(context.userId)))
      throw new Error("Forbidden: admin/staff only");

    let eventId = data.eventId ?? null;
    if (!eventId) {
      const { data: ev } = await supabaseAdmin
        .from("events")
        .select("id")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      eventId = ev?.id ?? null;
    }
    type EligibleProfile = {
      id: string;
      auth_user_id: string | null;
      full_name: string | null;
      email: string | null;
      company_id: string | null;
      company: string | null;
      pipeline_status: string | null;
    };
    if (!eventId) return { eventId: null, profiles: [] as EligibleProfile[] };

    // 1) In parallel: active meetings + ALL event_tables of the event.
    const [meetingsRes, tablesRes] = await Promise.all([
      supabaseAdmin
        .from("meetings")
        .select("visitor_profile_id, table_id, status")
        .eq("event_id", eventId)
        .in("status", ["scheduled", "done", "no_show"]),
      supabaseAdmin
        .from("event_tables")
        .select("id, exhibitor_profile_id")
        .eq("event_id", eventId),
    ]);
    const meetings = meetingsRes.data ?? [];
    const tables = tablesRes.data ?? [];

    const visitorIds = new Set<string>();
    const meetingTableIds = new Set<string>();
    for (const m of meetings) {
      if (m.visitor_profile_id) visitorIds.add(m.visitor_profile_id as string);
      if (m.table_id) meetingTableIds.add(m.table_id as string);
    }
    const exhibitorIds = new Set<string>();
    const knownTableIds = new Set<string>();
    for (const t of tables) {
      knownTableIds.add(t.id as string);
      if (t.exhibitor_profile_id) exhibitorIds.add(t.exhibitor_profile_id as string);
    }
    // Safety net: meeting references a table not returned in the first batch.
    const missingTableIds = Array.from(meetingTableIds).filter((id) => !knownTableIds.has(id));
    if (missingTableIds.length > 0) {
      const { data: extra } = await supabaseAdmin
        .from("event_tables")
        .select("id, exhibitor_profile_id")
        .in("id", missingTableIds);
      for (const t of extra ?? []) {
        if (t.exhibitor_profile_id) exhibitorIds.add(t.exhibitor_profile_id as string);
      }
    }

    const candidateIds = Array.from(new Set<string>([...visitorIds, ...exhibitorIds]));
    if (candidateIds.length === 0) return { eventId, profiles: [] as EligibleProfile[] };

    // 2) Load candidate profiles (no company filter — pipeline is informational).
    const { data: profs, error } = await supabaseAdmin
      .from("profiles")
      .select("id, auth_user_id, full_name, email, company_id")
      .in("id", candidateIds)
      .order("full_name");
    if (error) throw new Error(error.message);

    // Dedup by profiles.id (natural via Map).
    const profMap = new Map<string, typeof profs[number]>();
    for (const p of profs ?? []) profMap.set(p.id as string, p);

    // 3) Resolve company trade_name and pipeline status per batch.
    const compIds = Array.from(
      new Set(Array.from(profMap.values()).map((p) => p.company_id).filter(Boolean) as string[]),
    );
    const [compsRes, pipeRes] = await Promise.all([
      compIds.length
        ? supabaseAdmin.from("companies").select("id, trade_name").in("id", compIds)
        : Promise.resolve({ data: [] as Array<{ id: string; trade_name: string }> }),
      compIds.length
        ? supabaseAdmin
            .from("company_event_pipeline")
            .select("company_id, registration_status")
            .eq("event_id", eventId)
            .in("company_id", compIds)
        : Promise.resolve({ data: [] as Array<{ company_id: string; registration_status: string }> }),
    ]);
    const compMap = new Map(
      (compsRes.data ?? []).map((c) => [c.id as string, c.trade_name as string]),
    );
    const pipeMap = new Map(
      (pipeRes.data ?? []).map((r) => [r.company_id as string, r.registration_status as string]),
    );

    // 4) Merge → informational shape.
    let merged: EligibleProfile[] = Array.from(profMap.values()).map((p) => ({
      id: p.id as string,
      auth_user_id: (p.auth_user_id as string) ?? null,
      full_name: (p.full_name as string) ?? null,
      email: (p.email as string) ?? null,
      company_id: (p.company_id as string) ?? null,
      company: p.company_id ? compMap.get(p.company_id as string) ?? null : null,
      pipeline_status: p.company_id ? pipeMap.get(p.company_id as string) ?? null : null,
    }));

    // 5) In-memory free-text search over full_name | email | company (trade_name).
    const term = data.q?.trim().toLowerCase() ?? "";
    if (term) {
      merged = merged.filter((p) => {
        const hay = [p.full_name, p.email, p.company]
          .filter(Boolean)
          .map((s) => (s as string).toLowerCase())
          .join(" \u0001 ");
        return hay.includes(term);
      });
    } else {
      // Only cap when there is no search term — a search must never silently hide a match.
      const cap = data.limit ?? 500;
      if (merged.length > cap) merged = merged.slice(0, cap);
    }

    return { eventId, profiles: merged };
  });

// General event check-in (admin/staff scans/marks a profile as present)
export const generalCheckIn = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        eventId: z.string().uuid(),
        profileId: z.string().uuid(),
        method: z.enum(["manual", "qr"]).default("manual"),
        source: z.enum(["entrance", "staff_manual", "qr", "self"]).optional(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    if (!(await isAdminOrStaff(context.userId)))
      throw new Error("Forbidden: admin/staff only");
    const { data: callerProfile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    const { data: existing } = await supabaseAdmin
      .from("general_checkins")
      .select("id")
      .eq("event_id", data.eventId)
      .eq("profile_id", data.profileId)
      .maybeSingle();
    if (existing) return { id: existing.id, alreadyCheckedIn: true };
    const { data: row, error } = await supabaseAdmin
      .from("general_checkins")
      .insert({
        event_id: data.eventId,
        profile_id: data.profileId,
        method: data.method,
        source: data.source ?? (data.method === "qr" ? "qr" : "staff_manual"),
        checked_in_by_profile_id: callerProfile?.id ?? null,
      } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await audit(context.userId, data.eventId, "checkin.general.created", {
      checkin_id: row.id,
      profile_id: data.profileId,
      method: data.method,
    });
    return { id: row.id, alreadyCheckedIn: false };
  });

// Meeting check-in (exhibitor at their table, or admin)
export const meetingCheckIn = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        meetingId: z.string().uuid(),
        status: z.enum(["present", "late", "no_show"]).default("present"),
        lateMinutes: z.number().int().min(0).max(60).optional(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // verify caller is admin/staff OR exhibitor at this meeting's table
    const adminFlag = await isAdmin(userId);
    let byRole: "staff" | "exhibitor" | "visitor" = "exhibitor";
    if (adminFlag) {
      byRole = "staff";
    } else {
      const { data: prof } = await supabase
        .from("profiles")
        .select("id")
        .eq("auth_user_id", userId)
        .maybeSingle();
      if (!prof) throw new Error("Profile not found");
      const { data: meeting } = await supabaseAdmin
        .from("meetings")
        .select("id, table_id, event_id")
        .eq("id", data.meetingId)
        .maybeSingle();
      if (!meeting) throw new Error("Meeting not found");
      const { data: tbl } = await supabaseAdmin
        .from("event_tables")
        .select("exhibitor_profile_id")
        .eq("id", meeting.table_id)
        .maybeSingle();
      if (tbl?.exhibitor_profile_id !== prof.id) throw new Error("Forbidden");
    }

    // Auto-compute late_minutes when marking present after slot start.
    let lateMinutes = data.lateMinutes ?? null;
    if (data.status === "present" && lateMinutes == null) {
      const { data: m } = await supabaseAdmin
        .from("meetings")
        .select("slot_id, time_slots!inner(start_at)")
        .eq("id", data.meetingId)
        .maybeSingle();
      const startAt = (m as unknown as { time_slots?: { start_at?: string } })
        ?.time_slots?.start_at;
      if (startAt) {
        const diffMin = Math.floor((Date.now() - new Date(startAt).getTime()) / 60000);
        if (diffMin > 0) lateMinutes = Math.min(60, diffMin);
      }
    }

    // upsert via insert (one check-in per meeting expected)
    const { data: existing } = await supabaseAdmin
      .from("meeting_checkins")
      .select("id")
      .eq("meeting_id", data.meetingId)
      .maybeSingle();
    if (existing) {
      await supabaseAdmin
        .from("meeting_checkins")
        .update({ status: data.status, late_minutes: lateMinutes, by_role: byRole })
        .eq("id", existing.id);
      return { id: existing.id, updated: true };
    }
    const { data: row, error } = await supabaseAdmin
      .from("meeting_checkins")
      .insert({
        meeting_id: data.meetingId,
        status: data.status,
        late_minutes: lateMinutes,
        by_role: byRole,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    // mark meeting completed if present
    if (data.status === "present" || data.status === "late") {
      await supabaseAdmin.from("meetings").update({ status: "done" }).eq("id", data.meetingId);
    } else if (data.status === "no_show") {
      await supabaseAdmin.from("meetings").update({ status: "no_show" }).eq("id", data.meetingId);
    }
    return { id: row.id, updated: false };
  });

// ============================================================
// Live operations (KPIs), fill-in suggestions, ops mutations.
// ============================================================

type ProfileLite = {
  id: string;
  full_name: string | null;
  email: string | null;
  company: string | null;
  role: "visitor" | "exhibitor" | "staff" | "admin" | "cliente" | null;
};

async function loadEventOrLatest(eventId?: string | null) {
  if (eventId) {
    const { data } = await supabaseAdmin
      .from("events")
      .select("id, name")
      .eq("id", eventId)
      .maybeSingle();
    return data;
  }
  const { data } = await supabaseAdmin
    .from("events")
    .select("id, name")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

const RISK_MIN = 5;

async function computeLiveOperations(eventIdOpt?: string | null) {
  const event = await loadEventOrLatest(eventIdOpt);
    if (!event) {
      return {
        eventId: null,
        slotCurrent: null,
        slotNext: null,
        kpis: {
          present: 0,
          inMeeting: 0,
          idle: 0,
          atRisk: 0,
          freeTables: 0,
        },
        presentProfiles: [] as Array<ProfileLite & {
          checkinId: string;
          checkinAt: string;
          note: string | null;
          availableForFillin: boolean;
          source: string | null;
        }>,
        inMeetingProfileIds: [] as string[],
        idleProfileIds: [] as string[],
        atRiskMeetings: [] as Array<{
          meetingId: string;
          tableId: string;
          tableNumber: number | null;
          visitorProfileId: string;
          visitorName: string | null;
          exhibitorProfileId: string | null;
          exhibitorCompany: string | null;
          slotStart: string;
          slotEnd: string;
          minutesLate: number;
        }>,
        freeTables: [] as Array<{
          tableId: string;
          tableNumber: number | null;
          exhibitorProfileId: string | null;
          exhibitorName: string | null;
          exhibitorCompany: string | null;
        }>,
      };
    }
    const eventId = event.id as string;

    const nowIso = new Date().toISOString();

    // Current + next slot for the event.
    const [{ data: slotCurr }, { data: slotNextArr }] = await Promise.all([
      supabaseAdmin
        .from("time_slots")
        .select("id, start_at, end_at")
        .eq("event_id", eventId)
        .eq("is_active", true)
        .lte("start_at", nowIso)
        .gt("end_at", nowIso)
        .order("start_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("time_slots")
        .select("id, start_at, end_at")
        .eq("event_id", eventId)
        .eq("is_active", true)
        .gt("start_at", nowIso)
        .order("start_at", { ascending: true })
        .limit(1),
    ]);
    const slotCurrent = slotCurr ?? null;
    const slotNext = (slotNextArr ?? [])[0] ?? null;

    // General check-ins for the event.
    const { data: checkins } = await supabaseAdmin
      .from("general_checkins")
      .select(
        "id, profile_id, checkin_at, note, available_for_fillin, source",
      )
      .eq("event_id", eventId);
    const checkinList = checkins ?? [];
    const presentIds = Array.from(
      new Set(checkinList.map((c) => c.profile_id as string)),
    );

    // All active event tables.
    const { data: tables } = await supabaseAdmin
      .from("event_tables")
      .select("id, table_number, exhibitor_profile_id")
      .eq("event_id", eventId);
    const tableList = tables ?? [];

    // Meetings scheduled during current slot (for in-meeting + free tables).
    let scheduledCurrent: Array<{
      id: string;
      visitor_profile_id: string | null;
      table_id: string | null;
      slot_id: string | null;
    }> = [];
    if (slotCurrent) {
      const { data: sched } = await supabaseAdmin
        .from("meetings")
        .select("id, visitor_profile_id, table_id, slot_id")
        .eq("event_id", eventId)
        .eq("status", "scheduled")
        .eq("slot_id", slotCurrent.id);
      scheduledCurrent = sched ?? [];
    }

    // "In meeting now" = visitors + exhibitors of scheduled meetings this slot.
    const inMeetingSet = new Set<string>();
    const busyTableIds = new Set<string>();
    for (const m of scheduledCurrent) {
      if (m.visitor_profile_id) inMeetingSet.add(m.visitor_profile_id);
      if (m.table_id) {
        busyTableIds.add(m.table_id);
        const t = tableList.find((tt) => tt.id === m.table_id);
        if (t?.exhibitor_profile_id) inMeetingSet.add(t.exhibitor_profile_id);
      }
    }

    // Roles map for present profiles: filter idle to visitor|exhibitor only.
    const { data: rolesRows } = presentIds.length
      ? await supabaseAdmin
          .from("profiles")
          .select("id, full_name, email, company_id, auth_user_id")
          .in("id", presentIds)
      : { data: [] as Array<{
          id: string;
          full_name: string | null;
          email: string | null;
          company_id: string | null;
          auth_user_id: string | null;
        }> };
    const profs = rolesRows ?? [];
    const authIds = profs
      .map((p) => p.auth_user_id)
      .filter(Boolean) as string[];
    const { data: userRoles } = authIds.length
      ? await supabaseAdmin
          .from("user_roles")
          .select("user_id, role")
          .in("user_id", authIds)
      : { data: [] as Array<{ user_id: string; role: string }> };
    const rolesByAuth = new Map<string, string[]>();
    for (const r of userRoles ?? []) {
      const arr = rolesByAuth.get(r.user_id) ?? [];
      arr.push(r.role);
      rolesByAuth.set(r.user_id, arr);
    }
    const compIds = Array.from(
      new Set(profs.map((p) => p.company_id).filter(Boolean) as string[]),
    );
    const { data: comps } = compIds.length
      ? await supabaseAdmin
          .from("companies")
          .select("id, trade_name")
          .in("id", compIds)
      : { data: [] as Array<{ id: string; trade_name: string }> };
    const compMap = new Map(
      (comps ?? []).map((c) => [c.id as string, c.trade_name as string]),
    );
    const checkinByProfile = new Map<string, (typeof checkinList)[number]>();
    for (const c of checkinList) {
      if (!checkinByProfile.has(c.profile_id as string))
        checkinByProfile.set(c.profile_id as string, c);
    }

    const primaryRole = (roles: string[] | undefined) => {
      if (!roles || roles.length === 0) return null;
      const order = ["admin", "staff", "cliente", "exhibitor", "visitor"];
      for (const r of order) if (roles.includes(r)) return r as ProfileLite["role"];
      return null;
    };

    const presentProfiles = profs.map((p) => {
      const c = checkinByProfile.get(p.id as string);
      const role = primaryRole(rolesByAuth.get(p.auth_user_id ?? ""));
      return {
        id: p.id as string,
        full_name: p.full_name,
        email: p.email,
        company: p.company_id ? compMap.get(p.company_id) ?? null : null,
        role,
        checkinId: c?.id as string,
        checkinAt: c?.checkin_at as string,
        note: (c?.note as string | null) ?? null,
        availableForFillin: (c?.available_for_fillin as boolean | null) ?? true,
        source: (c?.source as string | null) ?? null,
      };
    });

    const opProfiles = presentProfiles.filter(
      (p) => p.role === "visitor" || p.role === "exhibitor",
    );
    const idleProfileIds = opProfiles
      .filter((p) => !inMeetingSet.has(p.id))
      .map((p) => p.id);

    // Free tables in current slot = active tables not busy.
    const freeTables = slotCurrent
      ? tableList
          .filter((t) => !busyTableIds.has(t.id as string))
          .map((t) => ({
            tableId: t.id as string,
            tableNumber: (t.table_number as number | null) ?? null,
            exhibitorProfileId: (t.exhibitor_profile_id as string | null) ?? null,
            exhibitorName: null as string | null,
            exhibitorCompany: null as string | null,
          }))
      : [];
    const freeExhibitorIds = Array.from(
      new Set(
        freeTables
          .map((t) => t.exhibitorProfileId)
          .filter(Boolean) as string[],
      ),
    );
    if (freeExhibitorIds.length) {
      const { data: exhProfs } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, company_id")
        .in("id", freeExhibitorIds);
      const exhCompIds = Array.from(
        new Set(
          (exhProfs ?? [])
            .map((p) => p.company_id)
            .filter(Boolean) as string[],
        ),
      );
      const { data: exhComps } = exhCompIds.length
        ? await supabaseAdmin
            .from("companies")
            .select("id, trade_name")
            .in("id", exhCompIds)
        : { data: [] as Array<{ id: string; trade_name: string }> };
      const exhCompMap = new Map(
        (exhComps ?? []).map((c) => [c.id as string, c.trade_name as string]),
      );
      for (const t of freeTables) {
        const p = (exhProfs ?? []).find((x) => x.id === t.exhibitorProfileId);
        if (p) {
          t.exhibitorName = p.full_name ?? null;
          t.exhibitorCompany = p.company_id
            ? exhCompMap.get(p.company_id) ?? null
            : null;
        }
      }
    }

    // Reuniões em risco: scheduled, slot started > RISK_MIN min ago, sem meeting_checkins.
    const riskCutoffIso = new Date(Date.now() - RISK_MIN * 60_000).toISOString();
    const { data: riskRows } = await supabaseAdmin
      .from("meetings")
      .select(
        "id, table_id, visitor_profile_id, slot_id, time_slots!inner(start_at, end_at)",
      )
      .eq("event_id", eventId)
      .eq("status", "scheduled")
      .lt("time_slots.start_at", riskCutoffIso);
    const riskCandidates = (riskRows ?? []) as unknown as Array<{
      id: string;
      table_id: string;
      visitor_profile_id: string;
      slot_id: string;
      time_slots: { start_at: string; end_at: string };
    }>;
    const riskIds = riskCandidates.map((m) => m.id);
    const { data: chksExisting } = riskIds.length
      ? await supabaseAdmin
          .from("meeting_checkins")
          .select("meeting_id")
          .in("meeting_id", riskIds)
      : { data: [] as Array<{ meeting_id: string }> };
    const checkedSet = new Set((chksExisting ?? []).map((c) => c.meeting_id));
    const atRiskRaw = riskCandidates.filter((m) => !checkedSet.has(m.id));
    const riskVisitorIds = Array.from(
      new Set(atRiskRaw.map((m) => m.visitor_profile_id).filter(Boolean)),
    );
    const riskTableIds = Array.from(
      new Set(atRiskRaw.map((m) => m.table_id).filter(Boolean)),
    );
    const [{ data: rvProfs }, { data: rTables }] = await Promise.all([
      riskVisitorIds.length
        ? supabaseAdmin
            .from("profiles")
            .select("id, full_name")
            .in("id", riskVisitorIds)
        : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null }> }),
      riskTableIds.length
        ? supabaseAdmin
            .from("event_tables")
            .select("id, table_number, exhibitor_profile_id")
            .in("id", riskTableIds)
        : Promise.resolve({ data: [] as Array<{ id: string; table_number: number | null; exhibitor_profile_id: string | null }> }),
    ]);
    const rExhIds = Array.from(
      new Set(
        (rTables ?? [])
          .map((t) => t.exhibitor_profile_id)
          .filter(Boolean) as string[],
      ),
    );
    const { data: rExhProfs } = rExhIds.length
      ? await supabaseAdmin
          .from("profiles")
          .select("id, company_id")
          .in("id", rExhIds)
      : { data: [] as Array<{ id: string; company_id: string | null }> };
    const rExhCompIds = Array.from(
      new Set(
        (rExhProfs ?? [])
          .map((p) => p.company_id)
          .filter(Boolean) as string[],
      ),
    );
    const { data: rExhComps } = rExhCompIds.length
      ? await supabaseAdmin
          .from("companies")
          .select("id, trade_name")
          .in("id", rExhCompIds)
      : { data: [] as Array<{ id: string; trade_name: string }> };
    const rExhCompMap = new Map(
      (rExhComps ?? []).map((c) => [c.id as string, c.trade_name as string]),
    );

    const atRiskMeetings = atRiskRaw.map((m) => {
      const t = (rTables ?? []).find((tt) => tt.id === m.table_id);
      const exhProf = t?.exhibitor_profile_id
        ? (rExhProfs ?? []).find((p) => p.id === t.exhibitor_profile_id)
        : null;
      const exhCompany = exhProf?.company_id
        ? rExhCompMap.get(exhProf.company_id) ?? null
        : null;
      const start = m.time_slots.start_at;
      const minutesLate = Math.floor(
        (Date.now() - new Date(start).getTime()) / 60_000,
      );
      return {
        meetingId: m.id,
        tableId: m.table_id,
        tableNumber: t?.table_number ?? null,
        visitorProfileId: m.visitor_profile_id,
        visitorName:
          (rvProfs ?? []).find((p) => p.id === m.visitor_profile_id)?.full_name ??
          null,
        exhibitorProfileId: t?.exhibitor_profile_id ?? null,
        exhibitorCompany: exhCompany,
        slotStart: start,
        slotEnd: m.time_slots.end_at,
        minutesLate,
      };
    });

    return {
      eventId,
      slotCurrent,
      slotNext,
      kpis: {
        present: presentIds.length,
        inMeeting: inMeetingSet.size,
        idle: idleProfileIds.length,
        atRisk: atRiskMeetings.length,
        freeTables: freeTables.length,
      },
      presentProfiles,
      inMeetingProfileIds: Array.from(inMeetingSet),
      idleProfileIds,
      atRiskMeetings,
      freeTables,
    };
  });

// Fill-in suggestions: idle visitors × free tables at a given slot.
export const suggestFillins = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        eventId: z.string().uuid(),
        slotId: z.string().uuid(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    if (!(await isAdminOrStaff(context.userId)))
      throw new Error("Forbidden: admin/staff only");

    const live = await (getLiveOperations as unknown as (args: {
      data: { eventId: string };
    }) => Promise<Awaited<ReturnType<typeof loadEventOrLatest>> extends null
      ? never
      : {
          idleProfileIds: string[];
          presentProfiles: Array<{
            id: string;
            full_name: string | null;
            company: string | null;
            role: string | null;
            availableForFillin: boolean;
          }>;
          freeTables: Array<{
            tableId: string;
            tableNumber: number | null;
            exhibitorProfileId: string | null;
            exhibitorName: string | null;
            exhibitorCompany: string | null;
          }>;
        }>)({ data: { eventId: data.eventId } });

    const idleVisitors = live.presentProfiles.filter(
      (p) =>
        p.role === "visitor" &&
        p.availableForFillin &&
        live.idleProfileIds.includes(p.id),
    );
    // Free tables filter: exhibitor must be present AND available_for_fillin.
    const availableExhIds = new Set(
      live.presentProfiles
        .filter((p) => p.role === "exhibitor" && p.availableForFillin)
        .map((p) => p.id),
    );
    const usableTables = live.freeTables.filter(
      (t) => t.exhibitorProfileId && availableExhIds.has(t.exhibitorProfileId),
    );

    // Simple ordering: alphabetical fallback pairings (cartesian, small N).
    const pairs: Array<{
      visitorId: string;
      visitorName: string | null;
      visitorCompany: string | null;
      tableId: string;
      tableNumber: number | null;
      exhibitorProfileId: string;
      exhibitorName: string | null;
      exhibitorCompany: string | null;
      score: number;
    }> = [];
    for (const v of idleVisitors) {
      for (const t of usableTables) {
        pairs.push({
          visitorId: v.id,
          visitorName: v.full_name,
          visitorCompany: v.company,
          tableId: t.tableId,
          tableNumber: t.tableNumber,
          exhibitorProfileId: t.exhibitorProfileId!,
          exhibitorName: t.exhibitorName,
          exhibitorCompany: t.exhibitorCompany,
          score: 0,
        });
      }
    }
    pairs.sort((a, b) => {
      const av = a.visitorName ?? "";
      const bv = b.visitorName ?? "";
      if (av !== bv) return av.localeCompare(bv);
      return (a.tableNumber ?? 0) - (b.tableNumber ?? 0);
    });
    return { slotId: data.slotId, pairs };
  });

export const setAvailableForFillin = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        checkinId: z.string().uuid(),
        value: z.boolean(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    if (!(await isAdminOrStaff(context.userId)))
      throw new Error("Forbidden: admin/staff only");
    const { data: existing } = await supabaseAdmin
      .from("general_checkins")
      .select("id, event_id, profile_id")
      .eq("id", data.checkinId)
      .maybeSingle();
    if (!existing) throw new Error("Check-in not found");
    const { error } = await supabaseAdmin
      .from("general_checkins")
      .update({ available_for_fillin: data.value } as never)
      .eq("id", data.checkinId);
    if (error) throw new Error(error.message);
    await audit(
      context.userId,
      existing.event_id as string,
      "checkin.available_for_fillin",
      { checkin_id: data.checkinId, value: data.value, profile_id: existing.profile_id },
    );
    return { ok: true };
  });

export const setCheckinNote = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        checkinId: z.string().uuid(),
        note: z.string().trim().max(140).nullable(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    if (!(await isAdminOrStaff(context.userId)))
      throw new Error("Forbidden: admin/staff only");
    const { data: existing } = await supabaseAdmin
      .from("general_checkins")
      .select("id, event_id")
      .eq("id", data.checkinId)
      .maybeSingle();
    if (!existing) throw new Error("Check-in not found");
    const value = data.note && data.note.length > 0 ? data.note : null;
    const { error } = await supabaseAdmin
      .from("general_checkins")
      .update({ note: value } as never)
      .eq("id", data.checkinId);
    if (error) throw new Error(error.message);
    await audit(
      context.userId,
      existing.event_id as string,
      "checkin.note",
      { checkin_id: data.checkinId, has_note: !!value },
    );
    return { ok: true };
  });

export const undoGeneralCheckIn = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ checkinId: z.string().uuid() }).parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    if (!(await isAdmin(context.userId)))
      throw new Error("Forbidden: admin only");
    const { data: existing } = await supabaseAdmin
      .from("general_checkins")
      .select("id, event_id, profile_id")
      .eq("id", data.checkinId)
      .maybeSingle();
    if (!existing) throw new Error("Check-in not found");
    const { error } = await supabaseAdmin
      .from("general_checkins")
      .delete()
      .eq("id", data.checkinId);
    if (error) throw new Error(error.message);
    await audit(
      context.userId,
      existing.event_id as string,
      "checkin.general.undone",
      { checkin_id: data.checkinId, profile_id: existing.profile_id },
    );
    return { ok: true };
  });