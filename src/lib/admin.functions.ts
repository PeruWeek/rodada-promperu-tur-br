import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
type JsonObject = { [k: string]: JsonValue };

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const ok = (data ?? []).some((r) => r.role === "admin");
  if (!ok) throw new Error("Forbidden: admin only");
}

async function assertAdminStrict(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const ok = (data ?? []).some((r) => r.role === "admin");
  if (!ok) throw new Error("Forbidden: admin only");
}

// Allows staff for read-only endpoints (lists used by staff dashboards).
async function assertAdminOrStaffRead(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const ok = (data ?? []).some(
    (r) => r.role === "admin" || r.role === "staff" || r.role === "cliente",
  );
  if (!ok) throw new Error("Forbidden");
}

// Admin or staff only (excludes cliente). Use for writes that staff may perform.
async function assertAdminOrStaff(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const ok = (data ?? []).some((r) => r.role === "admin" || r.role === "staff");
  if (!ok) throw new Error("Forbidden");
}

async function getActorProfileId(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  return data?.id ?? null;
}

export const assignExhibitorToTable = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        tableId: z.string().uuid(),
        exhibitorProfileId: z.string().uuid().nullable(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("event_tables")
      .update({ exhibitor_profile_id: data.exhibitorProfileId })
      .eq("id", data.tableId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setUserRole = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        userId: z.string().uuid(),
        // `cliente` is a real business role (kept alongside `visitor`/`exhibitor`).
        // Primary participant transitions should go through
        // `transitionUserPrimaryRole` / `adminSetPrimaryRole`, but this endpoint
        // still accepts the full set so additive ops don't reject legacy roles.
        role: z.enum(["admin", "staff", "exhibitor", "visitor", "cliente"]),
        action: z.enum(["add", "remove"]),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    if (data.action === "add") {
      const { data: existing } = await supabaseAdmin
        .from("user_roles")
        .select("id")
        .eq("user_id", data.userId)
        .eq("role", data.role)
        .maybeSingle();
      if (!existing) {
        await supabaseAdmin.from("user_roles").insert({ user_id: data.userId, role: data.role });
      }
    } else {
      await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", data.userId)
        .eq("role", data.role);
    }
    return { ok: true };
  });

// Transactional swap of a user's primary participant role (visitor ⇄ exhibitor).
// Wraps the SQL RPC `transition_primary_role`, which atomically:
//   - removes legacy/conflicting primary roles (including the legacy `cliente`)
//   - inserts the target role
//   - materializes `visitor_profiles` / `exhibitor_profiles` as needed
//   - preserves `admin` / `staff` if present (they are additive)
//   - writes an audit_logs entry with before/after snapshot
export const transitionUserPrimaryRole = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        userId: z.string().uuid(),
        role: z.enum(["visitor", "exhibitor", "cliente"]),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: result, error } = await supabaseAdmin.rpc("transition_primary_role", {
      p_auth_user_id: data.userId,
      p_target_role: data.role,
    });
    if (error) throw new Error(error.message);
    return { ok: true, result };
  });

export const rebuildSlots = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ eventId: z.string().uuid() }).parse(input))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin.rpc("rebuild_event_time_slots", {
      p_event_id: data.eventId,
      p_deactivate_previous: true,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminSearchProfiles = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        q: z.string().optional(),
        activeOnly: z.boolean().optional(),
        requireAuthUser: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdminOrStaffRead(context.userId);
    let q = supabaseAdmin
      .from("profiles")
      .select("id, auth_user_id, full_name, email, company_id")
      .order("full_name")
      .limit(data.limit ?? 50);
    if (data.activeOnly) q = q.eq("is_active", true);
    if (data.requireAuthUser) q = q.not("auth_user_id", "is", null);
    if (data.q?.trim()) q = q.ilike("full_name", `%${data.q.trim()}%`);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { profiles: rows ?? [] };
  });

// ============================================================
// Companies admin: list + full edit (visitor & exhibitor data)
// ============================================================

