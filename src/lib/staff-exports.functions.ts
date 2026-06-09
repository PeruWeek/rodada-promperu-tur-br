import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertAdminOrStaff(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const ok = (data ?? []).some((r) => r.role === "admin" || r.role === "staff");
  if (!ok) throw new Error("Forbidden");
}

async function getCurrentEventId(explicit?: string) {
  if (explicit) return explicit;
  const { data } = await supabaseAdmin
    .from("events")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

export type RegistrantRow = {
  profile_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  job_title: string | null;
  role: "exhibitor" | "visitor";
  company_id: string;
  company_trade_name: string;
  company_legal_name: string | null;
  company_tax_id: string | null;
  country_code: string | null;
  state_code: string | null;
  city: string | null;
  registration_status: string | null;
  scheduled_meetings_count: number;
  created_at: string | null;
};

export const listEventRegistrants = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        eventId: z.string().uuid().optional(),
        role: z.enum(["all", "exhibitor", "visitor"]).default("all"),
        search: z.string().trim().max(120).optional(),
      })
      .parse(input ?? {}),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdminOrStaff(context.userId);
    const eventId = await getCurrentEventId(data.eventId);
    if (!eventId) return { eventId: null, rows: [] as RegistrantRow[] };

    let q = supabaseAdmin
      .from("v_company_event_pipeline")
      .select(
        "id, event_id, company_id, primary_profile_id, company_role, company_trade_name, company_legal_name, country_code, state_code, city, registration_status, scheduled_meetings_count, primary_contact_name, primary_contact_email, primary_contact_phone, primary_contact_whatsapp, created_at",
      )
      .eq("event_id", eventId);
    if (data.role !== "all") q = q.eq("company_role", data.role);
    if (data.search) {
      const s = data.search;
      q = q.or(
        `company_trade_name.ilike.%${s}%,company_legal_name.ilike.%${s}%,primary_contact_name.ilike.%${s}%,primary_contact_email.ilike.%${s}%`,
      );
    }
    const { data: rows, error } = await q.order("company_trade_name", { ascending: true });
    if (error) throw new Error(error.message);

    const companyIds = Array.from(new Set((rows ?? []).map((r) => r.company_id).filter(Boolean) as string[]));
    const { data: companies } = companyIds.length
      ? await supabaseAdmin
          .from("companies")
          .select("id, tax_id")
          .in("id", companyIds)
      : { data: [] as Array<{ id: string; tax_id: string | null }> };
    const taxById = new Map((companies ?? []).map((c) => [c.id, c.tax_id]));

    const profileIds = Array.from(
      new Set((rows ?? []).map((r) => r.primary_profile_id).filter(Boolean) as string[]),
    );
    const { data: profs } = profileIds.length
      ? await supabaseAdmin
          .from("profiles")
          .select("id, job_title, phone, whatsapp, auth_user_id")
          .in("id", profileIds)
      : { data: [] as Array<{ id: string; job_title: string | null; phone: string | null; whatsapp: string | null; auth_user_id: string | null }> };
    const profById = new Map((profs ?? []).map((p) => [p.id, p]));

    const out: RegistrantRow[] = (rows ?? [])
      .filter((r) => r.company_id && r.primary_profile_id)
      .filter((r) => {
        const p = profById.get(r.primary_profile_id as string);
        return !!p?.auth_user_id;
      })
      .map((r) => {
        const p = profById.get(r.primary_profile_id as string);
        return {
          profile_id: r.primary_profile_id as string,
          full_name: r.primary_contact_name ?? "—",
          email: r.primary_contact_email ?? null,
          phone: p?.phone ?? r.primary_contact_phone ?? null,
          whatsapp: p?.whatsapp ?? r.primary_contact_whatsapp ?? null,
          job_title: p?.job_title ?? null,
          role: (r.company_role === "exhibitor" ? "exhibitor" : "visitor") as "exhibitor" | "visitor",
          company_id: r.company_id as string,
          company_trade_name: r.company_trade_name ?? "—",
          company_legal_name: r.company_legal_name ?? null,
          company_tax_id: (taxById.get(r.company_id as string) as string | null | undefined) ?? null,
          country_code: r.country_code ?? null,
          state_code: r.state_code ?? null,
          city: r.city ?? null,
          registration_status: (r.registration_status as string | null) ?? null,
          scheduled_meetings_count: Number(r.scheduled_meetings_count ?? 0),
          created_at: r.created_at as string | null,
        };
      });
    return { eventId, rows: out };
  });

export type ParticipantAgendaRow = {
  time: string;
  withName: string;
  table: string;
  location: string;
};

