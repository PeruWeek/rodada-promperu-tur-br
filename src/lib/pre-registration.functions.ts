import { createServerFn } from "@tanstack/react-start";
import Papa from "papaparse";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { formatBRPhone, isValidBRPhone, normalizeBRPhoneForMask } from "@/lib/validation/br-masks";

// Canonical CSV headers (case-insensitive, language-independent). Admins
// download a template from the Pré-cadastros tab.
export const PRE_REG_CSV_HEADERS = [
  "trade_name",
  "legal_name",
  "tax_id",
  "country_code",
  "state_code",
  "city",
  "full_name",
  "job_title",
  "email",
  "phone",
  "whatsapp",
  "preferred_language",
] as const;

type Outcome =
  | "created"
  | "updated"
  | "skipped_existing_filled"
  | "error";

export type ImportRowResult = {
  line: number;
  email: string | null;
  outcome: Outcome;
  message?: string;
};

const rowSchema = z.object({
  trade_name: z.string().trim().min(1, "trade_name required").max(255),
  legal_name: z.string().trim().max(255).optional().default(""),
  tax_id: z.string().trim().max(64).optional().default(""),
  country_code: z
    .string()
    .trim()
    .max(2)
    .transform((v) => (v ? v.toUpperCase() : "BR"))
    .optional()
    .default("BR"),
  state_code: z.string().trim().max(8).optional().default(""),
  city: z.string().trim().max(120).optional().default(""),
  full_name: z.string().trim().min(1, "full_name required").max(255),
  job_title: z.string().trim().max(255).optional().default(""),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("invalid email")
    .max(255),
  phone: z.string().trim().max(64).optional().default(""),
  whatsapp: z.string().trim().max(64).optional().default(""),
  preferred_language: z
    .enum(["pt-BR", "es"])
    .optional()
    .default("pt-BR"),
});

function normPhone(v: string): string | null {
  const digits = v.replace(/\D+/g, "");
  return digits.length === 0 ? null : digits;
}
function emptyToNull(v: string): string | null {
  return v.trim() === "" ? null : v.trim();
}

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const ok = (data ?? []).some((r) => r.role === "admin");
  if (!ok) throw new Error("Forbidden");
}

