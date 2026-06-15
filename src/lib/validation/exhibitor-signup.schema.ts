import { z } from "zod";

// Loose international phone: digits-only must be 8-15. Allows + and separators.
const intlPhone = z.string().superRefine((v, ctx) => {
  if (!v) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "signup.errors.required" });
    return;
  }
  const digits = v.replace(/\D+/g, "");
  if (digits.length < 8 || digits.length > 15) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "signup.errors.phoneInvalid" });
  }
});

export const exhibitorAccountSchema = z
  .object({
    email: z.string().trim().email(),
    password: z.string().min(8),
    confirmPassword: z.string().min(8),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "passwordMismatch",
  });

export const exhibitorCompanyQuickSchema = z.object({
  trade_name: z.string().trim().min(2).max(160),
  city: z.string().trim().min(2).max(120),
});

export const exhibitorContactProfileQuickSchema = z.object({
  full_name: z.string().trim().min(2).max(160),
  job_title: z.string().trim().min(2).max(120),
  whatsapp: intlPhone,
  preferred_language: z.enum(["pt-BR", "es"]),
  segments: z.array(z.string()).min(1, { message: "signup.errors.required" }),
  services: z.array(z.string()).min(1, { message: "signup.errors.required" }),
  consent_data_sharing: z.literal(true, {
    errorMap: () => ({ message: "consentRequired" }),
  }),
});

export type ExhibitorSignupData = {
  email: string;
  password: string;
  confirmPassword: string;
  // company (quick)
  trade_name: string;
  city: string;
  // contact + profile (quick)
  full_name: string;
  job_title: string;
  whatsapp: string;
  preferred_language: "pt-BR" | "es";
  segments: string[];
  services: string[];
  consent_data_sharing: boolean;
};

export const EXHIBITOR_SIGNUP_STORAGE_KEY = "exhibitor_signup_pending_v1";
