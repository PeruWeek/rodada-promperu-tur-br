import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  VISITOR_REQUIRED_FIELDS,
  EXHIBITOR_REQUIRED_FIELDS,
  computeMissing as computeMissingCentral,
  type RegistrationKind as CentralRegistrationKind,
} from "@/lib/registration-requirements";

// Required-fields contract: single source of truth lives in
// `src/lib/registration-requirements.ts`. Re-exported for backwards compat.
export const VISITOR_REQUIRED = VISITOR_REQUIRED_FIELDS;
export const EXHIBITOR_REQUIRED = EXHIBITOR_REQUIRED_FIELDS;

export type RegistrationKind = CentralRegistrationKind;

export type RegistrationDetails = {
  profileId: string;
  authUserId: string | null;
  kind: RegistrationKind;
  profile: {
    full_name: string;
    job_title: string | null;
    whatsapp: string | null;
    phone: string | null;
    preferred_language: "pt-BR" | "es";
    email: string | null;
  };
  company: {
    id: string | null;
    trade_name: string;
    legal_name: string | null;
    tax_id: string | null;
    city: string | null;
    state_code: string | null;
    country_code: string | null;
  };
  visitor: {
    buyer_types: string[];
    interests_segments: string[];
    interests_destinations: string[];
    interests_services: string[];
    networking_lunch_participation: boolean | null;
    image_authorization: boolean | null;
    consent_data_sharing: boolean;
  } | null;
  exhibitor: {
    segments: string[];
    services: string[];
    destinations: string[];
  } | null;
  missing: string[];
  status: "incompleto" | "completo";
};

export function computeMissing(input: {
  kind: RegistrationKind;
  profile: Partial<RegistrationDetails["profile"]>;
  company: Partial<RegistrationDetails["company"]>;
  visitor?: Partial<NonNullable<RegistrationDetails["visitor"]>> | null;
  exhibitor?: Partial<NonNullable<RegistrationDetails["exhibitor"]>> | null;
}): string[] {
  return computeMissingCentral({
    kind: input.kind,
    profile: input.profile as Record<string, unknown>,
    company: input.company as Record<string, unknown>,
    visitor: (input.visitor ?? undefined) as Record<string, unknown> | undefined,
    exhibitor: (input.exhibitor ?? undefined) as Record<string, unknown> | undefined,
  });
}

async function assertStaffOrAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const ok = (data ?? []).some((r) => r.role === "admin" || r.role === "staff");
  if (!ok) throw new Error("Forbidden: somente Staff/Admin podem completar cadastros.");
}

async function loadDetails(profileId: string): Promise<RegistrationDetails> {
  const { data: profile, error: pErr } = await supabaseAdmin
    .from("profiles")
    .select(
      "id, auth_user_id, full_name, email, job_title, whatsapp, phone, preferred_language, company_id",
    )
    .eq("id", profileId)
    .maybeSingle();
  if (pErr) throw new Error(pErr.message);
  if (!profile) throw new Error("Perfil não encontrado.");

  const [{ data: company }, { data: exh }, { data: vis }] = await Promise.all([
    profile.company_id
      ? supabaseAdmin
          .from("companies")
          .select("id, trade_name, legal_name, tax_id, city, state_code, country_code")
          .eq("id", profile.company_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin
      .from("exhibitor_profiles")
      .select("segments, services, destinations")
      .eq("profile_id", profileId)
      .maybeSingle(),
    supabaseAdmin
      .from("visitor_profiles")
      .select(
        "buyer_types, interests_segments, interests_destinations, interests_services, networking_lunch_participation, image_authorization, consent_data_sharing",
      )
      .eq("profile_id", profileId)
      .maybeSingle(),
  ]);

  const kind: RegistrationKind = exh ? "exhibitor" : "visitor";

  const payload: RegistrationDetails = {
    profileId,
    authUserId: profile.auth_user_id,
    kind,
    profile: {
      full_name: profile.full_name ?? "",
      job_title: profile.job_title,
      whatsapp: profile.whatsapp,
      phone: profile.phone,
      preferred_language: profile.preferred_language as "pt-BR" | "es",
      email: profile.email as string | null,
    },
    company: {
      id: company?.id ?? null,
      trade_name: company?.trade_name ?? "",
      legal_name: company?.legal_name ?? null,
      tax_id: company?.tax_id ?? null,
      city: company?.city ?? null,
      state_code: company?.state_code ?? null,
      country_code: company?.country_code ?? null,
    },
    visitor: kind === "visitor"
      ? {
          buyer_types: vis?.buyer_types ?? [],
          interests_segments: vis?.interests_segments ?? [],
          interests_destinations: vis?.interests_destinations ?? [],
          interests_services: vis?.interests_services ?? [],
          networking_lunch_participation: vis?.networking_lunch_participation ?? null,
          image_authorization: vis?.image_authorization ?? null,
          consent_data_sharing: vis?.consent_data_sharing ?? false,
        }
      : null,
    exhibitor: kind === "exhibitor"
      ? {
          segments: exh?.segments ?? [],
          services: exh?.services ?? [],
          destinations: exh?.destinations ?? [],
        }
      : null,
    missing: [],
    status: "incompleto",
  };
  payload.missing = computeMissing(payload);
  payload.status = payload.missing.length === 0 ? "completo" : "incompleto";
  return payload;
}

export const staffGetRegistrationDetails = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ profileId: z.string().uuid() }).parse(input))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertStaffOrAdmin(context.userId);
    return loadDetails(data.profileId);
  });

