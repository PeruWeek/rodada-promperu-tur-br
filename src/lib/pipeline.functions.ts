import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  COMPANY_CATEGORIES,
  COMPANY_ROLES,
  COMPANY_TYPES,
  NEXT_ACTIONS,
  PRIORITIES,
  REGISTRATION_STATUSES,
  SCHEDULING_STATUSES,
} from "./pipeline.constants";

type Role = "admin" | "staff" | "exhibitor" | "visitor" | "cliente";

async function getRoles(userId: string): Promise<Role[]> {
  const { data } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
  return (data ?? []).map((r) => r.role as Role);
}

async function getCurrentProfileId(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  return data?.id ?? null;
}

async function assertAdminOrStaff(userId: string) {
  const roles = await getRoles(userId);
  if (!roles.includes("admin") && !roles.includes("staff")) throw new Error("Forbidden");
  return roles;
}

async function getActiveEventId(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("events")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

const filtersSchema = z.object({
  eventId: z.string().uuid().optional(),
  search: z.string().trim().optional(),
  role: z.enum(COMPANY_ROLES).optional(),
  companyType: z.enum(COMPANY_TYPES).optional(),
  companyCategory: z.enum(COMPANY_CATEGORIES).optional(),
  country: z.string().trim().optional(),
  state: z.string().trim().optional(),
  city: z.string().trim().optional(),
  registrationStatus: z.enum(REGISTRATION_STATUSES).optional(),
  schedulingStatus: z.enum(SCHEDULING_STATUSES).optional(),
  nextAction: z.enum(NEXT_ACTIONS).optional(),
  ownerProfileId: z.string().uuid().nullable().optional(),
  mine: z.boolean().optional(),
  periodDays: z.number().int().min(1).max(365).nullable().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(50),
});

export const listPipeline = createServerFn({ method: "POST" })
  .inputValidator((input) => filtersSchema.parse(input))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const roles = await assertAdminOrStaff(context.userId);
    const eventId = data.eventId ?? (await getActiveEventId());
    if (!eventId) return { rows: [], total: 0, eventId: null };

    let q = supabaseAdmin
      .from("v_company_event_pipeline")
      .select("*", { count: "exact" })
      .eq("event_id", eventId);

    if (data.role) q = q.eq("company_role", data.role);
    if (data.companyType) q = q.eq("company_type", data.companyType);
    if (data.companyCategory) q = q.eq("company_category", data.companyCategory);
    if (data.country) q = q.eq("country_code", data.country.toUpperCase());
    if (data.state) q = q.eq("state_code", data.state.toUpperCase());
    if (data.city) q = q.ilike("city", `%${data.city}%`);
    if (data.registrationStatus) q = q.eq("registration_status", data.registrationStatus);
    if (data.schedulingStatus) q = q.eq("scheduling_status", data.schedulingStatus);
    if (data.nextAction) q = q.eq("next_action", data.nextAction);
    if (data.ownerProfileId === null) q = q.is("owner_staff_profile_id", null);
    else if (data.ownerProfileId) q = q.eq("owner_staff_profile_id", data.ownerProfileId);

    // Scope to "minha carteira" when caller asks, OR by default for staff-only
    // users when they don't pass `mine` explicitly. Passing `mine: false`
    // always wins so Staff can opt out and ver todos os dados.
    const isStaffOnly = roles.includes("staff") && !roles.includes("admin");
    const scopeMine = data.mine === true || (isStaffOnly && data.mine === undefined);
    if (scopeMine) {
      const myProfileId = await getCurrentProfileId(context.userId);
      if (!myProfileId) return { rows: [], total: 0, eventId };
      q = q.eq("owner_staff_profile_id", myProfileId);
    }

    if (data.periodDays) {
      const since = new Date(Date.now() - data.periodDays * 24 * 60 * 60 * 1000).toISOString();
      q = q.gte("created_at", since);
    }
    if (data.search?.trim()) {
      const term = `%${data.search.trim()}%`;
      q = q.or(`company_trade_name.ilike.${term},primary_contact_name.ilike.${term},primary_contact_email.ilike.${term}`);
    }

    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;
    q = q.order("updated_at", { ascending: false }).range(from, to);

    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? 0, eventId };
  });

