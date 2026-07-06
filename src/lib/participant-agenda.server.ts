/* eslint-disable @typescript-eslint/no-explicit-any */
// Server-only pure helper for the single-profile "agenda" view.
//
// Extracted from the original `getParticipantAgenda` server function so it
// can be reused by the agenda-delivery email campaign flow
// (`src/lib/agenda-campaigns.server.ts` → `renderAgendaPdfFor`) WITHOUT
// creating a parallel source of truth. `getParticipantAgenda` is now a
// thin wrapper that calls `buildParticipantAgendaData` with the admin
// client.

export type ParticipantAgendaRow = {
  time: string;
  withName: string;
  table: string;
  location: string;
  website: string | null;
};

export type BuildParticipantAgendaResult = {
  eventId: string | null;
  profileName: string;
  role: "exhibitor" | "visitor" | null;
  tableNumber: string | null;
  rows: ParticipantAgendaRow[];
};

export async function buildParticipantAgendaData(opts: {
  supabase: any;
  eventId: string;
  profileId: string;
}): Promise<BuildParticipantAgendaResult> {
  const { supabase, eventId, profileId } = opts;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("id", profileId)
    .maybeSingle();
  const profileName = profile?.full_name ?? "—";

  const { data: ownedTables } = await supabase
    .from("event_tables")
    .select("id, table_number")
    .eq("event_id", eventId)
    .eq("exhibitor_profile_id", profileId);
  const isExhibitor = (ownedTables ?? []).length > 0;
  const ownTable = (ownedTables ?? [])[0];

  let meetingsQ = supabase
    .from("meetings")
    .select("id, table_id, slot_id, visitor_profile_id, status")
    .eq("event_id", eventId)
    .eq("status", "scheduled");
  if (isExhibitor) {
    const tableIds = (ownedTables ?? []).map((t: { id: string }) => t.id);
    meetingsQ = meetingsQ.in("table_id", tableIds);
  } else {
    meetingsQ = meetingsQ.eq("visitor_profile_id", profileId);
  }
  const { data: meetings, error: mErr } = await meetingsQ;
  if (mErr) throw new Error(mErr.message);
  const rows = meetings ?? [];
  if (rows.length === 0) {
    return {
      eventId,
      profileName,
      role: isExhibitor ? "exhibitor" : "visitor",
      tableNumber: ownTable?.table_number != null ? String(ownTable.table_number) : null,
      rows: [],
    };
  }

  const slotIds = Array.from(new Set(rows.map((m: any) => m.slot_id)));
  const tableIds = Array.from(new Set(rows.map((m: any) => m.table_id)));
  const visitorIds = Array.from(new Set(rows.map((m: any) => m.visitor_profile_id)));

  const [{ data: slots }, { data: tables }, { data: visitors }] = await Promise.all([
    supabase.from("time_slots").select("id, start_at, end_at").in("id", slotIds),
    supabase
      .from("event_tables")
      .select("id, table_number, exhibitor_profile_id")
      .in("id", tableIds),
    supabase.from("profiles").select("id, full_name, company_id").in("id", visitorIds),
  ]);

  const exhProfileIds = Array.from(
    new Set(
      ((tables ?? []) as Array<{ exhibitor_profile_id: string | null }>)
        .map((t) => t.exhibitor_profile_id)
        .filter(Boolean) as string[],
    ),
  );
  const { data: exhProfiles } = exhProfileIds.length
    ? await supabase.from("profiles").select("id, full_name, company_id").in("id", exhProfileIds)
    : { data: [] as Array<{ id: string; full_name: string; company_id: string | null }> };
  const allCompanyIds = Array.from(
    new Set(
      [
        ...((visitors ?? []) as Array<{ company_id: string | null }>).map((v) => v.company_id),
        ...((exhProfiles ?? []) as Array<{ company_id: string | null }>).map((p) => p.company_id),
      ].filter(Boolean) as string[],
    ),
  );
  const { data: companies } = allCompanyIds.length
    ? await supabase.from("companies").select("id, trade_name, website").in("id", allCompanyIds)
    : { data: [] as Array<{ id: string; trade_name: string; website: string | null }> };
  const companyName = (id: string | null | undefined) =>
    id ? (companies ?? []).find((c: any) => c.id === id)?.trade_name ?? "—" : "—";
  const companyWebsite = (id: string | null | undefined) =>
    id ? (companies ?? []).find((c: any) => c.id === id)?.website ?? null : null;

  const enriched: (ParticipantAgendaRow & { _start: string })[] = (rows as any[])
    .map((m) => {
      const slot = (slots ?? []).find((s: any) => s.id === m.slot_id);
      const tbl = (tables ?? []).find((t: any) => t.id === m.table_id);
      const counterpartCompanyId: string | null | undefined = isExhibitor
        ? (visitors ?? []).find((x: any) => x.id === m.visitor_profile_id)?.company_id
        : (exhProfiles ?? []).find((p: any) => p.id === tbl?.exhibitor_profile_id)?.company_id;
      const withName = isExhibitor
        ? (() => {
            const v = (visitors ?? []).find((x: any) => x.id === m.visitor_profile_id);
            return v ? `${v.full_name} · ${companyName(v.company_id)}` : "—";
          })()
        : (() => {
            const exh = (exhProfiles ?? []).find((p: any) => p.id === tbl?.exhibitor_profile_id);
            return exh ? `${companyName(exh.company_id)} (${exh.full_name})` : "—";
          })();
      const startStr = slot?.start_at ?? "";
      const endStr = slot?.end_at ?? "";
      const fmt = (iso: string) =>
        iso
          ? new Date(iso).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "America/Sao_Paulo",
            })
          : "";
      return {
        _start: startStr,
        time: `${fmt(startStr)} - ${fmt(endStr)}`,
        withName,
        table: tbl?.table_number ? String(tbl.table_number) : "—",
        location: "",
        website: companyWebsite(counterpartCompanyId),
      };
    })
    .sort((a, b) => a._start.localeCompare(b._start));

  return {
    eventId,
    profileName,
    role: isExhibitor ? "exhibitor" : "visitor",
    tableNumber: ownTable?.table_number != null ? String(ownTable.table_number) : null,
    rows: enriched.map(({ time, withName, table, location, website }) => ({
      time,
      withName,
      table,
      location,
      website,
    })),
  };
}