import { createServerFn } from "@tanstack/react-start";
import Papa from "papaparse";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
            const patch: Record<string, string | null> = {};
            if (!existing.legal_name && r.legal_name) patch.legal_name = r.legal_name;
            if (!existing.country_code && r.country_code) patch.country_code = r.country_code;
            if (!existing.state_code && r.state_code) patch.state_code = r.state_code.toUpperCase();
            if (!existing.city && r.city) patch.city = r.city;
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
            const patch: Record<string, string | null | boolean> = {};
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
          const patch: Record<string, string | null> = {};
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
