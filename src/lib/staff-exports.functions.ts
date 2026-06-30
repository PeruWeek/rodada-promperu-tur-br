import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { filterAndRankParticipants } from "@/lib/company-search";
import { getPrimaryRoleServer } from "@/lib/role-server";

async function assertAdminOrStaff(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const ok = (data ?? []).some(
    (r) => r.role === "admin" || r.role === "staff" || r.role === "cliente",
  );
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
  auth_user_id: string;
  is_active: boolean;
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
  scheduling_status: string | null;
  scheduled_meetings_count: number;
  /**
   * Per-PROFILE scheduled meetings count for the current event.
   *
   * Distinct from `scheduled_meetings_count`, which is COMPANY-aggregate
   * (sourced from `v_company_event_pipeline`). When a company has multiple
   * contacts (e.g. 2 buyer profiles), the company total may exceed any
   * single profile's agenda. The "Agenda (PDF)" button in the Inscritos
   * tab exports a single profile's agenda, so the per-contact badge MUST
   * use this field to match the PDF, not the company aggregate.
   */
  profile_meetings_count: number;
  created_at: string | null;
  /**
   * Networking lunch participation — sourced from `visitor_profiles`
   * (canonical). Only set for visitor rows; null when unknown or for
   * exhibitor rows. Populated by `annotateLunchParticipation` after the
   * main query so exports (XLSX/CSV/PDF) can render "Sim/Não/Não informado"
   * consistently with the `Empresas` tab.
   */
  networking_lunch_participation: boolean | null;
};

const SCHEDULING_STATUS_VALUES = [
  "sem_agendamento",
  "agendado_parcial",
  "agendado_ok",
] as const;

export type ListEventRegistrantsInput = {
  eventId?: string;
  role: "all" | "exhibitor" | "visitor";
  search?: string;
  schedulingStatuses?: Array<(typeof SCHEDULING_STATUS_VALUES)[number] | string>;
  sort?: "name" | "recent";
  /**
   * Cliente-only escape hatch: when true, lifts the count>0 restriction so
   * the cliente "Inscritos" tab can mirror the staff/admin listing.
   */
  unrestrictedCliente?: boolean;
};

/**
 * Pure implementation — exposed for unit tests. The exported server function
 * is a thin wrapper that injects the production `supabaseAdmin` client and
 * authenticated `userId` from middleware.
 *
 * Cliente enforcement (count-based): when the caller's primary role is
 * `cliente`, the query is restricted to rows with
 * `scheduled_meetings_count > 0` — the canonical "com agendamento" bucket
 * (see `src/lib/scheduling-status.ts`). The string `scheduling_status` is
 * NOT used to decide visibility; if it ever disagrees with the count, the
 * count wins. A defensive post-filter drops any leaked row with `<= 0`.
 * The `schedulingStatuses` input is ignored for cliente.
 */