export const getPipelineKpis = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      eventId: z.string().uuid().optional(),
      periodDays: z.number().int().min(1).max(365).default(30),
      mine: z.boolean().optional(),
    }).parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const roles = await assertAdminOrStaff(context.userId);
    const eventId = data.eventId ?? (await getActiveEventId());
    if (!eventId) return null;

    // Same opt-out rule as listPipeline.
    const isStaffOnlyKpis = roles.includes("staff") && !roles.includes("admin");
    let scopeOwner: string | null = null;
    if (data.mine === true || (isStaffOnlyKpis && data.mine === undefined)) {
      scopeOwner = await getCurrentProfileId(context.userId);
    }

    let q = supabaseAdmin
      .from("v_company_event_pipeline")
      .select(
        "id, company_role, company_type, company_category, country_code, state_code, city, region_label, registration_status, scheduling_status, next_action, owner_staff_profile_id, owner_name, created_at, next_action_due_at, primary_profile_id",
      )
      .eq("event_id", eventId);
    if (scopeOwner) q = q.eq("owner_staff_profile_id", scopeOwner);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    // Determine which primary contacts have actually created an account.
    const primaryIds = Array.from(
      new Set((rows ?? []).map((r) => r.primary_profile_id as string | null).filter(Boolean) as string[]),
    );
    const { data: confirmedProfs } = primaryIds.length
      ? await supabaseAdmin
          .from("profiles")
          .select("id, auth_user_id")
          .in("id", primaryIds)
      : { data: [] as Array<{ id: string; auth_user_id: string | null }> };
    const confirmedIds = new Set(
      (confirmedProfs ?? []).filter((p) => !!p.auth_user_id).map((p) => p.id),
    );

    const sinceMs = Date.now() - data.periodDays * 24 * 60 * 60 * 1000;
    const tally = <T extends string>(field: T, source: Array<Record<string, unknown>>) => {
      const m = new Map<string, number>();
      for (const r of source) {
        const k = (r[field] as string) ?? "—";
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      return Array.from(m, ([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
    };

    const all = rows ?? [];
    const recent = all.filter((r) => new Date(r.created_at as string).getTime() >= sinceMs);

    // Daily series for the period
    const series = new Map<string, number>();
    for (let i = data.periodDays - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      series.set(d.toISOString().slice(0, 10), 0);
    }
    for (const r of recent) {
      const k = (r.created_at as string).slice(0, 10);
      if (series.has(k)) series.set(k, (series.get(k) ?? 0) + 1);
    }

    const kpis = {
      total: all.length,
      newInPeriod: recent.length,
      confirmedRegistrants: all.filter((r) => confirmedIds.has(r.primary_profile_id as string)).length,
      completed: all.filter((r) => ["cadastro_concluido", "aprovado"].includes(r.registration_status as string)).length,
      incomplete: all.filter((r) => ["nao_iniciado", "em_preenchimento"].includes(r.registration_status as string)).length,
      withoutScheduling: all.filter((r) => r.scheduling_status === "sem_agendamento").length,
      followUpPending: all.filter((r) => r.next_action !== "nenhuma").length,
      awaitingApproval: all.filter((r) => r.registration_status === "aguardando_aprovacao").length,
    };

    return {
      eventId,
      kpis,
      byType: tally("company_type", all),
      byCategory: tally("company_category", all),
      byCountry: tally("country_code", all),
      byState: tally("state_code", all),
      byCity: tally("city", all).slice(0, 10),
      byRegistrationStatus: tally("registration_status", all),
      bySchedulingStatus: tally("scheduling_status", all),
      byOwner: tally("owner_name", all),
      series: Array.from(series, ([date, count]) => ({ date, count })),
    };
  });

export const getPipelineAlerts = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ eventId: z.string().uuid().optional(), mine: z.boolean().optional() }).parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const roles = await assertAdminOrStaff(context.userId);
    const eventId = data.eventId ?? (await getActiveEventId());
    if (!eventId) return null;

    const isStaffOnlyAlerts = roles.includes("staff") && !roles.includes("admin");
    let scopeOwner: string | null = null;
    if (data.mine === true || (isStaffOnlyAlerts && data.mine === undefined)) {
      scopeOwner = await getCurrentProfileId(context.userId);
    }

    const baseSelect =
      "id, company_trade_name, primary_contact_name, registration_status, scheduling_status, next_action, next_action_due_at, owner_name, created_at, region_label";
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const base = () => {
      let q = supabaseAdmin
        .from("v_company_event_pipeline")
        .select(baseSelect)
        .eq("event_id", eventId);
      if (scopeOwner) q = q.eq("owner_staff_profile_id", scopeOwner);
      return q;
    };
    const [a, b, c, d] = await Promise.all([
      base().eq("scheduling_status", "sem_agendamento").eq("registration_status", "cadastro_concluido").limit(5),
      base().in("registration_status", ["nao_iniciado", "em_preenchimento"]).lte("created_at", fourteenDaysAgo).limit(5),
      base().in("next_action", ["ligar_para_confirmar", "aguardar_retorno", "cobrar_documentos"]).limit(5),
      base().eq("registration_status", "aguardando_aprovacao").limit(5),
    ]);
    const withoutScheduling = a.data ?? [];
    const incompleteStale = b.data ?? [];
    const awaitingContact = c.data ?? [];
    const awaitingApproval = d.data ?? [];

    return { withoutScheduling, incompleteStale, awaitingContact, awaitingApproval };
  });