export const staffListRegistrationCompletion = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ profileIds: z.array(z.string().uuid()).max(2000) }).parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertStaffOrAdmin(context.userId);
    const ids = Array.from(new Set(data.profileIds));
    if (ids.length === 0) return { byId: {} as Record<string, { status: "completo" | "incompleto"; missing: number; kind: RegistrationKind }> };

    const [{ data: profiles }, { data: visitors }, { data: exhibitors }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, full_name, job_title, whatsapp, preferred_language, company_id")
        .in("id", ids),
      supabaseAdmin
        .from("visitor_profiles")
        .select(
          "profile_id, buyer_types, networking_lunch_participation, image_authorization, consent_data_sharing",
        )
        .in("profile_id", ids),
      supabaseAdmin
        .from("exhibitor_profiles")
        .select("profile_id, segments, services")
        .in("profile_id", ids),
    ]);

    const companyIds = Array.from(
      new Set((profiles ?? []).map((p) => p.company_id).filter(Boolean) as string[]),
    );
    const { data: companies } = companyIds.length
      ? await supabaseAdmin
          .from("companies")
          .select("id, trade_name, tax_id, city, state_code")
          .in("id", companyIds)
      : { data: [] as Array<{ id: string; trade_name: string; tax_id: string | null; city: string | null; state_code: string | null }> };

    const visById = new Map((visitors ?? []).map((v) => [v.profile_id, v]));
    const exhById = new Map((exhibitors ?? []).map((e) => [e.profile_id, e]));
    const compById = new Map((companies ?? []).map((c) => [c.id, c]));

    const byId: Record<string, { status: "completo" | "incompleto"; missing: number; kind: RegistrationKind }> = {};
    for (const p of profiles ?? []) {
      const exh = exhById.get(p.id);
      const vis = visById.get(p.id);
      const kind: RegistrationKind = exh ? "exhibitor" : "visitor";
      const company = p.company_id ? compById.get(p.company_id) : undefined;
      const missing = computeMissing({
        kind,
        profile: p as Partial<RegistrationDetails["profile"]>,
        company: (company ?? {}) as Partial<RegistrationDetails["company"]>,
        visitor: vis as never,
        exhibitor: exh as never,
      });
      byId[p.id] = {
        status: missing.length === 0 ? "completo" : "incompleto",
        missing: missing.length,
        kind,
      };
    }
    return { byId };
  });

const patchSchema = z.object({
  profileId: z.string().uuid(),
  profile: z
    .object({
      full_name: z.string().trim().min(2).max(160).optional(),
      job_title: z.string().trim().max(120).optional().nullable(),
      whatsapp: z.string().trim().max(40).optional().nullable(),
      phone: z.string().trim().max(40).optional().nullable(),
      preferred_language: z.enum(["pt-BR", "es"]).optional(),
    })
    .optional(),
  company: z
    .object({
      trade_name: z.string().trim().min(2).max(200).optional(),
      legal_name: z.string().trim().max(200).optional().nullable(),
      tax_id: z.string().trim().max(40).optional().nullable(),
      city: z.string().trim().max(120).optional().nullable(),
      state_code: z.string().trim().max(8).optional().nullable(),
    })
    .optional(),
  visitor: z
    .object({
      buyer_types: z.array(z.string()).optional(),
      interests_segments: z.array(z.string()).optional(),
      interests_destinations: z.array(z.string()).optional(),
      interests_services: z.array(z.string()).optional(),
      networking_lunch_participation: z.boolean().optional().nullable(),
      image_authorization: z.boolean().optional().nullable(),
      consent_data_sharing: z.boolean().optional(),
    })
    .optional(),
  exhibitor: z
    .object({
      segments: z.array(z.string()).optional(),
      services: z.array(z.string()).optional(),
      destinations: z.array(z.string()).optional(),
    })
    .optional(),
});