export const importPreRegistrationsCsv = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        csv: z.string().min(1).max(5_000_000), // ~5MB
        eventId: z.string().uuid(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Verify event exists.
    const { data: ev } = await supabaseAdmin
      .from("events")
      .select("id")
      .eq("id", data.eventId)
      .maybeSingle();
    if (!ev) throw new Error("Event not found");

    const parsed = Papa.parse<Record<string, string>>(data.csv, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
    });
    if (parsed.errors.length > 0 && parsed.data.length === 0) {
      throw new Error(`CSV parse error: ${parsed.errors[0]?.message ?? "unknown"}`);
    }
    const rows = parsed.data;
    if (rows.length === 0) {
      return {
        total: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
        results: [] as ImportRowResult[],
      };
    }
    if (rows.length > 5000) throw new Error("Too many rows (max 5000)");

    const results: ImportRowResult[] = [];
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (let i = 0; i < rows.length; i++) {
      const line = i + 2; // header is line 1
      const raw = rows[i];
      try {
        const r = rowSchema.parse(raw);

        // ----- companies upsert (by tax_id when present) -----
        let companyId: string | null = null;
        const taxId = r.tax_id ? r.tax_id : null;
        if (taxId) {
          const { data: existing } = await supabaseAdmin
            .from("companies")
            .select("id, legal_name, country_code, state_code, city")
            .eq("tax_id", taxId)
            .maybeSingle();
          if (existing) {
            companyId = existing.id;
            const patch: {
              legal_name?: string;
              country_code?: string;
              state_code?: string;
              city?: string;
            } = {};
            if (!existing.legal_name && r.legal_name) patch.legal_name = r.legal_name;
            if (!existing.country_code && r.country_code) patch.country_code = r.country_code;
            if (!existing.state_code && r.state_code) patch.state_code = r.state_code.toUpperCase();
            if (!existing.city && r.city) patch.city = r.city;
            if (Object.keys(patch).length > 0) {
              await supabaseAdmin.from("companies").update(patch).eq("id", companyId);
            }
          }
        }
        // Fallback dedup by normalized trade_name + country + state when no tax_id match.
        if (!companyId) {
          const normName = r.trade_name.trim().toLowerCase();
          const stateUp = r.state_code ? r.state_code.toUpperCase() : "";
          const { data: candidates } = await supabaseAdmin
            .from("companies")
            .select("id, trade_name, country_code, state_code, tax_id, legal_name, city, created_at")
            .ilike("trade_name", r.trade_name.trim())
            .eq("country_code", r.country_code)
            .order("created_at", { ascending: true });
          const match = (candidates ?? []).find(
            (c) =>
              (c.trade_name ?? "").trim().toLowerCase() === normName &&
              (c.country_code ?? "") === r.country_code &&
              (c.state_code ?? "") === stateUp,
          );
          if (match) {
            companyId = match.id;
            const patch: {
              tax_id?: string;
              legal_name?: string;
              state_code?: string;
              city?: string;
            } = {};
            if (!match.tax_id && taxId) patch.tax_id = taxId;
            if (!match.legal_name && r.legal_name) patch.legal_name = r.legal_name;
            if (!match.state_code && stateUp) patch.state_code = stateUp;
            if (!match.city && r.city) patch.city = r.city;
            if (Object.keys(patch).length > 0) {
              await supabaseAdmin.from("companies").update(patch).eq("id", companyId);
            }
          }
        }
        if (!companyId) {
          const { data: ins, error: cErr } = await supabaseAdmin
            .from("companies")
            .insert({
              trade_name: r.trade_name,
              legal_name: emptyToNull(r.legal_name),
              tax_id: taxId,
              country_code: r.country_code,
              state_code: r.state_code ? r.state_code.toUpperCase() : null,
              city: emptyToNull(r.city),
            })
            .select("id")
            .single();
          if (cErr) throw new Error(`companies: ${cErr.message}`);
          companyId = ins!.id;
        }

        // ----- profiles upsert (by normalized email; only pending or already-this-user) -----
        const normEmail = r.email;
        const { data: existingProfile } = await supabaseAdmin
          .from("profiles")
          .select("id, auth_user_id, full_name, job_title, phone, whatsapp, company_id, pending_signup, preferred_language")
          .ilike("email", normEmail)
          .maybeSingle();

        let profileOutcome: Outcome;
        let profileId: string;
        if (existingProfile) {
          profileId = existingProfile.id;
          if (existingProfile.auth_user_id) {
            // User has already signed up — never overwrite live profile data.
            // Just ensure pipeline exists. Count as skipped for the row.
            profileOutcome = "skipped_existing_filled";
          } else {
            const patch: {
              full_name?: string;
              job_title?: string;
              phone?: string | null;
              whatsapp?: string | null;
              company_id?: string;
              pending_signup?: boolean;
            } = {};
            if (!existingProfile.full_name?.trim() && r.full_name) patch.full_name = r.full_name;
            if (!existingProfile.job_title && r.job_title) patch.job_title = r.job_title;
            if (!existingProfile.phone && r.phone) patch.phone = normPhone(r.phone);
            if (!existingProfile.whatsapp && r.whatsapp) patch.whatsapp = normPhone(r.whatsapp);
            if (!existingProfile.company_id) patch.company_id = companyId;
            if (!existingProfile.pending_signup) patch.pending_signup = true;
            if (Object.keys(patch).length > 0) {
              const { error: upErr } = await supabaseAdmin
                .from("profiles")
                .update(patch)
                .eq("id", profileId);
              if (upErr) throw new Error(`profiles update: ${upErr.message}`);
              profileOutcome = "updated";
            } else {
              profileOutcome = "skipped_existing_filled";
            }
          }
        } else {
          const { data: insP, error: pErr } = await supabaseAdmin
            .from("profiles")
            .insert({
              full_name: r.full_name,
              email: normEmail,
              job_title: emptyToNull(r.job_title),
              phone: normPhone(r.phone),
              whatsapp: normPhone(r.whatsapp),
              company_id: companyId,
              preferred_language: r.preferred_language,
              pending_signup: true,
            })
            .select("id")
            .single();
          if (pErr) throw new Error(`profiles insert: ${pErr.message}`);
          profileId = insP!.id;
          profileOutcome = "created";
        }

        // ----- visitor_profiles (idempotent) -----
        await supabaseAdmin
          .from("visitor_profiles")
          .upsert({ profile_id: profileId }, { onConflict: "profile_id" });

        // ----- company_event_pipeline (upsert by event_id+company_id) -----
        const { data: existingPipe } = await supabaseAdmin
          .from("company_event_pipeline")
          .select("id, primary_profile_id, registration_status")
          .eq("event_id", data.eventId)
          .eq("company_id", companyId)
          .maybeSingle();
        if (existingPipe) {
          const patch: { primary_profile_id?: string } = {};
          if (!existingPipe.primary_profile_id) patch.primary_profile_id = profileId;
          if (Object.keys(patch).length > 0) {
            await supabaseAdmin
              .from("company_event_pipeline")
              .update(patch)
              .eq("id", existingPipe.id);
          }
        } else {
          const { error: pipeErr } = await supabaseAdmin
            .from("company_event_pipeline")
            .insert({
              event_id: data.eventId,
              company_id: companyId,
              primary_profile_id: profileId,
              company_role: "visitor",
              registration_status: "em_preenchimento",
              country_code: r.country_code,
              state_code: r.state_code ? r.state_code.toUpperCase() : null,
              city: emptyToNull(r.city),
            });
          if (pipeErr) throw new Error(`pipeline: ${pipeErr.message}`);
        }

        results.push({ line, email: normEmail, outcome: profileOutcome });
        if (profileOutcome === "created") created++;
        else if (profileOutcome === "updated") updated++;
        else skipped++;
      } catch (e) {
        errors++;
        results.push({
          line,
          email: typeof raw?.email === "string" ? raw.email : null,
          outcome: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return {
      total: rows.length,
      created,
      updated,
      skipped,
      errors,
      results,
    };
  });

// ============================================================================
// Public lookup: prefill /signup form when an imported pre-registration exists
// for the typed email. No auth (callable from anonymous /signup), but:
//  - exact match on normalized email
//  - only returns when pending_signup=true AND auth_user_id IS NULL
//  - identical {found:false} response for: invalid email, no match,
//    already-claimed account, internal error
//  - constant ~250ms delay on every code path to flatten timing-based enumeration
//  - payload limited to form-relevant fields (no ids, no other contacts)
// ============================================================================

const ENUM_DELAY_MS = 250;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Mask a BR phone for prefill: strip +55/E.164 DDI first, then apply the
 * BR mask only when the normalized digits are a valid BR landline (10) or
 * mobile (11). Otherwise return the original value untouched so we never
 * show a wrong mask. */
function maskBR(raw: string | null | undefined): string | undefined {
  if (raw == null) return undefined;
  const trimmed = String(raw).trim();
  if (trimmed.length === 0) return undefined;
  const national = normalizeBRPhoneForMask(trimmed);
  if (national && isValidBRPhone(national)) return formatBRPhone(national);
  return trimmed;
}

export type PreRegPrefill = {
  trade_name?: string;
  legal_name?: string;
  tax_id?: string;
  city?: string;
  state_code?: string;
  website?: string;
  instagram?: string;
  linkedin?: string;
  address?: string;
  general_phone?: string;
  full_name?: string;
  job_title?: string;
  phone?: string;
  whatsapp?: string;
  preferred_language?: "pt-BR" | "es";
};

export type PreRegLookupResult =
  | { found: false }
  | { found: true; data: PreRegPrefill };

const lookupEmailSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
});