export async function _listEventRegistrantsImpl(
  data: ListEventRegistrantsInput,
  ctx: { userId: string; supabase: any },
) {
  const role = await getPrimaryRoleServer(ctx.supabase, ctx.userId);
  if (role !== "admin" && role !== "staff" && role !== "cliente") {
    throw new Error("Forbidden");
  }
  const isCliente = role === "cliente";
  // When `unrestrictedCliente` is set, the cliente caller is requesting the
  // full "Inscritos" listing (parity with staff/admin) instead of the
  // restricted "Agendamentos" view. In that mode we do NOT apply the
  // count>0 restriction nor the defensive post-filter, and we respect any
  // client-supplied scheduling filter exactly like staff/admin.
  const restrictCliente = isCliente && !data.unrestrictedCliente;
  const schedulingStatuses = restrictCliente ? undefined : data.schedulingStatuses;

  const eventId = await getCurrentEventIdWith(ctx.supabase, data.eventId);
    if (!eventId) return { eventId: null, rows: [] as RegistrantRow[] };

    let q = ctx.supabase
      .from("v_company_event_pipeline")
      .select(
        "id, event_id, company_id, primary_profile_id, company_role, company_trade_name, company_legal_name, country_code, state_code, city, registration_status, scheduling_status, scheduled_meetings_count, primary_contact_name, primary_contact_email, primary_contact_phone, primary_contact_whatsapp, created_at",
      )
      .eq("event_id", eventId);
    if (data.role !== "all") q = q.eq("company_role", data.role);
    if (restrictCliente) {
      // Canonical "com agendamento" bucket = count > 0. Source of truth.
      q = q.gt("scheduled_meetings_count", 0);
    }
    if (schedulingStatuses && schedulingStatuses.length > 0) {
      q = q.in("scheduling_status", schedulingStatuses);
    }
    const { data: rows, error } = await q.order("company_trade_name", { ascending: true });
    if (error) throw new Error(error.message);

    type PipelineRow = {
      id: string;
      event_id: string | null;
      company_id: string | null;
      primary_profile_id: string | null;
      company_role: string | null;
      company_trade_name: string | null;
      company_legal_name: string | null;
      country_code: string | null;
      state_code: string | null;
      city: string | null;
      registration_status: string | null;
      scheduling_status: string | null;
      scheduled_meetings_count: number | null;
      primary_contact_name: string | null;
      primary_contact_email: string | null;
      primary_contact_phone: string | null;
      primary_contact_whatsapp: string | null;
      created_at: string | null;
    };
    type CompanyTaxRow = { id: string; tax_id: string | null };
    type ProfileRow = {
      id: string;
      job_title: string | null;
      phone: string | null;
      whatsapp: string | null;
      auth_user_id: string | null;
      is_active: boolean | null;
    };
    type UserRoleRow = { user_id: string; role: string };
    let rowsTyped = (rows ?? []) as PipelineRow[];
    const companyIds = Array.from(
      new Set(rowsTyped.map((r) => r.company_id).filter(Boolean) as string[]),
    );
    const { data: companies } = companyIds.length
      ? await ctx.supabase
          .from("companies")
          .select("id, tax_id")
          .in("id", companyIds)
      : { data: [] as CompanyTaxRow[] };
    const taxById = new Map(
      ((companies ?? []) as CompanyTaxRow[]).map((c) => [c.id, c.tax_id]),
    );
    // Textual search runs AFTER per-profile expansion below so the needle
    // can match the inscribed person's full_name / email in addition to the
    // company's trade_name, legal_name and tax_id. This keeps the search
    // semantics consistent across Empresas, Inscritos and Agenda (each tab
    // applies its own universe filter — Agenda restricts to rows with
    // `scheduled_meetings_count > 0` — but the textual match is identical).

    const profileIds = Array.from(
      new Set(rowsTyped.map((r) => r.primary_profile_id).filter(Boolean) as string[]),
    );
    // Pull ALL profiles by company_id (not just pipeline's primary_profile_id).
    // The pipeline view frequently points primary at a pre-registration stub
    // without `auth_user_id`; the same company may already have a confirmed
    // active participant contact. Promoting that sibling here keeps this
    // function aligned with `listClienteOverviewBase` and the Empresas tab
    // (a company visible "Com agendamento" in Visão Geral must also be
    // visible in Agendamentos).
    type ProfileFullRow = ProfileRow & {
      company_id: string | null;
      full_name: string | null;
      email: string | null;
      created_at: string | null;
    };
    const { data: profsByPrimary } = profileIds.length
      ? await ctx.supabase
          .from("profiles")
          .select(
            "id, company_id, full_name, email, job_title, phone, whatsapp, auth_user_id, is_active, created_at",
          )
          .in("id", profileIds)
      : { data: [] as ProfileFullRow[] };
    const companyIdsForPromotion = Array.from(
      new Set(rowsTyped.map((r) => r.company_id).filter(Boolean) as string[]),
    );
    const { data: profsByCompanyData } = companyIdsForPromotion.length
      ? await ctx.supabase
          .from("profiles")
          .select(
            "id, company_id, full_name, email, job_title, phone, whatsapp, auth_user_id, is_active, created_at",
          )
          .in("company_id", companyIdsForPromotion)
          .order("created_at", { ascending: true })
      : { data: [] as ProfileFullRow[] };
    const profsByCompany = new Map<string, ProfileFullRow[]>();
    for (const p of (profsByCompanyData ?? []) as ProfileFullRow[]) {
      if (!p.company_id) continue;
      const arr = profsByCompany.get(p.company_id) ?? [];
      arr.push(p);
      profsByCompany.set(p.company_id, arr);
    }
    const profsTyped = [
      ...((profsByPrimary ?? []) as ProfileFullRow[]),
      ...((profsByCompanyData ?? []) as ProfileFullRow[]),
    ];
    const profById = new Map<string, ProfileFullRow>();
    for (const p of profsTyped) profById.set(p.id, p);

    // Exclude profiles whose owner is not actually a participant role
    // (exhibitor/visitor). `cliente`, `admin`, and `staff` are internal /
    // business profiles and must not appear in the "Inscritos" list even
    // when the underlying company is tagged as visitor in the pipeline.
    const authUserIds = Array.from(
      new Set(profsTyped.map((p) => p.auth_user_id).filter(Boolean) as string[]),
    );
    const { data: rolesData } = authUserIds.length
      ? await ctx.supabase
          .from("user_roles")
          .select("user_id, role")
          .in("user_id", authUserIds)
      : { data: [] as UserRoleRow[] };
    const rolesByUser = new Map<string, Set<string>>();
    for (const r of (rolesData ?? []) as UserRoleRow[]) {
      const key = r.user_id as string;
      if (!rolesByUser.has(key)) rolesByUser.set(key, new Set());
      rolesByUser.get(key)!.add(String(r.role));
    }
    const ineligibleAuthIds = new Set<string>();
    for (const [uid, roles] of rolesByUser) {
      if (roles.has("cliente") || roles.has("admin") || roles.has("staff")) {
        ineligibleAuthIds.add(uid);
      }
    }
    const isParticipantProfile = (p: ProfileFullRow | undefined | null) => {
      if (!p) return false;
      if (p.is_active === false) return false;
      if (!p.auth_user_id) return false;
      if (ineligibleAuthIds.has(p.auth_user_id)) return false;
      return true;
    };

    const out: RegistrantRow[] = rowsTyped
      .filter((r) => r.company_id)
      .filter((r) => {
        // Defensive post-filter: cliente NEVER sees rows whose real count is
        // <= 0, even if scheduling_status text incorrectly says agendado_ok.
        if (!restrictCliente) return true;
        return Number(r.scheduled_meetings_count ?? 0) > 0;
      })
      .flatMap((r) => {
        // Expand to ONE ROW PER ELIGIBLE PARTICIPANT PROFILE of the company.
        // The pipeline view emits one row per company, but the Inscritos
        // listing/export must list every person inscribed for that company
        // (e.g. COPASTUR has 2 confirmed buyers — both must appear). We
        // de-duplicate by profile.id across the pipeline primary and the
        // by-company fetch, then keep only participant profiles (active,
        // with auth_user_id, not internal admin/staff/cliente).
        const candidates: ProfileFullRow[] = [];
        const seen = new Set<string>();
        const pipelinePrimary = r.primary_profile_id
          ? profById.get(r.primary_profile_id as string)
          : undefined;
        if (pipelinePrimary) {
          candidates.push(pipelinePrimary);
          seen.add(pipelinePrimary.id);
        }
        for (const sibling of profsByCompany.get(r.company_id as string) ?? []) {
          if (seen.has(sibling.id)) continue;
          candidates.push(sibling);
          seen.add(sibling.id);
        }
        const eligible = candidates.filter(isParticipantProfile);
        if (eligible.length === 0) return [] as Array<{ r: PipelineRow; p: ProfileFullRow }>;
        return eligible.map((p) => ({ r, p }));
      })
      .map(({ r, p }) => {
        return {
          profile_id: p.id,
          auth_user_id: (p?.auth_user_id ?? "") as string,
          is_active: p?.is_active !== false,
          full_name: p?.full_name ?? r.primary_contact_name ?? "—",
          email: p?.email ?? r.primary_contact_email ?? null,
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
          scheduling_status: (r.scheduling_status as string | null) ?? null,
          scheduled_meetings_count: Number(r.scheduled_meetings_count ?? 0),
          profile_meetings_count: 0,
          created_at: (p?.created_at ?? r.created_at) as string | null,
          networking_lunch_participation: null,
        };
      });
  await annotateProfileMeetingCounts(ctx.supabase, eventId, out);
  await annotateLunchParticipation(ctx.supabase, out);
  // Defensive dedup: after a relink, an orphan pipeline row of the old stub
  // company may still reference this profile via `primary_profile_id`,
  // emitting the same person twice (once for the stub row, once for the
  // canonical company expansion). Keep the row whose pipeline company_id
  // matches the profile's current canonical company_id when available;
  // otherwise keep the first occurrence. Legitimate cases of multiple
  // distinct profiles in the same company are preserved because we key
  // by `profile_id`, not `company_id`.
  const dedupSeen = new Map<string, RegistrantRow>();
  for (const row of out) {
    const existing = dedupSeen.get(row.profile_id);
    if (!existing) {
      dedupSeen.set(row.profile_id, row);
      continue;
    }
    const canonical = profById.get(row.profile_id)?.company_id ?? null;
    if (canonical && row.company_id === canonical && existing.company_id !== canonical) {
      dedupSeen.set(row.profile_id, row);
    }
  }
  const dedupedOut = Array.from(dedupSeen.values());
  if (data.sort === "recent") {
    dedupedOut.sort((a: RegistrantRow, b: RegistrantRow) => {
      const da = a.created_at ?? "";
      const db = b.created_at ?? "";
      if (da !== db) return db.localeCompare(da);
      return a.company_trade_name.localeCompare(b.company_trade_name);
    });
  }
  return { eventId, rows: dedupedOut };
}

