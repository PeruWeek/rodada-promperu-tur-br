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

// List of profiles eligible for general check-in at an event.
// Eligibility rules (enforced server-side):
//  - registration completed for the participant's company at this event
//    (company_event_pipeline.registration_status in cadastro_concluido / aprovado)
//  - at least one meeting in the event with status scheduled / done / no_show
//    (the participant is either the visitor or the table's exhibitor)
// `is_active` alone is NOT sufficient.
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
    if (!eventId) return { eventId: null, profiles: [] as Array<{ id: string; auth_user_id: string | null; full_name: string | null; email: string | null; company_id: string | null; company: string | null }> };

    // 1) Meetings of the event with relevant statuses → eligible profile ids.
    const { data: meetings } = await supabaseAdmin
      .from("meetings")
      .select("visitor_profile_id, table_id, status")
      .eq("event_id", eventId)
      .in("status", ["scheduled", "done", "no_show"]);
    const visitorIds = new Set<string>();
    const tableIds = new Set<string>();
    for (const m of meetings ?? []) {
      if (m.visitor_profile_id) visitorIds.add(m.visitor_profile_id as string);
      if (m.table_id) tableIds.add(m.table_id as string);
    }
    const exhibitorIds = new Set<string>();
    if (tableIds.size > 0) {
      const { data: tables } = await supabaseAdmin
        .from("event_tables")
        .select("id, exhibitor_profile_id")
        .in("id", Array.from(tableIds));
      for (const t of tables ?? []) {
        if (t.exhibitor_profile_id) exhibitorIds.add(t.exhibitor_profile_id as string);
      }
    }
    const candidateIds = new Set<string>([...visitorIds, ...exhibitorIds]);
    if (candidateIds.size === 0) return { eventId, profiles: [] };

    // 2) Restrict to companies with completed registration in this event.
    const { data: pipeRows } = await supabaseAdmin
      .from("company_event_pipeline")
      .select("company_id, registration_status")
      .eq("event_id", eventId)
      .in("registration_status", ["cadastro_concluido", "aprovado"]);
    const eligibleCompanies = new Set<string>(
      (pipeRows ?? []).map((r) => r.company_id as string),
    );

    // 3) Load candidate profiles, filter by eligible company and search term.
    let pq = supabaseAdmin
      .from("profiles")
      .select("id, auth_user_id, full_name, email, company_id")
      .in("id", Array.from(candidateIds))
      .order("full_name")
      .limit(data.limit ?? 200);
    if (data.q?.trim()) {
      const term = `%${data.q.trim()}%`;
      pq = pq.or(`full_name.ilike.${term},email.ilike.${term}`);
    }
    const { data: profs, error } = await pq;
    if (error) throw new Error(error.message);
    const eligibleProfiles = (profs ?? []).filter(
      (p) => p.company_id && eligibleCompanies.has(p.company_id as string),
    );

    // 4) Resolve company names.
    const compIds = Array.from(
      new Set(eligibleProfiles.map((p) => p.company_id).filter(Boolean) as string[]),
    );
    const { data: comps } = compIds.length
      ? await supabaseAdmin.from("companies").select("id, trade_name").in("id", compIds)
      : { data: [] as Array<{ id: string; trade_name: string }> };
    const compMap = new Map((comps ?? []).map((c) => [c.id as string, c.trade_name as string]));

    return {
      eventId,
      profiles: eligibleProfiles.map((p) => ({
        id: p.id as string,
        auth_user_id: (p.auth_user_id as string) ?? null,
        full_name: (p.full_name as string) ?? null,
        email: (p.email as string) ?? null,
        company_id: (p.company_id as string) ?? null,
        company: p.company_id ? compMap.get(p.company_id as string) ?? null : null,
      })),
    };
  });

// General event check-in (admin/staff scans/marks a profile as present)
export const generalCheckIn = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        eventId: z.string().uuid(),
        profileId: z.string().uuid(),
        method: z.enum(["manual", "qr"]).default("manual"),
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
        checked_in_by_profile_id: callerProfile?.id ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
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
        .select("id, table_id")
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

    // upsert via insert (one check-in per meeting expected)
    const { data: existing } = await supabaseAdmin
      .from("meeting_checkins")
      .select("id")
      .eq("meeting_id", data.meetingId)
      .maybeSingle();
    if (existing) {
      await supabaseAdmin
        .from("meeting_checkins")
        .update({ status: data.status, late_minutes: data.lateMinutes ?? null, by_role: byRole })
        .eq("id", existing.id);
      return { id: existing.id, updated: true };
    }
    const { data: row, error } = await supabaseAdmin
      .from("meeting_checkins")
      .insert({
        meeting_id: data.meetingId,
        status: data.status,
        late_minutes: data.lateMinutes ?? null,
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