export const listAdminCompanies = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        search: z.string().trim().optional(),
        role: z.enum(["all", "visitor", "exhibitor", "cliente"]).default("all"),
        confirmed: z.enum(["all", "yes", "no"]).default("all"),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(5000).default(25),
        activeOnly: z.boolean().optional(),
        lunch: z.enum(["all", "yes", "no"]).optional().default("all"),
        status: z.enum(["active", "inactive", "all"]).optional().default("active"),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdminOrStaffRead(context.userId);

    let q = supabaseAdmin
      .from("companies")
      .select("id, trade_name, legal_name, country_code, state_code, city, whatsapp, phone, general_phone, created_at, is_active, inactivated_at, inactivated_reason")
      .order("trade_name", { ascending: true });
    if (data.status === "active") q = q.eq("is_active", true);
    else if (data.status === "inactive") q = q.eq("is_active", false);
    if (data.search?.trim()) {
      const s = data.search.trim();
      // Also match by contact name/email by resolving company_ids from profiles first.
      const { data: matchedProfiles } = await supabaseAdmin
        .from("profiles")
        .select("company_id")
        .or(`full_name.ilike.%${s}%,email.ilike.%${s}%`)
        .not("company_id", "is", null)
        .limit(500);
      const matchedCompanyIds = Array.from(
        new Set((matchedProfiles ?? []).map((p) => p.company_id).filter(Boolean) as string[]),
      );
      const orParts = [
        `trade_name.ilike.%${s}%`,
        `legal_name.ilike.%${s}%`,
        `tax_id.ilike.%${s}%`,
      ];
      if (matchedCompanyIds.length > 0) {
        orParts.push(`id.in.(${matchedCompanyIds.join(",")})`);
      }
      q = q.or(orParts.join(","));
    }
    // Fetch all matching companies; role/confirmed are computed post-query,
    // so DB-level pagination would produce empty pages when most rows are filtered out.
    q = q.limit(5000);
    const { data: companies, error } = await q;
    if (error) throw new Error(error.message);
    if (!companies || companies.length === 0) return { rows: [], total: 0 };

    const ids = companies.map((c) => c.id);
    const [{ data: profs }, { data: exhProfs }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, full_name, email, whatsapp, phone, company_id, created_at, auth_user_id, is_active")
        .in("company_id", ids)
        .order("created_at", { ascending: true }),
      supabaseAdmin.from("exhibitor_profiles").select("profile_id"),
    ]);
    const exhProfileIds = new Set((exhProfs ?? []).map((e) => e.profile_id));

    const profileIds = (profs ?? []).map((p) => p.id);
    const { data: visProfs } = profileIds.length
      ? await supabaseAdmin
          .from("visitor_profiles")
          .select("profile_id, networking_lunch_participation")
          .in("profile_id", profileIds)
      : { data: [] as { profile_id: string; networking_lunch_participation: boolean | null }[] };
    const lunchByProfile = new Map<string, boolean | null>();
    (visProfs ?? []).forEach((v) =>
      lunchByProfile.set(v.profile_id, v.networking_lunch_participation ?? null),
    );

    // Determine company role from user_roles (source of truth). Owners may
    // hold leftover visitor_profiles/exhibitor_profiles rows after a role
    // transition, so we never infer the primary role from those tables.
    const authIds = (profs ?? [])
      .map((p) => p.auth_user_id)
      .filter((x): x is string => !!x);
    const { data: roleRows } = authIds.length
      ? await supabaseAdmin
          .from("user_roles")
          .select("user_id, role")
          .in("user_id", authIds)
      : { data: [] as { user_id: string; role: string }[] };
    const rolesByAuth = new Map<string, Set<string>>();
    for (const r of roleRows ?? []) {
      const set = rolesByAuth.get(r.user_id) ?? new Set<string>();
      set.add(r.role);
      rolesByAuth.set(r.user_id, set);
    }
    // Priority: cliente > exhibitor > visitor (admin/staff are operational
    // and never used as a company badge).
    const pickPrimary = (
      owners: { id: string; auth_user_id: string | null }[],
    ): "cliente" | "exhibitor" | "visitor" => {
      let hasCliente = false;
      let hasExhRole = false;
      let hasVisRole = false;
      for (const o of owners) {
        const set = o.auth_user_id ? rolesByAuth.get(o.auth_user_id) : null;
        if (!set) continue;
        if (set.has("cliente")) hasCliente = true;
        if (set.has("exhibitor")) hasExhRole = true;
        if (set.has("visitor")) hasVisRole = true;
      }
      if (hasCliente) return "cliente";
      if (hasExhRole) return "exhibitor";
      if (hasVisRole) return "visitor";
      // Pre-confirmed accounts (no auth_user_id yet): fall back to the
      // legacy heuristic so unconfirmed expositor pre-registrations still
      // show up correctly.
      if (owners.some((p) => exhProfileIds.has(p.id))) return "exhibitor";
      return "visitor";
    };

    const rows = companies.map((c) => {
      const allOwners = (profs ?? []).filter((p) => p.company_id === c.id);
      const activeOwners = allOwners.filter((p) => p.is_active !== false);
      const owners = data.activeOnly ? activeOwners : allOwners;
      const primary = owners[0] ?? null;
      const role: "cliente" | "exhibitor" | "visitor" = pickPrimary(owners);
      const confirmed = owners.some((p) => !!p.auth_user_id);
      const lunch = primary ? lunchByProfile.get(primary.id) ?? null : null;
      return {
        id: c.id,
        trade_name: c.trade_name,
        legal_name: c.legal_name,
        country_code: c.country_code,
        state_code: c.state_code,
        city: c.city,
        whatsapp: c.whatsapp ?? null,
        primary_contact: primary
          ? {
              id: primary.id,
              full_name: primary.full_name,
              email: primary.email,
              whatsapp: primary.whatsapp ?? null,
              phone: primary.phone ?? null,
            }
          : null,
        role,
        confirmed,
        hasActiveOwner: activeOwners.length > 0,
        networking_lunch_participation: lunch,
        is_active: (c as { is_active?: boolean }).is_active ?? true,
        inactivated_at: (c as { inactivated_at?: string | null }).inactivated_at ?? null,
        inactivated_reason:
          (c as { inactivated_reason?: string | null }).inactivated_reason ?? null,
      };
    });

    let filtered = rows;
    if (data.activeOnly) filtered = filtered.filter((r) => r.hasActiveOwner);
    if (data.role !== "all") filtered = filtered.filter((r) => r.role === data.role);
    if (data.confirmed === "yes") filtered = filtered.filter((r) => r.confirmed);
    else if (data.confirmed === "no") filtered = filtered.filter((r) => !r.confirmed);
    if (data.lunch === "yes") filtered = filtered.filter((r) => r.networking_lunch_participation === true);
    else if (data.lunch === "no") filtered = filtered.filter((r) => r.networking_lunch_participation === false);
    const total = filtered.length;
    const from = (data.page - 1) * data.pageSize;
    const paged = filtered.slice(from, from + data.pageSize);
    return { rows: paged, total };
  });

