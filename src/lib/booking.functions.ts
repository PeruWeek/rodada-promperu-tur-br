import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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

    const { data: profile, error: profErr } = await supabase
      .from("profiles")
      .select("id, full_name, company_id")
      .eq("auth_user_id", userId)
      .maybeSingle();
    if (profErr) throw profErr;
    if (!profile) throw new Error("Profile not found");

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
      .select("start_at")
      .eq("id", data.slotId)
      .maybeSingle();

    const { data: company } = profile.company_id
      ? await supabaseAdmin
          .from("companies")
          .select("trade_name")
          .eq("id", profile.company_id)
          .maybeSingle()
      : { data: null };

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

    return { id: meeting.id };
  });

export const cancelMeeting = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ meetingId: z.string().uuid(), reason: z.string().max(500).optional() }).parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("auth_user_id", userId)
      .maybeSingle();
    if (!profile) throw new Error("Profile not found");

    const { data: updated, error: updErr } = await supabase
      .from("meetings")
      .update({ status: "cancelled", cancel_reason: data.reason ?? null })
      .eq("id", data.meetingId)
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
      .select("start_at")
      .eq("id", updated.slot_id)
      .maybeSingle();

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

    return { ok: true };
  });