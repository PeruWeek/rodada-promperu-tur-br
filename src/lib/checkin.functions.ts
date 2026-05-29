import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function isAdminOrStaff(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  return (data ?? []).some((r) => r.role === "admin" || r.role === "staff");
}

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
    if (!(await isAdminOrStaff(context.userId))) throw new Error("Forbidden");
    const { data: existing } = await supabaseAdmin
      .from("general_checkins")
      .select("id")
      .eq("event_id", data.eventId)
      .eq("profile_id", data.profileId)
      .maybeSingle();
    if (existing) return { id: existing.id, alreadyCheckedIn: true };
    const { data: row, error } = await supabaseAdmin
      .from("general_checkins")
      .insert({ event_id: data.eventId, profile_id: data.profileId, method: data.method })
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
    const isAdmin = await isAdminOrStaff(userId);
    let byRole: "admin" | "staff" | "exhibitor" = "exhibitor";
    if (isAdmin) {
      byRole = "admin";
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
      await supabaseAdmin.from("meetings").update({ status: "completed" }).eq("id", data.meetingId);
    } else if (data.status === "no_show") {
      await supabaseAdmin.from("meetings").update({ status: "no_show" }).eq("id", data.meetingId);
    }
    return { id: row.id, updated: false };
  });