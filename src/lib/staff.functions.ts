import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function getMyRoles(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  return (data ?? []).map((r) => r.role as "admin" | "staff" | "exhibitor" | "visitor" | "cliente");
}

async function getMyProfileId(userId: string) {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  return data?.id ?? null;
}

async function assertAdmin(userId: string) {
  const roles = await getMyRoles(userId);
  if (!roles.includes("admin")) throw new Error("Forbidden: admin only");
}

async function assertAdminOrStaff(userId: string) {
  const roles = await getMyRoles(userId);
  if (!roles.includes("admin") && !roles.includes("staff")) throw new Error("Forbidden");
}

async function getCurrentEventId(explicit?: string) {
  if (explicit) return explicit;
  const { data } = await supabaseAdmin
    .from("events")
    .select("id")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

export const listStaffAssignments = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ eventId: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const eventId = await getCurrentEventId(data.eventId);
    if (!eventId) return { eventId: null, tables: [], staffOptions: [], assignments: [] };
    const [{ data: tables }, { data: assignments }, { data: staffRoles }] = await Promise.all([
      supabaseAdmin
        .from("event_tables")
        .select("id, table_number, exhibitor_profile_id")
        .eq("event_id", eventId)
        .order("table_number"),
      supabaseAdmin
        .from("staff_table_assignments")
        .select("id, table_id, staff_profile_id")
        .eq("event_id", eventId),
      supabaseAdmin.from("user_roles").select("user_id").eq("role", "staff"),
    ]);
    const staffAuthIds = (staffRoles ?? []).map((r) => r.user_id);
    const { data: staffProfiles } = staffAuthIds.length
      ? await supabaseAdmin
          .from("profiles")
          .select("id, full_name, email")
          .in("auth_user_id", staffAuthIds)
          .order("full_name")
      : { data: [] as Array<{ id: string; full_name: string; email: string | null }> };
    return {
      eventId,
      tables: tables ?? [],
      staffOptions: staffProfiles ?? [],
      assignments: assignments ?? [],
    };
  });