async function getCurrentEventIdWith(supabase: any, explicit?: string) {
  if (explicit) return explicit;
  const { data } = await supabase
    .from("events")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * Computes per-PROFILE scheduled meeting counts (visitor side via
 * `meetings.visitor_profile_id`; exhibitor side via tables they own) for
 * the given event and mutates each row's `profile_meetings_count`.
 *
 * Source of truth for the per-contact "Com agendamento · N" badge in the
 * Inscritos tab, mirroring `getParticipantAgenda` and the per-row "Agenda
 * (PDF)" export.
 */
async function annotateProfileMeetingCounts(
  supabase: any,
  eventId: string,
  rows: RegistrantRow[],
) {
  if (rows.length === 0) return;
  const visitorIds = Array.from(
    new Set(rows.filter((r) => r.role === "visitor").map((r) => r.profile_id)),
  );
  const exhibitorIds = Array.from(
    new Set(rows.filter((r) => r.role === "exhibitor").map((r) => r.profile_id)),
  );
  const counts = new Map<string, number>();

  if (visitorIds.length) {
    const { data: vm } = await supabase
      .from("meetings")
      .select("visitor_profile_id")
      .eq("event_id", eventId)
      .eq("status", "scheduled")
      .in("visitor_profile_id", visitorIds);
    for (const m of (vm ?? []) as Array<{ visitor_profile_id: string | null }>) {
      const id = m.visitor_profile_id;
      if (!id) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }

  if (exhibitorIds.length) {
    const { data: tables } = await supabase
      .from("event_tables")
      .select("id, exhibitor_profile_id")
      .eq("event_id", eventId)
      .in("exhibitor_profile_id", exhibitorIds);
    const tableToProfile = new Map<string, string>();
    for (const t of (tables ?? []) as Array<{
      id: string;
      exhibitor_profile_id: string | null;
    }>) {
      if (t.exhibitor_profile_id) tableToProfile.set(t.id, t.exhibitor_profile_id);
    }
    const tableIds = Array.from(tableToProfile.keys());
    if (tableIds.length) {
      const { data: em } = await supabase
        .from("meetings")
        .select("table_id")
        .eq("event_id", eventId)
        .eq("status", "scheduled")
        .in("table_id", tableIds);
      for (const m of (em ?? []) as Array<{ table_id: string | null }>) {
        const pid = m.table_id ? tableToProfile.get(m.table_id) : null;
        if (!pid) continue;
        counts.set(pid, (counts.get(pid) ?? 0) + 1);
      }
    }
  }

  for (const r of rows) {
    r.profile_meetings_count = counts.get(r.profile_id) ?? 0;
  }
}

/**
 * Populates `networking_lunch_participation` on visitor rows by fetching
 * `visitor_profiles.networking_lunch_participation` for the relevant
 * profile ids. Single source of truth for "Almoço de networking" across
 * Inscritos and Visão Geral exports — same field used by the Empresas tab
 * (`src/lib/admin.functions.ts`).
 */
async function annotateLunchParticipation(
  supabase: any,
  rows: RegistrantRow[],
) {
  if (rows.length === 0) return;
  const visitorIds = Array.from(
    new Set(
      rows
        .filter((r) => r.role === "visitor")
        .map((r) => r.profile_id)
        .filter(Boolean) as string[],
    ),
  );
  if (visitorIds.length === 0) return;
  const { data } = await supabase
    .from("visitor_profiles")
    .select("profile_id, networking_lunch_participation")
    .in("profile_id", visitorIds);
  const byProfile = new Map<string, boolean | null>();
  for (const v of (data ?? []) as Array<{
    profile_id: string;
    networking_lunch_participation: boolean | null;
  }>) {
    byProfile.set(v.profile_id, v.networking_lunch_participation ?? null);
  }
  for (const r of rows) {
    if (r.role !== "visitor") continue;
    r.networking_lunch_participation = byProfile.get(r.profile_id) ?? null;
  }
}

export const listEventRegistrants = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        eventId: z.string().uuid().optional(),
        role: z.enum(["all", "exhibitor", "visitor"]).default("all"),
        search: z.string().trim().max(120).optional(),
        schedulingStatuses: z
          .array(z.enum(SCHEDULING_STATUS_VALUES))
          .max(SCHEDULING_STATUS_VALUES.length)
          .optional(),
        sort: z.enum(["name", "recent"]).default("name"),
        unrestrictedCliente: z.boolean().optional(),
      })
      .parse(input ?? {}),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) =>
    _listEventRegistrantsImpl(data, {
      userId: context.userId,
      supabase: supabaseAdmin,
    }),
  );