export const setVisitorLunchParticipation = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        profileId: z.string().uuid(),
        value: z.boolean(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdminOrStaff(context.userId);
    const { data: existing } = await supabaseAdmin
      .from("visitor_profiles")
      .select("id")
      .eq("profile_id", data.profileId)
      .maybeSingle();
    if (existing) {
      const { error } = await supabaseAdmin
        .from("visitor_profiles")
        .update({ networking_lunch_participation: data.value })
        .eq("profile_id", data.profileId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from("visitor_profiles")
        .insert({ profile_id: data.profileId, networking_lunch_participation: data.value });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const getCompanyForEdit = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ companyId: z.string().uuid() }).parse(input))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: company, error } = await supabaseAdmin
      .from("companies")
      .select("*")
      .eq("id", data.companyId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!company) throw new Error("Empresa não encontrada");

    const { data: owners } = await supabaseAdmin
      .from("profiles")
      .select("id, auth_user_id, full_name, email, job_title, phone, whatsapp, preferred_language, created_at")
      .eq("company_id", data.companyId)
      .order("created_at", { ascending: true });
    const primary = owners?.[0] ?? null;

    let visitorProfile: JsonObject | null = null;
    let exhibitorProfile: JsonObject | null = null;
    if (primary) {
      const [v, e] = await Promise.all([
        supabaseAdmin.from("visitor_profiles").select("*").eq("profile_id", primary.id).maybeSingle(),
        supabaseAdmin.from("exhibitor_profiles").select("*").eq("profile_id", primary.id).maybeSingle(),
      ]);
      visitorProfile = (v.data as unknown as JsonObject | null) ?? null;
      exhibitorProfile = (e.data as unknown as JsonObject | null) ?? null;
    }
    // Source of truth for the primary role is `user_roles`. Visitor/exhibitor
    // profile rows may coexist after a role transition and must not be used
    // to infer the primary role.
    let role: "cliente" | "exhibitor" | "visitor" = "visitor";
    if (primary?.auth_user_id) {
      const { data: roleRows } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", primary.auth_user_id);
      const set = new Set((roleRows ?? []).map((r) => r.role as string));
      if (set.has("cliente")) role = "cliente";
      else if (set.has("exhibitor")) role = "exhibitor";
      else if (set.has("visitor")) role = "visitor";
      else role = exhibitorProfile ? "exhibitor" : "visitor";
    } else {
      role = exhibitorProfile ? "exhibitor" : "visitor";
    }
    return {
      company: company as unknown as JsonObject,
      primaryProfile: (primary as unknown as JsonObject | null) ?? null,
      visitorProfile,
      exhibitorProfile,
      role,
    };
  });

