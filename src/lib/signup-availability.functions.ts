import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Public (unauthenticated) availability check used by /signup BEFORE calling
// supabase.auth.signUp. Supabase Auth no longer returns an error for an
// existing email by default (security: prevents user enumeration), and our
// CNPJ uniqueness lives in `companies.tax_id` — so we must check both up
// front, otherwise the signup silently "succeeds" without sending an OTP
// and the Mautic duplicate events never fire.
//
// Returns a classified result. Never throws on "found"; throws only on
// unexpected infra errors so the caller can fall back gracefully.

const inputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  tax_id: z.string().trim().max(64).optional().default(""),
});

export type SignupAvailability = {
  email_taken: boolean;
  cnpj_taken: boolean;
};

const onlyDigits = (s: string) => s.replace(/\D+/g, "");

export const checkSignupAvailability = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }): Promise<SignupAvailability> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const email = data.email;
    const taxDigits = onlyDigits(data.tax_id ?? "");

    // Email check: a claimed profile (auth_user_id NOT NULL) with this email
    // means the account already exists. Pending pre-registrations
    // (pending_signup=true, auth_user_id=null) are NOT duplicates — they get
    // claimed by handle_new_user on signUp.
    const { data: emailRow, error: emailErr } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .ilike("email", email)
      .not("auth_user_id", "is", null)
      .limit(1)
      .maybeSingle();
    if (emailErr) throw new Error(emailErr.message);

    let cnpj_taken = false;
    if (taxDigits.length >= 11) {
      // Match by digits-only on tax_id. Companies table stores the masked
      // value, so compare via regexp_replace would need RPC — instead pull
      // candidates by trigram-ish ilike on the digits and compare in JS.
      const { data: companies, error: cErr } = await supabaseAdmin
        .from("companies")
        .select("id, tax_id")
        .not("tax_id", "is", null)
        .ilike("tax_id", `%${taxDigits.slice(0, 4)}%`)
        .limit(200);
      if (cErr) throw new Error(cErr.message);
      const matchingCompanyIds = (companies ?? [])
        .filter((c) => onlyDigits(c.tax_id ?? "") === taxDigits)
        .map((c) => c.id);
      if (matchingCompanyIds.length > 0) {
        // Only count as "taken" if a claimed profile is linked to that company.
        const { data: claimed, error: pErr } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .in("company_id", matchingCompanyIds)
          .not("auth_user_id", "is", null)
          .limit(1)
          .maybeSingle();
        if (pErr) throw new Error(pErr.message);
        cnpj_taken = !!claimed;
      }
    }

    return {
      email_taken: !!emailRow,
      cnpj_taken,
    };
  });