/**
 * Cliente "Visão geral" base.
 *
 * Returns the full operational base of companies visible to the cliente for
 * the active event — same universe as the Empresas tab (any registration
 * status), without any scheduling filter. The overview separates "inscrição"
 * from "agendamento" and must NOT depend on the meetings table to decide
 * who is in the base. Counting `comAgendamento` and `% com agendamento` is
 * done on the client from `scheduled_meetings_count` (single source of
 * truth, see `src/lib/scheduling-status.ts`).
 *
 * Authorization: admin, staff, or cliente. Same ineligibility filter as
 * `listEventRegistrants` (drops profiles owned by admin/staff/cliente).
 */
export const listClienteOverviewBase = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({ eventId: z.string().uuid().optional() })
      .parse(input ?? {}),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const role = await getPrimaryRoleServer(supabaseAdmin, context.userId);
    if (role !== "admin" && role !== "staff" && role !== "cliente") {
      throw new Error("Forbidden");
    }
    const eventId = await getCurrentEventIdWith(supabaseAdmin, data.eventId);
    if (!eventId) return { eventId: null, rows: [] as RegistrantRow[] };

    const { data: rows, error } = await supabaseAdmin
      .from("v_company_event_pipeline")
      .select(
        "id, event_id, company_id, primary_profile_id, company_role, company_trade_name, company_legal_name, country_code, state_code, city, registration_status, scheduling_status, scheduled_meetings_count, primary_contact_name, primary_contact_email, primary_contact_phone, primary_contact_whatsapp, created_at",
      )
      .eq("event_id", eventId)
      .order("company_trade_name", { ascending: true });
    if (error) throw new Error(error.message);

    type PipelineRow = {
      id: string;
      event_id: string | null;
      company_id: string | null;
      primary_profile_id: string | null;
      company_role: string | null;
      company_trade_name: string | null;
      company_legal_name: string | null;
      country_code: string | null;
      state_code: string | null;
      city: string | null;
      registration_status: string | null;
      scheduling_status: string | null;
      scheduled_meetings_count: number | null;
      primary_contact_name: string | null;
      primary_contact_email: string | null;
      primary_contact_phone: string | null;
      primary_contact_whatsapp: string | null;
      created_at: string | null;
    };
    const rowsTyped = (rows ?? []) as PipelineRow[];
    // Pull ALL profiles for the companies in the pipeline — not just the
    // pipeline's `primary_profile_id`. The pipeline view often points
    // `primary` at a pre-registration profile with no `auth_user_id`, while
    // the same company already has a confirmed participant contact. The
    // Empresas tab treats those companies as visible (any active owner);
    // the overview must match that universe.
    const companyIds = Array.from(
      new Set(rowsTyped.map((r) => r.company_id).filter(Boolean) as string[]),
    );
    const { data: allProfs } = companyIds.length
      ? await supabaseAdmin
          .from("profiles")
          .select(
            "id, company_id, full_name, email, job_title, phone, whatsapp, auth_user_id, is_active, created_at",
          )
          .in("company_id", companyIds)
          .order("created_at", { ascending: true })
      : {
          data: [] as Array<{
            id: string;
            company_id: string | null;
            full_name: string | null;
            email: string | null;
            job_title: string | null;
            phone: string | null;
            whatsapp: string | null;
            auth_user_id: string | null;
            is_active: boolean | null;
            created_at: string | null;
          }>,
        };
    const profsByCompany = new Map<string, typeof allProfs>();
    for (const p of allProfs ?? []) {
      if (!p.company_id) continue;
      const arr = profsByCompany.get(p.company_id) ?? [];
      arr.push(p);
      profsByCompany.set(p.company_id, arr);
    }
    const authIds = Array.from(
      new Set((allProfs ?? []).map((p) => p.auth_user_id).filter(Boolean) as string[]),
    );
    const { data: roleRows } = authIds.length
      ? await supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", authIds)
      : { data: [] as Array<{ user_id: string; role: string }> };
    const rolesByAuth = new Map<string, Set<string>>();
    for (const r of roleRows ?? []) {
      const set = rolesByAuth.get(r.user_id) ?? new Set<string>();
      set.add(String(r.role));
      rolesByAuth.set(r.user_id, set);
    }
    const isParticipantAuth = (authId: string | null | undefined) => {
      if (!authId) return false;
      const set = rolesByAuth.get(authId);
      if (!set) return false;
      // Same ineligibility rule as listEventRegistrants: drop internal roles.
      if (set.has("cliente") || set.has("admin") || set.has("staff")) return false;
      return set.has("visitor") || set.has("exhibitor");
    };
    const out: RegistrantRow[] = rowsTyped
      .filter((r) => !!r.company_id)
      .flatMap((r) => {
        // Expand to ONE ROW PER ELIGIBLE PARTICIPANT PROFILE of the company,
        // matching `_listEventRegistrantsImpl`. The pipeline view emits one
        // row per company, but the cliente listing/export must list every
        // inscribed person (e.g. COPASTUR has 2 confirmed buyers — both must
        // appear in Visão Geral and its XLSX/PDF export, not just the
        // "primary" representative).
        const companyProfiles = profsByCompany.get(r.company_id as string) ?? [];
        const seen = new Set<string>();
        const eligible: typeof companyProfiles = [];
        // Pipeline primary first (kept as "responsável principal" in summary).
        const pipelinePrimary = companyProfiles.find(
          (p) => p.id === r.primary_profile_id,
        );
        if (
          pipelinePrimary &&
          pipelinePrimary.is_active !== false &&
          isParticipantAuth(pipelinePrimary.auth_user_id)
        ) {
          eligible.push(pipelinePrimary);
          seen.add(pipelinePrimary.id);
        }
        for (const p of companyProfiles) {
          if (seen.has(p.id)) continue;
          if (p.is_active === false) continue;
          if (!isParticipantAuth(p.auth_user_id)) continue;
          eligible.push(p);
          seen.add(p.id);
        }
        if (eligible.length === 0) return [] as Array<{ r: PipelineRow; p: typeof companyProfiles[number] }>;
        return eligible.map((p) => ({ r, p }));
      })
      .map(({ r, p }) => {
        const prof = p!;
        return {
          profile_id: prof.id,
          auth_user_id: (prof.auth_user_id ?? "") as string,
          is_active: prof.is_active !== false,
          full_name: prof.full_name ?? r.primary_contact_name ?? "—",
          email: prof.email ?? r.primary_contact_email ?? null,
          phone: prof.phone ?? r.primary_contact_phone ?? null,
          whatsapp: prof.whatsapp ?? r.primary_contact_whatsapp ?? null,
          job_title: prof.job_title ?? null,
          role: (r.company_role === "exhibitor" ? "exhibitor" : "visitor") as "exhibitor" | "visitor",
          company_id: r.company_id as string,
          company_trade_name: r.company_trade_name ?? "—",
          company_legal_name: r.company_legal_name ?? null,
          company_tax_id: null,
          country_code: r.country_code ?? null,
          state_code: r.state_code ?? null,
          city: r.city ?? null,
          registration_status: r.registration_status ?? null,
          scheduling_status: r.scheduling_status ?? null,
          scheduled_meetings_count: Number(r.scheduled_meetings_count ?? 0),
          profile_meetings_count: 0,
          created_at: r.created_at ?? null,
          networking_lunch_participation: null,
        };
      });
    await annotateProfileMeetingCounts(supabaseAdmin, eventId, out);
    await annotateLunchParticipation(supabaseAdmin, out);
    return { eventId, rows: out };
  });