export const listFollowUps = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        eventId: z.string().uuid().optional(),
        mine: z.boolean().optional(),
        sort: z.enum(["priority", "due"]).default("priority"),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const roles = await assertAdminOrStaff(context.userId);
    const eventId = data.eventId ?? (await getActiveEventId());
    if (!eventId) return { rows: [] };

    let q = supabaseAdmin
      .from("v_company_event_pipeline")
      .select("*")
      .eq("event_id", eventId)
      .neq("next_action", "nenhuma");

    const isStaffOnlyFu = roles.includes("staff") && !roles.includes("admin");
    if (data.mine === true || (isStaffOnlyFu && data.mine === undefined)) {
      const myProfileId = await getCurrentProfileId(context.userId);
      if (!myProfileId) return { rows: [] };
      q = q.eq("owner_staff_profile_id", myProfileId);
    }

    const { data: rows, error } = await q
      .order("next_action_due_at", { ascending: true, nullsFirst: false })
      .limit(500);
    if (error) throw new Error(error.message);

    if (data.sort === "priority") {
      const order: Record<string, number> = { alta: 0, media: 1, baixa: 2 };
      (rows ?? []).sort((a, b) => (order[a.priority as string] ?? 3) - (order[b.priority as string] ?? 3));
    }
    return { rows: rows ?? [] };
  });

const patchSchema = z.object({
  company_type: z.enum(COMPANY_TYPES).nullable().optional(),
  company_category: z.enum(COMPANY_CATEGORIES).nullable().optional(),
  registration_status: z.enum(REGISTRATION_STATUSES).optional(),
  scheduling_status: z.enum(SCHEDULING_STATUSES).optional(),
  next_action: z.enum(NEXT_ACTIONS).optional(),
  next_action_due_at: z.string().datetime().nullable().optional(),
  priority: z.enum(PRIORITIES).optional(),
  notes: z.string().max(2000).nullable().optional(),
  last_contact_at: z.string().datetime().nullable().optional(),
  last_contact_channel: z.string().max(40).nullable().optional(),
});

export const updatePipelineEntry = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), patch: patchSchema }).parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const roles = await getRoles(context.userId);
    if (!roles.includes("admin")) throw new Error("Forbidden: admin only");
    const { error } = await supabaseAdmin
      .from("company_event_pipeline")
      .update(data.patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const assignPipelineOwner = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), ownerProfileId: z.string().uuid().nullable() }).parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const roles = await getRoles(context.userId);
    if (!roles.includes("admin")) throw new Error("Forbidden");
    const { error } = await supabaseAdmin
      .from("company_event_pipeline")
      .update({ owner_staff_profile_id: data.ownerProfileId })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const completeNextAction = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        nextAction: z.enum(NEXT_ACTIONS).default("nenhuma"),
        dueAt: z.string().datetime().nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
        channel: z.string().max(40).nullable().optional(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const roles = await getRoles(context.userId);
    if (!roles.includes("admin")) throw new Error("Forbidden: admin only");
    const patch: {
      next_action: typeof data.nextAction;
      next_action_due_at: string | null;
      last_contact_at: string;
      last_contact_channel?: string | null;
      notes?: string | null;
    } = {
      next_action: data.nextAction,
      next_action_due_at: data.dueAt ?? null,
      last_contact_at: new Date().toISOString(),
    };
    if (data.channel !== undefined) patch.last_contact_channel = data.channel;
    if (data.notes !== undefined) patch.notes = data.notes;
    const { error } = await supabaseAdmin
      .from("company_event_pipeline")
      .update(patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listStaffOwners = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminOrStaff(context.userId);
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .in("role", ["admin", "staff"]);
    const ids = (roles ?? []).map((r) => r.user_id);
    if (ids.length === 0) return { owners: [] };
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, auth_user_id")
      .in("auth_user_id", ids)
      .order("full_name");
    return { owners: profs ?? [] };
  });