const companyPatchSchema = z.object({
  trade_name: z.string().trim().min(2).max(160),
  legal_name: z.string().trim().max(160).nullable().optional(),
  tax_id: z.string().trim().max(40).nullable().optional(),
  registration_id: z.string().trim().max(40).nullable().optional(),
  country_code: z.string().trim().min(2).max(3),
  state_code: z.string().trim().max(8).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  address: z.string().trim().max(255).nullable().optional(),
  website: z.string().trim().max(255).nullable().optional(),
  instagram: z.string().trim().max(255).nullable().optional(),
  linkedin: z.string().trim().max(255).nullable().optional(),
  general_phone: z.string().trim().max(40).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  whatsapp: z.string().trim().max(40).nullable().optional(),
  specialty: z.string().trim().max(255).nullable().optional(),
  import_profile: z.string().trim().max(2000).nullable().optional(),
});

const profilePatchSchema = z.object({
  full_name: z.string().trim().min(2).max(160),
  job_title: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  whatsapp: z.string().trim().max(40).nullable().optional(),
  preferred_language: z.enum(["pt-BR", "es"]),
});

const visitorPatchSchema = z.object({
  buyer_types: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  interests_segments: z.array(z.string()).max(50),
  interests_destinations: z.array(z.string()).max(50),
  interests_destinations_free: z.string().max(500).nullable().optional(),
  interests_services: z.array(z.string()).max(50),
  portfolio_pt: z.string().max(4000).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  consent_marketing: z.boolean(),
});

const exhibitorPatchSchema = z.object({
  segments: z.array(z.string()).max(50),
  destinations: z.array(z.string()).max(50),
  services: z.array(z.string()).max(50),
  target_buyers: z.array(z.string()).max(50),
  pitch_pt: z.string().max(4000).nullable().optional(),
  pitch_es: z.string().max(4000).nullable().optional(),
  portfolio_pt: z.string().max(4000).nullable().optional(),
  portfolio_es: z.string().max(4000).nullable().optional(),
  materials_links: z.array(z.string().max(500)).max(20),
});