export const setStaffTableAssignment = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        eventId: z.string().uuid(),
        tableId: z.string().uuid(),
        staffProfileId: z.string().uuid(),
        assigned: z.boolean(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    if (data.assigned) {
      const { data: existing } = await supabaseAdmin
        .from("staff_table_assignments")
        .select("id")
        .eq("event_id", data.eventId)
        .eq("table_id", data.tableId)
        .eq("staff_profile_id", data.staffProfileId)
        .maybeSingle();
      if (!existing) {
        const { error } = await supabaseAdmin.from("staff_table_assignments").insert({
          event_id: data.eventId,
          table_id: data.tableId,
          staff_profile_id: data.staffProfileId,
        });
        if (error) throw new Error(error.message);
      }
    } else {
      const { error } = await supabaseAdmin
        .from("staff_table_assignments")
        .delete()
        .eq("event_id", data.eventId)
        .eq("table_id", data.tableId)
        .eq("staff_profile_id", data.staffProfileId);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const getMyStaffAgenda = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        eventId: z.string().uuid().optional(),
        staffProfileId: z.string().uuid().optional(),
      })
      .parse(input ?? {}),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdminOrStaff(context.userId);
    const roles = await getMyRoles(context.userId);
    const isAdmin = roles.includes("admin");
    const eventId = await getCurrentEventId(data.eventId);
    if (!eventId) return { eventId: null, meetings: [], tables: [] };

    let targetProfileId: string | null = null;
    if (isAdmin && data.staffProfileId) {
      targetProfileId = data.staffProfileId;
    } else if (!isAdmin) {
      targetProfileId = await getMyProfileId(context.userId);
      if (!targetProfileId) return { eventId, meetings: [], tables: [] };
    }

    // Tables filter
    let tableIds: string[] = [];
    if (targetProfileId) {
      const { data: assigns } = await supabaseAdmin
        .from("staff_table_assignments")
        .select("table_id")
        .eq("event_id", eventId)
        .eq("staff_profile_id", targetProfileId);
      tableIds = (assigns ?? []).map((a) => a.table_id);
      if (tableIds.length === 0) return { eventId, meetings: [], tables: [] };
    }

    let mq = supabaseAdmin
      .from("meetings")
      .select("id, table_id, slot_id, visitor_profile_id, status")
      .eq("event_id", eventId)
      .eq("status", "scheduled");
    if (tableIds.length) mq = mq.in("table_id", tableIds);
    const { data: meetings, error: mErr } = await mq;
    if (mErr) throw new Error(mErr.message);
    const meetingsRows = meetings ?? [];
    if (meetingsRows.length === 0) {
      const { data: tablesRows } = await supabaseAdmin
        .from("event_tables")
        .select("id, table_number, exhibitor_profile_id")
        .in("id", tableIds.length ? tableIds : ["00000000-0000-0000-0000-000000000000"]);
      return { eventId, meetings: [], tables: tablesRows ?? [] };
    }

    const slotIds = Array.from(new Set(meetingsRows.map((m) => m.slot_id)));
    const allTableIds = Array.from(new Set(meetingsRows.map((m) => m.table_id)));
    const visitorProfileIds = Array.from(new Set(meetingsRows.map((m) => m.visitor_profile_id)));
    const meetingIds = meetingsRows.map((m) => m.id);

    const [{ data: slots }, { data: tablesRows }, { data: visitors }, { data: checkins }] =
      await Promise.all([
        supabaseAdmin.from("time_slots").select("id, start_at, end_at").in("id", slotIds),
        supabaseAdmin
          .from("event_tables")
          .select("id, table_number, exhibitor_profile_id")
          .in("id", allTableIds),
        supabaseAdmin
          .from("profiles")
          .select("id, full_name, company_id")
          .in("id", visitorProfileIds),
        supabaseAdmin
          .from("meeting_checkins")
          .select("meeting_id, status, checkin_at")
          .in("meeting_id", meetingIds),
      ]);

    const companyIds = (visitors ?? [])
      .map((v) => v.company_id)
      .filter(Boolean) as string[];
    const { data: companies } = companyIds.length
      ? await supabaseAdmin.from("companies").select("id, trade_name").in("id", companyIds)
      : { data: [] as Array<{ id: string; trade_name: string }> };

    const exhProfileIds = (tablesRows ?? [])
      .map((t) => t.exhibitor_profile_id)
      .filter(Boolean) as string[];
    const { data: exhibitorProfiles } = exhProfileIds.length
      ? await supabaseAdmin
          .from("profiles")
          .select("id, full_name, company_id")
          .in("id", exhProfileIds)
      : { data: [] as Array<{ id: string; full_name: string; company_id: string | null }> };
    const exhCompanyIds = (exhibitorProfiles ?? [])
      .map((p) => p.company_id)
      .filter(Boolean) as string[];
    const { data: exhCompanies } = exhCompanyIds.length
      ? await supabaseAdmin.from("companies").select("id, trade_name").in("id", exhCompanyIds)
      : { data: [] as Array<{ id: string; trade_name: string }> };

    const enriched = meetingsRows.map((m) => {
      const slot = (slots ?? []).find((s) => s.id === m.slot_id);
      const tbl = (tablesRows ?? []).find((t) => t.id === m.table_id);
      const visitor = (visitors ?? []).find((v) => v.id === m.visitor_profile_id);
      const visitorCompany = visitor
        ? (companies ?? []).find((c) => c.id === visitor.company_id)
        : null;
      const exhProf = tbl?.exhibitor_profile_id
        ? (exhibitorProfiles ?? []).find((p) => p.id === tbl.exhibitor_profile_id)
        : null;
      const exhCompany = exhProf?.company_id
        ? (exhCompanies ?? []).find((c) => c.id === exhProf.company_id)
        : null;
      const checkin = (checkins ?? []).find((c) => c.meeting_id === m.id) ?? null;
      return {
        id: m.id,
        status: m.status,
        table_id: m.table_id,
        table_number: tbl?.table_number ?? null,
        slot_id: m.slot_id,
        start_at: slot?.start_at ?? null,
        end_at: slot?.end_at ?? null,
        visitor_name: visitor?.full_name ?? null,
        visitor_company: visitorCompany?.trade_name ?? null,
        exhibitor_name: exhProf?.full_name ?? null,
        exhibitor_company: exhCompany?.trade_name ?? null,
        checkin_status: checkin?.status ?? null,
        checkin_at: checkin?.checkin_at ?? null,
      };
    });
    enriched.sort((a, b) => (a.start_at ?? "").localeCompare(b.start_at ?? ""));

    return {
      eventId,
      meetings: enriched,
      tables: tablesRows ?? [],
    };
  });

export const listStaffOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "staff");
    const ids = (roles ?? []).map((r) => r.user_id);
    if (!ids.length) return { staff: [] };
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, auth_user_id")
      .in("auth_user_id", ids)
      .order("full_name");
    return { staff: profs ?? [] };
  });