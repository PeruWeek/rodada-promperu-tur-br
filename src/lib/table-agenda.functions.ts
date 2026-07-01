import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type MyTableAgendaRow = {
  meeting_id: string;
  status: string;
  start_at: string | null;
  end_at: string | null;
  visitor_profile_id: string;
  visitor_name: string;
  company_name: string;
  company_website: string | null;
  city: string | null;
  country_code: string | null;
  checkin_status: string | null;
};

export type MyTableAgendaResult = {
  table: { id: string; table_number: number } | null;
  rows: MyTableAgendaRow[];
};

/**
 * Exhibitor view of their own table agenda.
 * Uses the admin client AFTER verifying caller owns the table, so the data
 * source matches the staff/admin bulk exports (no RLS skew).
 */
export const getMyTableAgenda = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyTableAgendaResult> => {
    const { userId } = context;

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("auth_user_id", userId)
      .maybeSingle();
    if (!profile) return { table: null, rows: [] };

    const { data: tbl } = await supabaseAdmin
      .from("event_tables")
      .select("id, table_number, event_id")
      .eq("exhibitor_profile_id", profile.id)
      .maybeSingle();
    if (!tbl) return { table: null, rows: [] };

    const { data: meetings } = await supabaseAdmin
      .from("meetings")
      .select("id, status, slot_id, visitor_profile_id")
      .eq("table_id", tbl.id)
      .in("status", ["scheduled", "done", "no_show"]);

    const list = meetings ?? [];
    if (list.length === 0) {
      return { table: { id: tbl.id, table_number: tbl.table_number }, rows: [] };
    }

    const slotIds = Array.from(new Set(list.map((m) => m.slot_id)));
    const visitorIds = Array.from(new Set(list.map((m) => m.visitor_profile_id)));
    const meetingIds = list.map((m) => m.id);

    const [{ data: slots }, { data: visitors }, { data: checkins }] = await Promise.all([
      supabaseAdmin.from("time_slots").select("id, start_at, end_at").in("id", slotIds),
      supabaseAdmin.from("profiles").select("id, full_name, company_id").in("id", visitorIds),
      supabaseAdmin
        .from("meeting_checkins")
        .select("meeting_id, status")
        .in("meeting_id", meetingIds),
    ]);

    const companyIds = Array.from(
      new Set((visitors ?? []).map((v) => v.company_id).filter(Boolean) as string[]),
    );
    const { data: companies } = companyIds.length
      ? await supabaseAdmin
          .from("companies")
          .select("id, trade_name, website, city, country_code")
          .in("id", companyIds)
      : { data: [] as Array<{ id: string; trade_name: string; website: string | null; city: string | null; country_code: string | null }> };

    const rows: MyTableAgendaRow[] = list
      .map((m) => {
        const slot = (slots ?? []).find((s) => s.id === m.slot_id);
        const visitor = (visitors ?? []).find((v) => v.id === m.visitor_profile_id);
        const company = visitor
          ? (companies ?? []).find((c) => c.id === visitor.company_id)
          : undefined;
        const checkin = (checkins ?? []).find((c) => c.meeting_id === m.id);
        // Technical guarantee: the rendered time comes from the canonical
        // slot row identified by meeting.slot_id. Any missing slot join is
        // logged so divergences surface immediately instead of silently
        // rendering "—" or the wrong value.
        if (!slot) {
          // eslint-disable-next-line no-console
          console.warn("[table-agenda] missing slot for meeting", {
            meetingId: m.id,
            slotId: m.slot_id,
          });
        }
        return {
          meeting_id: m.id,
          status: m.status as string,
          start_at: slot?.start_at ?? null,
          end_at: slot?.end_at ?? null,
          visitor_profile_id: m.visitor_profile_id,
          visitor_name: visitor?.full_name ?? "—",
          company_name: company?.trade_name ?? "—",
          company_website: company?.website ?? null,
          city: company?.city ?? null,
          country_code: company?.country_code ?? null,
          checkin_status: (checkin?.status as string | undefined) ?? null,
        };
      })
      .sort((a, b) => (a.start_at ?? "").localeCompare(b.start_at ?? ""));

    return { table: { id: tbl.id, table_number: tbl.table_number }, rows };
  });