export const updateCompanyFull = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        companyId: z.string().uuid(),
        profileId: z.string().uuid().nullable(),
        company: companyPatchSchema,
        profile: profilePatchSchema.nullable().optional(),
        visitor: visitorPatchSchema.nullable().optional(),
        exhibitor: exhibitorPatchSchema.nullable().optional(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);

    // Empty-string → null for company optional text fields
    const c = data.company;
    const companyUpdate = {
      trade_name: c.trade_name,
      legal_name: c.legal_name || null,
      tax_id: c.tax_id || null,
      registration_id: c.registration_id || null,
      country_code: c.country_code,
      state_code: c.state_code ? c.state_code.toUpperCase() : null,
      city: c.city || null,
      address: c.address || null,
      website: c.website || null,
      instagram: c.instagram || null,
      linkedin: c.linkedin || null,
      general_phone: c.general_phone || null,
      phone: c.phone || null,
      whatsapp: c.whatsapp || null,
      specialty: c.specialty || null,
      import_profile: c.import_profile || null,
    } satisfies Partial<{
      trade_name: string;
      legal_name: string | null;
      tax_id: string | null;
      registration_id: string | null;
      country_code: string;
      state_code: string | null;
      city: string | null;
      address: string | null;
      website: string | null;
      instagram: string | null;
      linkedin: string | null;
      general_phone: string | null;
      phone: string | null;
      whatsapp: string | null;
      specialty: string | null;
      import_profile: string | null;
    }>;
    const { error: cErr } = await supabaseAdmin.from("companies").update(companyUpdate).eq("id", data.companyId);
    if (cErr) throw new Error(cErr.message);

    if (data.profile && data.profileId) {
      const p = data.profile;
      const { error: pErr } = await supabaseAdmin
        .from("profiles")
        .update({
          full_name: p.full_name,
          job_title: p.job_title || null,
          phone: p.phone || null,
          whatsapp: p.whatsapp || null,
          preferred_language: p.preferred_language,
        })
        .eq("id", data.profileId);
      if (pErr) throw new Error(pErr.message);
    }

    if (data.visitor && data.profileId) {
      const v = data.visitor;
      const { error: vErr } = await supabaseAdmin.from("visitor_profiles").upsert({
        profile_id: data.profileId,
        buyer_type: v.buyer_types[0] ?? null,
        buyer_types: v.buyer_types,
        interests_segments: v.interests_segments,
        interests_destinations: v.interests_destinations,
        interests_destinations_free: v.interests_destinations_free || null,
        interests_services: v.interests_services,
        portfolio_pt: v.portfolio_pt || null,
        notes: v.notes || null,
        consent_marketing: v.consent_marketing,
      });
      if (vErr) throw new Error(vErr.message);
    }

    if (data.exhibitor && data.profileId) {
      const e = data.exhibitor;
      const { error: eErr } = await supabaseAdmin.from("exhibitor_profiles").upsert({
        profile_id: data.profileId,
        segments: e.segments,
        destinations: e.destinations,
        services: e.services,
        target_buyers: e.target_buyers,
        pitch_pt: e.pitch_pt || null,
        pitch_es: e.pitch_es || null,
        portfolio_pt: e.portfolio_pt || null,
        portfolio_es: e.portfolio_es || null,
        materials_links: e.materials_links.filter((m) => m.trim() !== ""),
      });
      if (eErr) throw new Error(eErr.message);
    }

    return { ok: true };
  });

// ============================================================
// Event tables: create / rename / delete
// ============================================================

export const createEventTable = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        eventId: z.string().uuid(),
        tableNumber: z.number().int().positive().max(10000).optional(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdminStrict(context.userId);

    let tableNumber = data.tableNumber;
    if (!tableNumber) {
      const { data: maxRow } = await supabaseAdmin
        .from("event_tables")
        .select("table_number")
        .eq("event_id", data.eventId)
        .order("table_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      tableNumber = (maxRow?.table_number ?? 0) + 1;
    } else {
      const { data: dup } = await supabaseAdmin
        .from("event_tables")
        .select("id")
        .eq("event_id", data.eventId)
        .eq("table_number", tableNumber)
        .maybeSingle();
      if (dup) throw new Error(`Já existe uma mesa com o número ${tableNumber}.`);
    }

    const { data: inserted, error } = await supabaseAdmin
      .from("event_tables")
      .insert({ event_id: data.eventId, table_number: tableNumber })
      .select("id, table_number")
      .single();
    if (error) throw new Error(error.message);

    const actor = await getActorProfileId(context.userId);
    await supabaseAdmin.from("audit_logs").insert({
      event_id: data.eventId,
      actor_profile_id: actor,
      action: "event_table.created",
      payload: { table_id: inserted.id, table_number: inserted.table_number },
    });
    return { table: inserted };
  });