export type ParticipantAgendaRow = {
  time: string;
  withName: string;
  table: string;
  location: string;
};

export type BulkAgendaEntry = {
  profileId: string;
  profileName: string;
  companyName: string;
  role: "exhibitor" | "visitor";
  tableNumber: string | null;
  rows: ParticipantAgendaRow[];
};

export type CompanyAgendaRow = ParticipantAgendaRow & {
  contactName: string;
  contactRole: "exhibitor" | "visitor";
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

export const listBulkAgendas = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        eventId: z.string().uuid().optional(),
        profileIds: z.array(z.string().uuid()).min(1).max(500),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdminOrStaff(context.userId);
    const eventId = await getCurrentEventId(data.eventId);
    if (!eventId) return { eventId: null, entries: [] as BulkAgendaEntry[] };

    const seedProfileIds = Array.from(new Set(data.profileIds));

    // Profiles + companies
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, company_id, auth_user_id, is_active")
      .in("id", seedProfileIds);
    const baseCompanyIds = Array.from(
      new Set((profs ?? []).map((p) => p.company_id).filter(Boolean) as string[]),
    );
    const { data: companyProfiles } = baseCompanyIds.length
      ? await supabaseAdmin
          .from("profiles")
          .select("id, full_name, company_id, auth_user_id, is_active")
          .in("company_id", baseCompanyIds)
          .order("created_at", { ascending: true })
      : { data: [] as Array<{ id: string; full_name: string | null; company_id: string | null; auth_user_id: string | null; is_active: boolean | null }> };
    const authIds = Array.from(
      new Set((companyProfiles ?? []).map((p) => p.auth_user_id).filter(Boolean) as string[]),
    );
    const { data: roleRows } = authIds.length
      ? await supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", authIds)
      : { data: [] as Array<{ user_id: string; role: string }> };
    const rolesByAuth = new Map<string, Set<string>>();
    for (const r of roleRows ?? []) {
      const set = rolesByAuth.get(r.user_id) ?? new Set<string>();
      set.add(String(r.role));
      rolesByAuth.set(r.user_id, set);
    }
    const isEligibleParticipant = (p: { auth_user_id: string | null; is_active: boolean | null }) => {
      if (p.is_active === false) return false;
      if (!p.auth_user_id) return false;
      const roles = rolesByAuth.get(p.auth_user_id);
      if (!roles) return false;
      if (roles.has("admin") || roles.has("staff") || roles.has("cliente")) return false;
      return roles.has("visitor") || roles.has("exhibitor");
    };
    const seededCompanies = new Set(baseCompanyIds);
    const profileIds = Array.from(
      new Set(
        (companyProfiles ?? [])
          .filter((p) => p.company_id && seededCompanies.has(p.company_id) && isEligibleParticipant(p))
          .map((p) => p.id),
      ),
    );
    if (profileIds.length === 0) return { eventId, entries: [] as BulkAgendaEntry[] };
    const agendaProfiles = (companyProfiles ?? []).filter((p) => profileIds.includes(p.id));

    // Tables owned by any of these profiles (exhibitors)
    const { data: ownedTables } = await supabaseAdmin
      .from("event_tables")
      .select("id, table_number, exhibitor_profile_id")
      .eq("event_id", eventId)
      .in("exhibitor_profile_id", profileIds);
    const exhTableByProfile = new Map<string, { id: string; table_number: number }>();
    for (const t of ownedTables ?? []) {
      if (t.exhibitor_profile_id)
        exhTableByProfile.set(t.exhibitor_profile_id, { id: t.id, table_number: t.table_number });
    }

    // Meetings: as visitor for any non-exhibitor profile, OR at exhibitor's table.
    const visitorIds = profileIds.filter((id) => !exhTableByProfile.has(id));
    const exhTableIds = Array.from(exhTableByProfile.values()).map((t) => t.id);

    const meetingsArr: Array<{
      id: string;
      table_id: string;
      slot_id: string;
      visitor_profile_id: string;
      status: string;
    }> = [];

    if (visitorIds.length) {
      const { data: mv } = await supabaseAdmin
        .from("meetings")
        .select("id, table_id, slot_id, visitor_profile_id, status")
        .eq("event_id", eventId)
        .eq("status", "scheduled")
        .in("visitor_profile_id", visitorIds);
      meetingsArr.push(...(mv ?? []));
    }
    if (exhTableIds.length) {
      const { data: me } = await supabaseAdmin
        .from("meetings")
        .select("id, table_id, slot_id, visitor_profile_id, status")
        .eq("event_id", eventId)
        .eq("status", "scheduled")
        .in("table_id", exhTableIds);
      meetingsArr.push(...(me ?? []));
    }

    const slotIds = Array.from(new Set(meetingsArr.map((m) => m.slot_id)));
    const allTableIds = Array.from(new Set(meetingsArr.map((m) => m.table_id)));
    const allVisitorIds = Array.from(new Set(meetingsArr.map((m) => m.visitor_profile_id)));

    const [{ data: slots }, { data: tables }, { data: visitorProfs }] = await Promise.all([
      slotIds.length
        ? supabaseAdmin.from("time_slots").select("id, start_at, end_at").in("id", slotIds)
        : Promise.resolve({ data: [] as Array<{ id: string; start_at: string; end_at: string }> }),
      allTableIds.length
        ? supabaseAdmin
            .from("event_tables")
            .select("id, table_number, exhibitor_profile_id")
            .in("id", allTableIds)
        : Promise.resolve({
            data: [] as Array<{ id: string; table_number: number; exhibitor_profile_id: string | null }>,
          }),
      allVisitorIds.length
        ? supabaseAdmin
            .from("profiles")
            .select("id, full_name, company_id")
            .in("id", allVisitorIds)
        : Promise.resolve({ data: [] as Array<{ id: string; full_name: string; company_id: string | null }> }),
    ]);

    const exhProfileIds = Array.from(
      new Set((tables ?? []).map((t) => t.exhibitor_profile_id).filter(Boolean) as string[]),
    );
    const { data: exhProfs } = exhProfileIds.length
      ? await supabaseAdmin.from("profiles").select("id, full_name, company_id").in("id", exhProfileIds)
      : { data: [] as Array<{ id: string; full_name: string; company_id: string | null }> };

    const allCompanyIds = Array.from(
      new Set(
        [
          ...baseCompanyIds,
          ...((visitorProfs ?? []).map((v) => v.company_id).filter(Boolean) as string[]),
          ...((exhProfs ?? []).map((p) => p.company_id).filter(Boolean) as string[]),
        ],
      ),
    );
    const { data: companies } = allCompanyIds.length
      ? await supabaseAdmin.from("companies").select("id, trade_name").in("id", allCompanyIds)
      : { data: [] as Array<{ id: string; trade_name: string }> };
    const compName = (id: string | null | undefined) =>
      id ? (companies ?? []).find((c) => c.id === id)?.trade_name ?? "—" : "—";

    const fmt = (iso: string) =>
      iso
        ? new Date(iso).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "America/Sao_Paulo",
          })
        : "";

    const entries: BulkAgendaEntry[] = profileIds.map((pid) => {
      const prof = agendaProfiles.find((p) => p.id === pid) ?? (profs ?? []).find((p) => p.id === pid);
      const isExh = exhTableByProfile.has(pid);
      const ownTbl = exhTableByProfile.get(pid) ?? null;
      const mine = meetingsArr.filter((m) =>
        isExh ? m.table_id === ownTbl?.id : m.visitor_profile_id === pid,
      );
      const rows: Array<ParticipantAgendaRow & { _start: string }> = mine.map((m) => {
        const slot = (slots ?? []).find((s) => s.id === m.slot_id);
        const tbl = (tables ?? []).find((t) => t.id === m.table_id);
        const withName = isExh
          ? (() => {
              const v = (visitorProfs ?? []).find((x) => x.id === m.visitor_profile_id);
              return v ? `${v.full_name} · ${compName(v.company_id)}` : "—";
            })()
          : (() => {
              const exh = (exhProfs ?? []).find((p) => p.id === tbl?.exhibitor_profile_id);
              return exh ? `${compName(exh.company_id)} (${exh.full_name})` : "—";
            })();
        const startStr = slot?.start_at ?? "";
        const endStr = slot?.end_at ?? "";
        return {
          _start: startStr,
          time: `${fmt(startStr)} - ${fmt(endStr)}`,
          withName,
          table: tbl?.table_number ? String(tbl.table_number) : "—",
          location: "",
        };
      });
      rows.sort((a, b) => a._start.localeCompare(b._start));
      return {
        profileId: pid,
        profileName: prof?.full_name ?? "—",
        companyName: compName(prof?.company_id),
        role: isExh ? "exhibitor" : "visitor",
        tableNumber: ownTbl ? String(ownTbl.table_number) : null,
        rows: rows.map(({ time, withName, table, location }) => ({ time, withName, table, location })),
      };
    });

    // Sort entries by table > profileName
    entries.sort((a, b) => {
      const ta = a.tableNumber ? parseInt(a.tableNumber, 10) : Number.POSITIVE_INFINITY;
      const tb = b.tableNumber ? parseInt(b.tableNumber, 10) : Number.POSITIVE_INFINITY;
      if (ta !== tb) return ta - tb;
      return a.profileName.localeCompare(b.profileName);
    });

    return { eventId, entries };
  });