function strOrUndef(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length === 0 ? undefined : t;
}

export const lookupPreRegistration = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => input)
  .handler(async ({ data }): Promise<PreRegLookupResult> => {
    const started = Date.now();
    const finish = async (result: PreRegLookupResult): Promise<PreRegLookupResult> => {
      const elapsed = Date.now() - started;
      if (elapsed < ENUM_DELAY_MS) await sleep(ENUM_DELAY_MS - elapsed);
      return result;
    };

    const parsed = lookupEmailSchema.safeParse(data);
    if (!parsed.success) return finish({ found: false });
    const normEmail = parsed.data.email;

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select(
          "auth_user_id, pending_signup, full_name, job_title, phone, whatsapp, preferred_language, company_id, email",
        )
        .eq("email", normEmail)
        .maybeSingle();

      if (!profile) return finish({ found: false });
      if (profile.auth_user_id) return finish({ found: false });
      if (!profile.pending_signup) return finish({ found: false });
      // Defense in depth: exact normalized-email match.
      if ((profile.email ?? "").trim().toLowerCase() !== normEmail) {
        return finish({ found: false });
      }

      let company:
        | {
            trade_name: string | null;
            legal_name: string | null;
            tax_id: string | null;
            city: string | null;
            state_code: string | null;
            website: string | null;
            instagram: string | null;
            linkedin: string | null;
            address: string | null;
            general_phone: string | null;
          }
        | null = null;
      if (profile.company_id) {
        const { data: c } = await supabaseAdmin
          .from("companies")
          .select(
            "trade_name, legal_name, tax_id, city, state_code, website, instagram, linkedin, address, general_phone",
          )
          .eq("id", profile.company_id)
          .maybeSingle();
        company = c ?? null;
      }

      const prefill: PreRegPrefill = {
        trade_name: strOrUndef(company?.trade_name),
        legal_name: strOrUndef(company?.legal_name),
        tax_id: strOrUndef(company?.tax_id),
        city: strOrUndef(company?.city),
        state_code: strOrUndef(company?.state_code),
        website: strOrUndef(company?.website),
        instagram: strOrUndef(company?.instagram),
        linkedin: strOrUndef(company?.linkedin),
        address: strOrUndef(company?.address),
        general_phone: maskBR(company?.general_phone),
        full_name: strOrUndef(profile.full_name),
        job_title: strOrUndef(profile.job_title),
        phone: maskBR(profile.phone),
        whatsapp: maskBR(profile.whatsapp),
        preferred_language:
          profile.preferred_language === "es" || profile.preferred_language === "pt-BR"
            ? profile.preferred_language
            : undefined,
      };

      // Strip undefined keys for a clean DTO.
      const out: PreRegPrefill = {};
      for (const [k, v] of Object.entries(prefill)) {
        if (v !== undefined) (out as Record<string, unknown>)[k] = v;
      }

      return finish({ found: true, data: out });
    } catch {
      return finish({ found: false });
    }
  });