export const updateEventTable = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        tableId: z.string().uuid(),
        tableNumber: z.number().int().positive().max(10000),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdminStrict(context.userId);
    const { data: row, error: gErr } = await supabaseAdmin
      .from("event_tables")
      .select("id, event_id, table_number")
      .eq("id", data.tableId)
      .maybeSingle();
    if (gErr) throw new Error(gErr.message);
    if (!row) throw new Error("Mesa não encontrada");
    if (row.table_number === data.tableNumber) return { ok: true };
    const { data: dup } = await supabaseAdmin
      .from("event_tables")
      .select("id")
      .eq("event_id", row.event_id)
      .eq("table_number", data.tableNumber)
      .maybeSingle();
    if (dup) throw new Error(`Já existe uma mesa com o número ${data.tableNumber}.`);
    const { error } = await supabaseAdmin
      .from("event_tables")
      .update({ table_number: data.tableNumber })
      .eq("id", data.tableId);
    if (error) throw new Error(error.message);

    const actor = await getActorProfileId(context.userId);
    await supabaseAdmin.from("audit_logs").insert({
      event_id: row.event_id,
      actor_profile_id: actor,
      action: "event_table.renumbered",
      payload: { table_id: row.id, old_number: row.table_number, new_number: data.tableNumber },
    });
    return { ok: true };
  });

export const deleteEventTable = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ tableId: z.string().uuid() }).parse(input))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdminStrict(context.userId);
    const { data: row } = await supabaseAdmin
      .from("event_tables")
      .select("id, event_id, table_number")
      .eq("id", data.tableId)
      .maybeSingle();
    if (!row) throw new Error("Mesa não encontrada");

    const { count: scheduledCount } = await supabaseAdmin
      .from("meetings")
      .select("id", { count: "exact", head: true })
      .eq("table_id", data.tableId)
      .eq("status", "scheduled");
    if ((scheduledCount ?? 0) > 0) {
      throw new Error(
        `Não é possível excluir: existem ${scheduledCount} reunião(ões) agendada(s) nesta mesa. Cancele ou remaneje antes.`,
      );
    }

    // Block if any meeting (any status) exists — FK is ON DELETE RESTRICT.
    const { count: anyMeetings } = await supabaseAdmin
      .from("meetings")
      .select("id", { count: "exact", head: true })
      .eq("table_id", data.tableId);
    if ((anyMeetings ?? 0) > 0) {
      throw new Error(
        `Não é possível excluir: existem ${anyMeetings} reunião(ões) (canceladas ou concluídas) ligadas a esta mesa.`,
      );
    }

    // time_slots cascade on delete; staff_table_assignments also cascade.
    const { error } = await supabaseAdmin.from("event_tables").delete().eq("id", data.tableId);
    if (error) throw new Error(error.message);

    const actor = await getActorProfileId(context.userId);
    await supabaseAdmin.from("audit_logs").insert({
      event_id: row.event_id,
      actor_profile_id: actor,
      action: "event_table.deleted",
      payload: { table_id: row.id, table_number: row.table_number },
    });
    return { ok: true };
  });

// ============================================================
// Orphan / Unpublished exhibitors (admin operational panels)
// ============================================================
// All these serverFns intentionally run with the admin's REAL session
// (context.supabase from requireSupabaseAuth) so the underlying SECURITY
// DEFINER RPCs can validate is_admin_or_staff(auth.uid()) and log the
// real actor_profile_id in audit_logs. supabaseAdmin is NOT used here.

export const listOrphanExhibitors = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("admin_list_orphan_exhibitors");
    if (error) throw new Error(error.message);
    return { rows: data ?? [] };
  });