/**
 * Company-consolidated agenda for the `cliente` PDF export.
 *
 * Root cause fix for divergence between the per-row "Agenda" button and the
 * company total shown in the cards: when the `cliente` profile downloads an
 * agenda for a row, they expect the FULL COMPANY agenda (all contacts'
 * meetings combined), not the single contact's slice.
 *
 * Scope:
 *  - finds every active profile linked to `companyId`
 *  - collects their `scheduled` meetings in the current event
 *    (visitor meetings via `visitor_profile_id`, exhibitor meetings via
 *    the tables they own)
 *  - returns ONE flat list ordered by start time, tagged with the contact
 *    that owns each meeting
 *
 * Deduplication: meetings are keyed by `meeting.id` so an exhibitor table
 * shared across multiple owners (rare) does not duplicate rows.
 */
export const getCompanyAgenda = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        companyId: z.string().uuid(),
        eventId: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdminOrStaff(context.userId);
    const eventId = await getCurrentEventId(data.eventId);
    if (!eventId) {
      return {
        eventId: null,
        companyId: data.companyId,
        companyName: null as string | null,
        contactCount: 0,
        rows: [] as CompanyAgendaRow[],
      };
    }

    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("id, trade_name")
      .eq("id", data.companyId)
      .maybeSingle();

    const { data: companyProfiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, auth_user_id, is_active")
      .eq("company_id", data.companyId);

    const authIds = Array.from(
      new Set((companyProfiles ?? []).map((p) => p.auth_user_id).filter(Boolean) as string[]),
    );
    const { data: roleRows } = authIds.length
      ? await supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", authIds)
      : { data: [] as Array<{ user_id: string; role: string }> };
    const rolesByAuth = new Map<string, Set<string>>();
    for (const r of roleRows ?? []) {
      const set = rolesByAuth.get(r.user_id) ?? new Set<string>();
      set.add(String(r.role));
      rolesByAuth.set(r.user_id, set);
    }
    const isEligibleParticipant = (p: { auth_user_id: string | null; is_active: boolean | null }) => {
      if (p.is_active === false) return false;
      if (!p.auth_user_id) return false;
      const roles = rolesByAuth.get(p.auth_user_id);
      if (!roles) return false;
      if (roles.has("admin") || roles.has("staff") || roles.has("cliente")) return false;
      return roles.has("visitor") || roles.has("exhibitor");
    };
    const activeProfiles = (companyProfiles ?? []).filter(isEligibleParticipant);
    const profileIds = activeProfiles.map((p) => p.id);

    if (profileIds.length === 0) {
      return {
        eventId,
        companyId: data.companyId,
        companyName: company?.trade_name ?? null,
        contactCount: 0,
        rows: [],
      };
    }

    // Tables owned by any contact of this company (= exhibitor side).
    const { data: ownedTables } = await supabaseAdmin
      .from("event_tables")
      .select("id, table_number, exhibitor_profile_id")
      .eq("event_id", eventId)
      .in("exhibitor_profile_id", profileIds);
    const tableOwnerByTableId = new Map<string, string>();
    for (const t of ownedTables ?? []) {
      if (t.exhibitor_profile_id) tableOwnerByTableId.set(t.id, t.exhibitor_profile_id);
    }
    const ownedTableIds = Array.from(tableOwnerByTableId.keys());

    const meetingsById = new Map<
      string,
      { id: string; table_id: string; slot_id: string; visitor_profile_id: string }
    >();

    const { data: mv } = await supabaseAdmin
      .from("meetings")
      .select("id, table_id, slot_id, visitor_profile_id")
      .eq("event_id", eventId)
      .eq("status", "scheduled")
      .in("visitor_profile_id", profileIds);
    for (const m of mv ?? []) meetingsById.set(m.id, m);

    if (ownedTableIds.length) {
      const { data: mt } = await supabaseAdmin
        .from("meetings")
        .select("id, table_id, slot_id, visitor_profile_id")
        .eq("event_id", eventId)
        .eq("status", "scheduled")
        .in("table_id", ownedTableIds);
      for (const m of mt ?? []) meetingsById.set(m.id, m);
    }

    const meetings = Array.from(meetingsById.values());
    if (meetings.length === 0) {
      return {
        eventId,
        companyId: data.companyId,
        companyName: company?.trade_name ?? null,
        contactCount: profileIds.length,
        rows: [],
      };
    }

    const slotIds = Array.from(new Set(meetings.map((m) => m.slot_id)));
    const allTableIds = Array.from(new Set(meetings.map((m) => m.table_id)));
    const allVisitorIds = Array.from(new Set(meetings.map((m) => m.visitor_profile_id)));

    const [{ data: slots }, { data: tables }, { data: visitorProfs }] = await Promise.all([
      supabaseAdmin.from("time_slots").select("id, start_at, end_at").in("id", slotIds),
      supabaseAdmin
        .from("event_tables")
        .select("id, table_number, exhibitor_profile_id")
        .in("id", allTableIds),
      supabaseAdmin
        .from("profiles")
        .select("id, full_name, company_id")
        .in("id", allVisitorIds),
    ]);

    const exhProfileIds = Array.from(
      new Set(((tables ?? []).map((t) => t.exhibitor_profile_id).filter(Boolean) as string[])),
    );
    const { data: exhProfs } = exhProfileIds.length
      ? await supabaseAdmin
          .from("profiles")
          .select("id, full_name, company_id")
          .in("id", exhProfileIds)
      : { data: [] as Array<{ id: string; full_name: string; company_id: string | null }> };

    const otherCompanyIds = Array.from(
      new Set(
        [
          ...((visitorProfs ?? []).map((v) => v.company_id).filter(Boolean) as string[]),
          ...((exhProfs ?? []).map((p) => p.company_id).filter(Boolean) as string[]),
        ],
      ),
    );
    const { data: otherCompanies } = otherCompanyIds.length
      ? await supabaseAdmin
          .from("companies")
          .select("id, trade_name")
          .in("id", otherCompanyIds)
      : { data: [] as Array<{ id: string; trade_name: string }> };
    const compName = (id: string | null | undefined) =>
      id ? (otherCompanies ?? []).find((c) => c.id === id)?.trade_name ?? "—" : "—";

    const fmt = (iso: string) =>
      iso
        ? new Date(iso).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "America/Sao_Paulo",
          })
        : "";

    const ownProfileName = (id: string) =>
      activeProfiles.find((p) => p.id === id)?.full_name ?? "—";

    const rows: Array<CompanyAgendaRow & { _start: string }> = meetings.map((m) => {
      const ownerProfileId = tableOwnerByTableId.get(m.table_id);
      const isExhibitorMeeting = !!ownerProfileId;
      const slot = (slots ?? []).find((s) => s.id === m.slot_id);
      const tbl = (tables ?? []).find((t) => t.id === m.table_id);
      let contactName: string;
      let withName: string;
      let contactRole: "exhibitor" | "visitor";
      if (isExhibitorMeeting) {
        contactRole = "exhibitor";
        contactName = ownProfileName(ownerProfileId!);
        const v = (visitorProfs ?? []).find((x) => x.id === m.visitor_profile_id);
        withName = v ? `${v.full_name} · ${compName(v.company_id)}` : "—";
      } else {
        contactRole = "visitor";
        contactName = ownProfileName(m.visitor_profile_id);
        const exh = (exhProfs ?? []).find((p) => p.id === tbl?.exhibitor_profile_id);
        withName = exh ? `${compName(exh.company_id)} (${exh.full_name})` : "—";
      }
      const startStr = slot?.start_at ?? "";
      const endStr = slot?.end_at ?? "";
      return {
        _start: startStr,
        time: `${fmt(startStr)} - ${fmt(endStr)}`,
        withName,
        table: tbl?.table_number ? String(tbl.table_number) : "—",
        location: "",
        contactName,
        contactRole,
      };
    });
    rows.sort((a, b) => {
      if (a._start !== b._start) return a._start.localeCompare(b._start);
      return a.contactName.localeCompare(b.contactName);
    });

    return {
      eventId,
      companyId: data.companyId,
      companyName: company?.trade_name ?? null,
      contactCount: profileIds.length,
      rows: rows.map(({ time, withName, table, location, contactName, contactRole }) => ({
        time,
        withName,
        table,
        location,
        contactName,
        contactRole,
      })),
    };
  });