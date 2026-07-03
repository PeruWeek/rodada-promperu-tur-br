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
    payload,
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