export const listUnpublishedExhibitors = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("admin_list_unpublished_exhibitors");
    if (error) throw new Error(error.message);
    return { rows: data ?? [] };
  });

export const searchCompaniesForLink = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        query: z.string().trim().min(1).max(120),
        limit: z.number().int().min(1).max(20).default(10),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdminOrStaffRead(context.userId);
    const s = data.query;
    const { data: companies, error } = await context.supabase
      .from("companies")
      .select("id, trade_name, country_code, state_code, city")
      .or(`trade_name.ilike.%${s}%,legal_name.ilike.%${s}%`)
      .eq("is_active", true)
      .order("trade_name", { ascending: true })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    if (!companies || companies.length === 0) return { rows: [] };

    // Compute role_hint for each candidate: 'exhibitor' | 'visitor' | 'mixed' | 'empty'
    const ids = companies.map((c) => c.id);
    const { data: profs } = await context.supabase
      .from("profiles")
      .select("id, auth_user_id, company_id")
      .in("company_id", ids);
    const profIds = (profs ?? []).map((p) => p.id);
    const authIds = (profs ?? []).map((p) => p.auth_user_id).filter((x): x is string => !!x);
    const [{ data: exhProfs }, { data: roles }] = await Promise.all([
      profIds.length
        ? context.supabase.from("exhibitor_profiles").select("profile_id").in("profile_id", profIds)
        : Promise.resolve({ data: [] as { profile_id: string }[] }),
      authIds.length
        ? context.supabase.from("user_roles").select("user_id, role").in("user_id", authIds)
        : Promise.resolve({ data: [] as { user_id: string; role: string }[] }),
    ]);
    const exhProfileIds = new Set((exhProfs ?? []).map((e) => e.profile_id));
    const rolesByAuth = new Map<string, Set<string>>();
    for (const r of roles ?? []) {
      const set = rolesByAuth.get(r.user_id) ?? new Set();
      set.add(r.role);
      rolesByAuth.set(r.user_id, set);
    }

    const rows = companies.map((c) => {
      const owners = (profs ?? []).filter((p) => p.company_id === c.id);
      const hasExh = owners.some(
        (p) =>
          exhProfileIds.has(p.id) ||
          (p.auth_user_id && rolesByAuth.get(p.auth_user_id)?.has("exhibitor")),
      );
      const hasVis = owners.some(
        (p) => p.auth_user_id && rolesByAuth.get(p.auth_user_id)?.has("visitor"),
      );
      let role_hint: "exhibitor" | "visitor" | "mixed" | "empty";
      if (hasExh && hasVis) role_hint = "mixed";
      else if (hasExh) role_hint = "exhibitor";
      else if (hasVis) role_hint = "visitor";
      else role_hint = owners.length > 0 ? "visitor" : "empty";
      return { ...c, role_hint };
    });
    return { rows };
  });

export const linkOrphanToCompany = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        profileId: z.string().uuid(),
        companyId: z.string().uuid(),
        force: z.boolean().default(false),
        forceReason: z.string().trim().max(500).optional(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("admin_link_orphan_to_company", {
      p_profile_id: data.profileId,
      p_company_id: data.companyId,
      p_force: data.force,
      p_force_reason: data.forceReason ?? (null as unknown as string),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const createCompanyForOrphan = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        profileId: z.string().uuid(),
        trade_name: z.string().trim().min(2).max(160),
        country_code: z.string().trim().min(2).max(3),
        city: z.string().trim().max(120).optional(),
        legal_name: z.string().trim().max(160).optional(),
        state_code: z.string().trim().max(8).optional(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { data: companyId, error } = await context.supabase.rpc(
      "admin_create_company_for_orphan",
      {
        p_profile_id: data.profileId,
        p_trade_name: data.trade_name,
        p_country_code: data.country_code,
        p_city: (data.city ?? null) as unknown as string,
        p_legal_name: (data.legal_name ?? null) as unknown as string,
        p_state_code: (data.state_code ?? null) as unknown as string,
      },
    );
    if (error) throw new Error(error.message);
    return { companyId: companyId as string };
  });