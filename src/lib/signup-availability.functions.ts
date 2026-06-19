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

    console.log("[signup-availability] input", {
      email,
      tax_id_raw: data.tax_id,
      tax_id_digits: taxDigits,
    });

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
    if (taxDigits.length === 14) {
      // Pull ALL companies (small dataset for this event) and compare by
      // digits-only on tax_id. Avoids fragile ilike prefixes that miss masked
      // values like "08.030.124/0001-21" when digits don't appear together.
      const { data: companies, error: cErr } = await supabaseAdmin
        .from("companies")
        .select("id, tax_id")
        .not("tax_id", "is", null);
      if (cErr) throw new Error(cErr.message);
      const matchingCompanies = (companies ?? []).filter(
        (c) => onlyDigits(c.tax_id ?? "") === taxDigits,
      );
      console.log("[signup-availability] cnpj companies", {
        scanned: companies?.length ?? 0,
        matched: matchingCompanies.length,
        matched_ids: matchingCompanies.map((c) => c.id),
      });
      // Any existing company with this CNPJ — whether already claimed or
      // still a pending pre-registration — blocks the signup. Pending
      // pre-registrations are only claimable via the matching email, so a
      // different-email signup against the same CNPJ would otherwise create
      // a duplicate company silently.
      cnpj_taken = matchingCompanies.length > 0;
    }

    console.log("[signup-availability] result", {
      email_taken: !!emailRow,
      cnpj_taken,
    });

    return {
      email_taken: !!emailRow,
      cnpj_taken,
    };
  });