export const getParticipantAgenda = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        profileId: z.string().uuid(),
        eventId: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdminOrStaff(context.userId);
    const eventId = await getCurrentEventId(data.eventId);
    if (!eventId) return { eventId: null, profileName: null, role: null, rows: [] as ParticipantAgendaRow[] };

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name")
      .eq("id", data.profileId)
      .maybeSingle();
    const profileName = profile?.full_name ?? "—";

    // Determine role: exhibitor (their profile owns a table) or visitor.
    const { data: ownedTables } = await supabaseAdmin
      .from("event_tables")
      .select("id, table_number")
      .eq("event_id", eventId)
      .eq("exhibitor_profile_id", data.profileId);
    const isExhibitor = (ownedTables ?? []).length > 0;

    let meetingsQ = supabaseAdmin
      .from("meetings")
      .select("id, table_id, slot_id, visitor_profile_id, status")
      .eq("event_id", eventId)
      .eq("status", "scheduled");
    if (isExhibitor) {
      const tableIds = (ownedTables ?? []).map((t) => t.id);
      meetingsQ = meetingsQ.in("table_id", tableIds);
    } else {
      meetingsQ = meetingsQ.eq("visitor_profile_id", data.profileId);
    }
    const { data: meetings, error: mErr } = await meetingsQ;
    if (mErr) throw new Error(mErr.message);
    const rows = meetings ?? [];
    if (rows.length === 0) {
      return { eventId, profileName, role: isExhibitor ? "exhibitor" : "visitor", rows: [] };
    }

    const slotIds = Array.from(new Set(rows.map((m) => m.slot_id)));
    const tableIds = Array.from(new Set(rows.map((m) => m.table_id)));
    const visitorIds = Array.from(new Set(rows.map((m) => m.visitor_profile_id)));

    const [{ data: slots }, { data: tables }, { data: visitors }] = await Promise.all([
      supabaseAdmin.from("time_slots").select("id, start_at, end_at").in("id", slotIds),
      supabaseAdmin
        .from("event_tables")
        .select("id, table_number, exhibitor_profile_id")
        .in("id", tableIds),
      supabaseAdmin.from("profiles").select("id, full_name, company_id").in("id", visitorIds),
    ]);

    const exhProfileIds = Array.from(
      new Set((tables ?? []).map((t) => t.exhibitor_profile_id).filter(Boolean) as string[]),
    );
    const { data: exhProfiles } = exhProfileIds.length
      ? await supabaseAdmin.from("profiles").select("id, full_name, company_id").in("id", exhProfileIds)
      : { data: [] as Array<{ id: string; full_name: string; company_id: string | null }> };
    const allCompanyIds = Array.from(
      new Set(
        [
          ...(visitors ?? []).map((v) => v.company_id),
          ...(exhProfiles ?? []).map((p) => p.company_id),
        ].filter(Boolean) as string[],
      ),
    );
    const { data: companies } = allCompanyIds.length
      ? await supabaseAdmin.from("companies").select("id, trade_name").in("id", allCompanyIds)
      : { data: [] as Array<{ id: string; trade_name: string }> };
    const companyName = (id: string | null | undefined) =>
      id ? (companies ?? []).find((c) => c.id === id)?.trade_name ?? "—" : "—";

    const enriched: ParticipantAgendaRow[] = rows
      .map((m) => {
        const slot = (slots ?? []).find((s) => s.id === m.slot_id);
        const tbl = (tables ?? []).find((t) => t.id === m.table_id);
        const withName = isExhibitor
          ? (() => {
              const v = (visitors ?? []).find((x) => x.id === m.visitor_profile_id);
              return v ? `${v.full_name} · ${companyName(v.company_id)}` : "—";
            })()
          : (() => {
              const exh = (exhProfiles ?? []).find((p) => p.id === tbl?.exhibitor_profile_id);
              return exh ? `${companyName(exh.company_id)} (${exh.full_name})` : "—";
            })();
        const startStr = slot?.start_at ?? "";
        const endStr = slot?.end_at ?? "";
        const fmt = (iso: string) =>
          iso
            ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
            : "";
        return {
          _start: startStr,
          time: `${fmt(startStr)} - ${fmt(endStr)}`,
          withName,
          table: tbl?.table_number ? String(tbl.table_number) : "—",
          location: "",
        };
      })
      .sort((a, b) => a._start.localeCompare(b._start))
      .map(({ time, withName, table, location }) => ({ time, withName, table, location }));

    return {
      eventId,
      profileName,
      role: isExhibitor ? "exhibitor" : "visitor",
      rows: enriched,
    };
  });