export const staffCompleteRegistration = createServerFn({ method: "POST" })
  .inputValidator((input) => patchSchema.parse(input))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertStaffOrAdmin(context.userId);

    // Read current state to know companyId and kind
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, company_id, preferred_language")
      .eq("id", data.profileId)
      .maybeSingle();
    if (!profile) throw new Error("Perfil não encontrado.");

    if (data.profile && Object.keys(data.profile).length > 0) {
      const { error } = await supabaseAdmin
        .from("profiles")
        .update(data.profile)
        .eq("id", data.profileId);
      if (error) throw new Error(`profiles: ${error.message}`);
    }

    // Persist company. If profile has no company_id yet (imported stub),
    // create the company first and link the profile. This is REQUIRED so
    // that `tax_id`/`city`/`state_code`/`trade_name` actually persist —
    // otherwise the trigger blocks `signup_completed_at` with
    // `company_required` / `tax_id_required` and the user sees the modal
    // staying "incompleto" even after filling every field.
    let companyId = profile.company_id as string | null;
    if (data.company && Object.keys(data.company).length > 0) {
      if (companyId) {
        const { error } = await supabaseAdmin
          .from("companies")
          .update(data.company)
          .eq("id", companyId);
        if (error) throw new Error(`companies: ${error.message}`);
      } else {
        const insertPayload = {
          trade_name: data.company.trade_name ?? "(sem nome)",
          legal_name: data.company.legal_name ?? null,
          tax_id: data.company.tax_id ?? null,
          city: data.company.city ?? null,
          state_code: data.company.state_code ?? null,
          country_code: "BR",
        };
        const { data: created, error } = await supabaseAdmin
          .from("companies")
          .insert(insertPayload)
          .select("id")
          .single();
        if (error) throw new Error(`companies (insert): ${error.message}`);
        companyId = created.id;
        const { error: linkErr } = await supabaseAdmin
          .from("profiles")
          .update({ company_id: companyId })
          .eq("id", data.profileId);
        if (linkErr) throw new Error(`profiles.company_id: ${linkErr.message}`);
      }
    }

    if (data.visitor) {
      const { data: existing } = await supabaseAdmin
        .from("visitor_profiles")
        .select("profile_id")
        .eq("profile_id", data.profileId)
        .maybeSingle();
      const patch = { ...data.visitor };
      if (existing) {
        const { error } = await supabaseAdmin
          .from("visitor_profiles")
          .update(patch)
          .eq("profile_id", data.profileId);
        if (error) throw new Error(`visitor_profiles: ${error.message}`);
      } else {
        const { error } = await supabaseAdmin
          .from("visitor_profiles")
          .insert({ profile_id: data.profileId, ...patch });
        if (error) throw new Error(`visitor_profiles: ${error.message}`);
      }
    }

    if (data.exhibitor) {
      const { data: existing } = await supabaseAdmin
        .from("exhibitor_profiles")
        .select("profile_id")
        .eq("profile_id", data.profileId)
        .maybeSingle();
      if (existing) {
        const { error } = await supabaseAdmin
          .from("exhibitor_profiles")
          .update(data.exhibitor)
          .eq("profile_id", data.profileId);
        if (error) throw new Error(`exhibitor_profiles: ${error.message}`);
      } else {
        const { error } = await supabaseAdmin
          .from("exhibitor_profiles")
          .insert({ profile_id: data.profileId, ...data.exhibitor });
        if (error) throw new Error(`exhibitor_profiles: ${error.message}`);
      }
    }

    // Mark visitor signup_completed_at when newly complete. We check the
    // update error explicitly and re-read so we never report "completo"
    // when the trigger silently rejected the timestamp write (which used
    // to leave users stuck as "incompleto" forever).
    const fresh = await loadDetails(data.profileId);
    if (fresh.status === "completo" && fresh.kind === "visitor") {
      const { error: completeErr } = await supabaseAdmin
        .from("visitor_profiles")
        .update({ signup_completed_at: new Date().toISOString() })
        .eq("profile_id", data.profileId)
        .is("signup_completed_at", null);
      if (completeErr) {
        throw new Error(
          `Não foi possível concluir o cadastro: ${completeErr.message}`,
        );
      }
      // Re-load so the dialog reflects the new signup_completed_at state.
      const confirmed = await loadDetails(data.profileId);
      console.log(
        `[staff-registration] staff=${context.userId} completed profile=${data.profileId} status=${confirmed.status}`,
      );
      return confirmed;
    }

    console.log(
      `[staff-registration] staff=${context.userId} completed profile=${data.profileId} status=${fresh.status} missing=${fresh.missing.length}`,
    );
    return fresh;
  });