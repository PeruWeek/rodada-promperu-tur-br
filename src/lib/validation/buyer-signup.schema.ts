import { z } from "zod";
import { isValidCNPJ, UF_LIST, validateBRPhoneDetailed } from "./br-masks";

const optTrim = z.string().trim().optional().or(z.literal(""));

export const stepAccountSchema = z
  .object({
    email: z.string().trim().email(),
    password: z.string().min(8),
    confirmPassword: z.string().min(8),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "passwordMismatch",
  });

// Quick signup (Cadastro rápido): only the essentials. Everything else
// lives in the Perfil complementar at /profile.
export const stepCompanyQuickSchema = z.object({
  tax_id: z
    .string()
    .trim()
    .min(1, { message: "signup.errors.required" })
    .refine((v) => isValidCNPJ(v), { message: "cnpjInvalid" }),
  legal_name: z.string().trim().min(2).max(200),
  trade_name: z.string().trim().min(2).max(160),
  city: z.string().trim().min(2).max(120),
  state_code: z.enum(UF_LIST as unknown as [string, ...string[]]),
});

const brWhatsapp = z.string().superRefine((v, ctx) => {
  if (!v) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "signup.errors.required" });
    return;
  }
  const r = validateBRPhoneDetailed(v);
  if (!r.ok) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `signup.errors.phone${r.reason[0].toUpperCase()}${r.reason.slice(1)}`,
    });
  }
});

// Step 3: contact + minimum profile classification + consent.
export const stepContactProfileQuickSchema = z.object({
  full_name: z.string().trim().min(2).max(160),
  job_title: z.string().trim().min(2).max(120),
  whatsapp: brWhatsapp,
  buyer_types: z
    .array(z.string().trim().min(1))
    .optional()
    .default([]),
  interests_segments: z
    .array(z.string())
    .optional()
    .default([]),
  networking_lunch_participation: z.enum(["yes", "no"], {
    errorMap: () => ({ message: "signup.errors.required" }),
  }),
  image_authorization: z.enum(["yes", "no"], {
    errorMap: () => ({ message: "signup.errors.required" }),
  }),
  consent_data_sharing: z.literal(true, {
    errorMap: () => ({ message: "consentRequired" }),
  }),
});

const additionalContactSchema = z.object({
  name: z.string().trim().min(2).max(160),
  job_title: z.string().trim().max(120).optional().or(z.literal("")),
  email: z.string().trim().email().max(255),
  phone_whatsapp: z.string().superRefine((v, ctx) => {
    if (!v) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "signup.errors.required" });
      return;
    }
    const r = validateBRPhoneDetailed(v);
    if (!r.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `signup.errors.phone${r.reason[0].toUpperCase()}${r.reason.slice(1)}`,
      });
    }
  }),
  linkedin: z.string().trim().max(255).optional().or(z.literal("")),
});

export type AdditionalContact = z.infer<typeof additionalContactSchema>;

// Optional helper exported for /profile validation of the complementary block.
export const additionalContactsSchema = z
  .array(additionalContactSchema)
  .max(5);

// Re-exported aliases kept for any legacy import.
export { additionalContactSchema };

export type BuyerSignupData = {
  // step 1 (not persisted to sessionStorage)
  email: string;
  password: string;
  confirmPassword: string;
  // step 2 — Cadastro rápido (essenciais)
  tax_id: string;
  trade_name: string;
  city: string;
  state_code: string;
  // perfil complementar (opcionais)
  registration_id: string;
  legal_name: string;
  website: string;
  instagram: string;
  linkedin: string;
  address: string;
  general_phone: string;
  specialty: string;
  import_profile: string;
  // step 3 — contato + perfil mínimo
  full_name: string;
  job_title: string;
  whatsapp: string;
  preferred_language: "pt-BR" | "es";
  buyer_types: string[];
  interests_segments: string[];
  networking_lunch_participation: "yes" | "no" | "";
  image_authorization: "yes" | "no" | "";
  consent_data_sharing: boolean;
  // perfil complementar (opcionais)
  phone: string;
  additional_contacts: AdditionalContact[];
  interests_destinations: string[];
  interests_destinations_free: string;
  interests_services: string[];
  portfolio_pt: string;
  notes: string;
  consent_marketing: boolean;
};

export const BUYER_SIGNUP_STORAGE_KEY = "buyer_signup_pending_v1";