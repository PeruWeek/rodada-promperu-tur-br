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

export const stepCompanySchema = z.object({
  tax_id: z
    .string()
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || isValidCNPJ(v), { message: "cnpjInvalid" }),
  legal_name: optTrim,
  trade_name: z.string().trim().min(2).max(160),
  city: z.string().trim().min(2).max(120),
  state_code: z.enum(UF_LIST as unknown as [string, ...string[]]),
  website: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || /^https?:\/\/.+\..+/.test(v), { message: "urlInvalid" }),
  instagram: optTrim,
  linkedin: optTrim,
  address: optTrim,
  general_phone: z.string().optional().or(z.literal("")).superRefine((v, ctx) => {
    if (!v) return;
    const r = validateBRPhoneDetailed(v);
    if (!r.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `signup.errors.phone${r.reason[0].toUpperCase()}${r.reason.slice(1)}`,
      });
    }
  }),
  specialty: optTrim,
  import_profile: z.string().trim().max(2000).optional().or(z.literal("")),
});

export const stepContactSchema = z.object({
  full_name: z.string().trim().min(2).max(160),
  job_title: z.string().trim().min(2).max(120),
  phone: z.string().superRefine((v, ctx) => {
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
  whatsapp: z.string().superRefine((v, ctx) => {
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
  preferred_language: z.enum(["pt-BR", "es"]),
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

export const stepAdditionalContactsSchema = z.object({
  additional_contacts: z.array(additionalContactSchema).max(5),
});

export type AdditionalContact = z.infer<typeof additionalContactSchema>;

export const stepBuyerProfileSchema = z.object({
  buyer_type: z.string().min(1),
  interests_segments: z.array(z.string()),
  interests_destinations: z.array(z.string()),
  interests_destinations_free: z.string().max(500).optional().or(z.literal("")),
  interests_services: z.array(z.string()),
  demand_profile: z.string().max(1000).optional().or(z.literal("")),
});

export const stepPortfolioSchema = z.object({
  portfolio_pt: z.string().max(4000).optional().or(z.literal("")),
  portfolio_es: z.string().max(4000).optional().or(z.literal("")),
  notes: z.string().max(500).optional().or(z.literal("")),
  consent_data_sharing: z.literal(true, { errorMap: () => ({ message: "consentRequired" }) }),
  consent_marketing: z.boolean(),
});

export type BuyerSignupData = {
  // step 1 (not persisted to sessionStorage)
  email: string;
  password: string;
  confirmPassword: string;
  // step 2
  tax_id: string;
  legal_name: string;
  trade_name: string;
  city: string;
  state_code: string;
  website: string;
  instagram: string;
  linkedin: string;
  address: string;
  general_phone: string;
  specialty: string;
  import_profile: string;
  // step 3
  full_name: string;
  job_title: string;
  phone: string;
  whatsapp: string;
  preferred_language: "pt-BR" | "es";
  // step 4 (additional contacts)
  additional_contacts: AdditionalContact[];
  // step 5 (buyer profile)
  buyer_type: string;
  interests_segments: string[];
  interests_destinations: string[];
  interests_destinations_free: string;
  interests_services: string[];
  demand_profile: string;
  // step 6 (portfolio + consent)
  portfolio_pt: string;
  portfolio_es: string;
  notes: string;
  consent_data_sharing: boolean;
  consent_marketing: boolean;
};

export const BUYER_SIGNUP_STORAGE_KEY = "buyer_signup_pending_v1";