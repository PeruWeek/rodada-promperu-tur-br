import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";

import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { MultiSelectChips } from "@/components/multi-select-chips";
import { supabase } from "@/integrations/supabase/client";
import {
  formatBRPhone,
  formatCNPJ,
  normalizeWebsiteURL,
  toE164BR,
  UF_LIST,
} from "@/lib/validation/br-masks";
import {
  BUYER_SIGNUP_STORAGE_KEY,
  type BuyerSignupData,
  type AdditionalContact,
  stepAccountSchema,
  stepAdditionalContactsSchema,
  stepBuyerProfileSchema,
  stepCompanySchema,
  stepContactSchema,
  stepPortfolioSchema,
} from "@/lib/validation/buyer-signup.schema";
import { TAXONOMY } from "@/lib/taxonomy";
import { lookupPreRegistration, type PreRegPrefill } from "@/lib/pre-registration.functions";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Cadastro — Rodada de Negócios Promperu 2026" }] }),
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/dashboard" });
  },
  component: SignupPage,
});

const TOTAL_STEPS = 6;

const emptyData: BuyerSignupData = {
  email: "",
  password: "",
  confirmPassword: "",
  tax_id: "",
  legal_name: "",
  trade_name: "",
  registration_id: "",
  city: "",
  state_code: "",
  website: "",
  instagram: "",
  linkedin: "",
  address: "",
  general_phone: "",
  specialty: "",
  import_profile: "",
  full_name: "",
  job_title: "",
  phone: "",
  whatsapp: "",
  preferred_language: "pt-BR",
  additional_contacts: [],
  buyer_type: "",
  interests_segments: [],
  interests_destinations: [],
  interests_destinations_free: "",
  interests_services: [],
  demand_profile: "",
  portfolio_pt: "",
  portfolio_es: "",
  notes: "",
  consent_data_sharing: false,
  consent_marketing: false,
};

type Errors = Record<string, string>;

type Prefill =
  | { status: "idle" }
  | { status: "loading"; email: string }
  | { status: "none"; email: string }
  | { status: "found"; email: string; data: PreRegPrefill }
  | { status: "consumed"; email: string };

function flattenZodErrors(err: z.ZodError): Errors {
  const out: Errors = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

function SignupPage() {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language === "es" ? "es" : "pt") as "pt" | "es";
  const [step, setStep] = useState(1);
  const [data, setData] = useState<BuyerSignupData>({
    ...emptyData,
    preferred_language: i18n.language?.startsWith("es") ? "es" : "pt-BR",
  });
  const [errors, setErrors] = useState<Errors>({});
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [whatsappSameAsPhone, setWhatsappSameAsPhone] = useState(false);
  const [prefill, setPrefill] = useState<Prefill>({ status: "idle" });
  const prefillRequestId = useRef(0);
  const lookupFn = useServerFn(lookupPreRegistration);

  const set = <K extends keyof BuyerSignupData>(key: K, value: BuyerSignupData[K]) =>
    setData((d) => ({ ...d, [key]: value }));

  // Run the pre-registration lookup when the email field is left.
  const runLookup = async (rawEmail: string) => {
    const email = rawEmail.trim().toLowerCase();
    if (!email) {
      setPrefill({ status: "idle" });
      return;
    }
    const ok = z.string().email().max(255).safeParse(email).success;
    if (!ok) return;
    // Skip if we already have a result for this exact email.
    if (
      (prefill.status === "found" ||
        prefill.status === "none" ||
        prefill.status === "consumed" ||
        prefill.status === "loading") &&
      prefill.email === email
    ) {
      return;
    }
    const reqId = ++prefillRequestId.current;
    setPrefill({ status: "loading", email });
    try {
      const result = await lookupFn({ data: { email } });
      if (reqId !== prefillRequestId.current) return;
      if (result.found) setPrefill({ status: "found", email, data: result.data });
      else setPrefill({ status: "none", email });
    } catch {
      if (reqId === prefillRequestId.current) setPrefill({ status: "none", email });
    }
  };

  // Reset prefill when the email changes after a result was returned.
  useEffect(() => {
    const current = data.email.trim().toLowerCase();
    if (prefill.status === "idle" || prefill.status === "loading") return;
    if (prefill.email !== current) setPrefill({ status: "idle" });
  }, [data.email, prefill]);

  const acceptPrefill = () => {
    if (prefill.status !== "found") return;
    setData((d) => {
      const merged: BuyerSignupData = { ...d };
      for (const [k, v] of Object.entries(prefill.data)) {
        if (v === undefined || v === null || v === "") continue;
        const key = k as keyof BuyerSignupData;
        const cur = merged[key];
        // Fill only empty fields; never overwrite user input.
        if (cur === "" || cur === undefined || cur === null) {
          (merged as Record<string, unknown>)[key] = v;
        }
      }
      return merged;
    });
    setPrefill({ status: "consumed", email: prefill.email });
    toast.success(t("signup.prefill.toastFilled"));
  };

  const dismissPrefill = () => {
    if (prefill.status !== "found") return;
    setPrefill({ status: "consumed", email: prefill.email });
  };

  // Keep whatsapp synced with phone while the checkbox is on (no loops).
  useEffect(() => {
    if (whatsappSameAsPhone && data.whatsapp !== data.phone) {
      setData((d) => ({ ...d, whatsapp: d.phone }));
    }
  }, [whatsappSameAsPhone, data.phone, data.whatsapp]);

  const validateStep = (s: number): boolean => {
    const schemas = [
      stepAccountSchema,
      stepCompanySchema,
      stepContactSchema,
      stepAdditionalContactsSchema,
      stepBuyerProfileSchema,
      stepPortfolioSchema,
    ];
    const r = schemas[s - 1].safeParse(data);
    if (r.success) {
      setErrors({});
      return true;
    }
    const flat = flattenZodErrors(r.error);
    // Suppress whatsapp error when the field is mirrored from phone.
    if (whatsappSameAsPhone) delete flat.whatsapp;
    setErrors(flat);
    return false;
  };

  const next = () => {
    // Step 2: normalize website before validating (covers autofill without blur).
    if (step === 2 && data.website) {
      const normalized = normalizeWebsiteURL(data.website);
      if (normalized !== data.website) {
        setData((d) => ({ ...d, website: normalized }));
        // Re-run validation against the normalized snapshot synchronously.
        const snapshot = { ...data, website: normalized };
        const r = stepCompanySchema.safeParse(snapshot);
        if (r.success) {
          setErrors({});
          setStep((s) => Math.min(TOTAL_STEPS, s + 1));
          return;
        }
        setErrors(flattenZodErrors(r.error));
        return;
      }
    }
    if (validateStep(step)) setStep((s) => Math.min(TOTAL_STEPS, s + 1));
  };
  const back = () => setStep((s) => Math.max(1, s - 1));

  const onFinish = async () => {
    // Final safety: mirror whatsapp = phone if the user kept the shortcut on.
    if (whatsappSameAsPhone && data.whatsapp !== data.phone) {
      setData((d) => ({ ...d, whatsapp: d.phone }));
      data.whatsapp = data.phone;
    }
    if (!validateStep(TOTAL_STEPS)) return;
    setLoading(true);
    try {
      // Persist non-auth payload for /onboarding to consume after email confirm.
      const payload = {
        trade_name: data.trade_name,
        legal_name: data.legal_name,
        tax_id: data.tax_id,
        registration_id: data.registration_id,
        city: data.city,
        state_code: data.state_code,
        website: data.website,
        instagram: data.instagram,
        linkedin: data.linkedin,
        address: data.address,
        general_phone: toE164BR(data.general_phone) || data.general_phone,
        specialty: data.specialty,
        import_profile: data.import_profile,
        full_name: data.full_name,
        job_title: data.job_title,
        phone: toE164BR(data.phone),
        whatsapp: toE164BR(data.whatsapp),
        preferred_language: data.preferred_language,
        additional_contacts: data.additional_contacts.map((c) => ({
          name: c.name,
          job_title: c.job_title,
          email: c.email,
          phone_whatsapp: toE164BR(c.phone_whatsapp) || c.phone_whatsapp,
          linkedin: c.linkedin,
        })),
        buyer_type: data.buyer_type,
        interests_segments: data.interests_segments,
        interests_destinations: data.interests_destinations,
        interests_destinations_free: data.interests_destinations_free,
        interests_services: data.interests_services,
        demand_profile: data.demand_profile,
        portfolio_pt: data.portfolio_pt,
        portfolio_es: data.portfolio_es,
        notes: data.notes,
        consent_data_sharing: data.consent_data_sharing,
        consent_marketing: data.consent_marketing,
      };
      try {
        sessionStorage.setItem(BUYER_SIGNUP_STORAGE_KEY, JSON.stringify(payload));
      } catch { /* ignore */ }

      const { error } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          emailRedirectTo: `${window.location.origin}/onboarding`,
          data: {
            full_name: data.full_name,
            preferred_language: data.preferred_language,
            buyer_signup_payload: payload,
          },
        },
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      setSent(true);
    } finally {
      setLoading(false);
    }
  };

  const progress = useMemo(() => Math.round((step / TOTAL_STEPS) * 100), [step]);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-2xl px-4 py-12">
        {sent ? (
          <div className="space-y-4 rounded-lg border bg-card p-6">
            <h1 className="text-2xl font-bold">{t("auth.signupSuccessTitle")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("auth.checkEmailBody", { email: data.email })}
            </p>
            <p className="text-xs text-muted-foreground">{t("auth.checkEmailHint")}</p>
            <Link
              to="/login"
              search={{ reason: "otp_expired" }}
              className="inline-block text-sm font-medium text-primary hover:underline"
            >
              {t("auth.resendConfirmation")}
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-3xl font-bold">{t("auth.signupTitle")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t("auth.signupSubtitle")}</p>
            <div className="mt-6">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {t("signup.stepLabel", { current: step, total: TOTAL_STEPS })}
                </span>
                <span>{t(`signup.stepTitles.${step}`)}</span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>

            <form
              className="mt-8 space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                if (step < TOTAL_STEPS) next();
                else void onFinish();
              }}
            >
              {step === 1 && (
                <>
                  {prefill.status === "found" && (
                    <PrefillBanner t={t} onAccept={acceptPrefill} onDismiss={dismissPrefill} />
                  )}
                  <Step1
                    data={data}
                    set={set}
                    errors={errors}
                    t={t}
                    onEmailBlur={() => void runLookup(data.email)}
                  />
                </>
              )}
              {step === 2 && (
                <>
                  {prefill.status === "found" && (
                    <PrefillBanner t={t} onAccept={acceptPrefill} onDismiss={dismissPrefill} />
                  )}
                  <Step2 data={data} set={set} errors={errors} t={t} />
                </>
              )}
              {step === 3 && (
                <Step3
                  data={data}
                  set={set}
                  errors={errors}
                  t={t}
                  whatsappSameAsPhone={whatsappSameAsPhone}
                  setWhatsappSameAsPhone={setWhatsappSameAsPhone}
                />
              )}
              {step === 4 && (
                <Step4Contacts data={data} set={set} errors={errors} t={t} />
              )}
              {step === 5 && (
                <Step5 data={data} set={set} errors={errors} t={t} lang={lang} />
              )}
              {step === 6 && (
                <Step6 data={data} set={set} errors={errors} t={t} />
              )}

              <div className="flex items-center justify-between pt-2">
                {step > 1 ? (
                  <Button type="button" variant="outline" onClick={back} disabled={loading}>
                    {t("common.back")}
                  </Button>
                ) : <span />}
                <Button type="submit" disabled={loading}>
                  {step < TOTAL_STEPS ? t("common.continue") : t("signup.finish")}
                </Button>
              </div>

              <p className="text-center text-sm text-muted-foreground">
                <Link to="/login" className="font-medium text-primary hover:underline">
                  {t("auth.switchToLogin")}
                </Link>
              </p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

type StepProps = {
  data: BuyerSignupData;
  set: <K extends keyof BuyerSignupData>(k: K, v: BuyerSignupData[K]) => void;
  errors: Errors;
  t: (k: string, opts?: Record<string, unknown>) => string;
};

function FieldError({ msg, t }: { msg?: string; t: StepProps["t"] }) {
  if (!msg) return null;
  // Messages already namespaced (e.g. "signup.errors.phoneMissingDDD") are
  // translated directly. Legacy short codes fall back to the old mapping.
  let text: string;
  if (msg.startsWith("signup.")) {
    text = t(msg);
  } else {
    const known = ["cnpjInvalid", "phoneInvalid", "urlInvalid", "passwordMismatch", "consentRequired"];
    text = known.includes(msg) ? t(`signup.errors.${msg}`) : t("signup.errors.required");
  }
  return <p className="mt-1 text-xs font-medium text-destructive">{text}</p>;
}

function PrefillBanner({
  t,
  onAccept,
  onDismiss,
}: {
  t: StepProps["t"];
  onAccept: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="rounded-md border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/40">
      <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-100">
        {t("signup.prefill.bannerTitle")}
      </h3>
      <p className="mt-1 text-sm text-blue-900/80 dark:text-blue-100/80">
        {t("signup.prefill.bannerBody")}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={onAccept}>
          {t("signup.prefill.useMyData")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onDismiss}>
          {t("signup.prefill.startBlank")}
        </Button>
      </div>
    </div>
  );
}

function Step1({
  data,
  set,
  errors,
  t,
  onEmailBlur,
}: StepProps & { onEmailBlur?: () => void }) {
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="email">{t("auth.email")} *</Label>
        <Input id="email" type="email" autoComplete="email" value={data.email}
          onChange={(e) => set("email", e.target.value)}
          onBlur={onEmailBlur}
          className="mt-1.5" />
        <FieldError msg={errors.email} t={t} />
      </div>
      <div>
        <Label htmlFor="password">{t("auth.password")} *</Label>
        <PasswordInput id="password" autoComplete="new-password" value={data.password}
          onChange={(e) => set("password", e.target.value)} className="mt-1.5" />
        <p className="mt-1 text-xs text-muted-foreground">{t("signup.passwordHint")}</p>
        <FieldError msg={errors.password} t={t} />
      </div>
      <div>
        <Label htmlFor="confirmPassword">{t("signup.confirmPassword")} *</Label>
        <PasswordInput id="confirmPassword" autoComplete="new-password" value={data.confirmPassword}
          onChange={(e) => set("confirmPassword", e.target.value)} className="mt-1.5" />
        <FieldError msg={errors.confirmPassword} t={t} />
      </div>
    </div>
  );
}

function Step2({ data, set, errors, t }: StepProps) {
  return (
    <div className="space-y-4">
      <div>
        <Label>{t("signup.country")}</Label>
        <Input value="Brasil" disabled className="mt-1.5" />
      </div>
      <div>
        <Label htmlFor="registration_id">{t("signup.registrationId")} *</Label>
        <Input id="registration_id" value={data.registration_id}
          onChange={(e) => set("registration_id", e.target.value)} className="mt-1.5" />
        <p className="mt-1 text-xs text-muted-foreground">{t("signup.registrationIdHelp")}</p>
        <FieldError msg={errors.registration_id} t={t} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="tax_id">{t("signup.taxId")}</Label>
          <Input id="tax_id" inputMode="numeric" placeholder="00.000.000/0000-00" value={data.tax_id}
            onChange={(e) => set("tax_id", formatCNPJ(e.target.value))} className="mt-1.5" />
          <p className="mt-1 text-xs text-muted-foreground">{t("signup.taxIdHelp")}</p>
          <FieldError msg={errors.tax_id} t={t} />
        </div>
        <div>
          <Label htmlFor="legal_name">{t("signup.legalName")} *</Label>
          <Input id="legal_name" value={data.legal_name}
            onChange={(e) => set("legal_name", e.target.value)} className="mt-1.5" />
          <p className="mt-1 text-xs text-muted-foreground">{t("signup.legalNameHelp")}</p>
          <FieldError msg={errors.legal_name} t={t} />
        </div>
      </div>
      <div>
        <Label htmlFor="trade_name">{t("signup.tradeName")} *</Label>
        <Input id="trade_name" value={data.trade_name}
          onChange={(e) => set("trade_name", e.target.value)} className="mt-1.5" />
        <FieldError msg={errors.trade_name} t={t} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Label htmlFor="city">{t("signup.city")} *</Label>
          <Input id="city" value={data.city}
            onChange={(e) => set("city", e.target.value)} className="mt-1.5" />
          <FieldError msg={errors.city} t={t} />
        </div>
        <div>
          <Label htmlFor="state_code">{t("signup.state")} *</Label>
          <select id="state_code" value={data.state_code}
            onChange={(e) => set("state_code", e.target.value)}
            className="mt-1.5 h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
            <option value="">—</option>
            {UF_LIST.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
          </select>
          <FieldError msg={errors.state_code} t={t} />
        </div>
      </div>
      <div>
        <Label htmlFor="website">{t("signup.website")}</Label>
        <Input id="website" type="url" placeholder="https://..." value={data.website}
          onChange={(e) => set("website", e.target.value)}
          onBlur={(e) => {
            const normalized = normalizeWebsiteURL(e.target.value);
            if (normalized !== e.target.value) set("website", normalized);
          }}
          className="mt-1.5" />
        <FieldError msg={errors.website} t={t} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="instagram">Instagram</Label>
          <Input id="instagram" placeholder="@empresa" value={data.instagram}
            onChange={(e) => set("instagram", e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="linkedin">LinkedIn</Label>
          <Input id="linkedin" placeholder="linkedin.com/company/..." value={data.linkedin}
            onChange={(e) => set("linkedin", e.target.value)} className="mt-1.5" />
        </div>
      </div>
      <div>
        <Label htmlFor="address">{t("signup.address")}</Label>
        <Input id="address" value={data.address}
          onChange={(e) => set("address", e.target.value)} className="mt-1.5" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="general_phone">{t("signup.generalPhone")}</Label>
          <Input id="general_phone" inputMode="tel" placeholder="(11) 3000-0000"
            value={data.general_phone}
            onChange={(e) => set("general_phone", formatBRPhone(e.target.value))}
            className="mt-1.5" />
          <FieldError msg={errors.general_phone} t={t} />
        </div>
        <div>
          <Label htmlFor="specialty">{t("signup.specialty")}</Label>
          <Input id="specialty" placeholder={t("signup.specialtyPlaceholder")}
            value={data.specialty}
            onChange={(e) => set("specialty", e.target.value)} className="mt-1.5" />
        </div>
      </div>
      <div>
        <Label htmlFor="import_profile">{t("signup.importProfile")}</Label>
        <Textarea id="import_profile" rows={3}
          placeholder={t("signup.importProfilePlaceholder")}
          value={data.import_profile}
          onChange={(e) => set("import_profile", e.target.value)} className="mt-1.5" />
      </div>
    </div>
  );
}

function Step3({
  data,
  set,
  errors,
  t,
  whatsappSameAsPhone,
  setWhatsappSameAsPhone,
}: StepProps & {
  whatsappSameAsPhone: boolean;
  setWhatsappSameAsPhone: (v: boolean) => void;
}) {
  const phoneDigits = data.phone.replace(/\D+/g, "");
  const showPhoneDDDHint = phoneDigits.length >= 8 && phoneDigits.length <= 9;
  const whatsappDigits = data.whatsapp.replace(/\D+/g, "");
  const showWhatsappDDDHint =
    !whatsappSameAsPhone && whatsappDigits.length >= 8 && whatsappDigits.length <= 9;
  const phonePlaceholder = "(DDD) 9XXXX-XXXX — ex: (11) 98765-4321";
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="full_name">{t("auth.fullName")} *</Label>
        <Input id="full_name" value={data.full_name}
          onChange={(e) => set("full_name", e.target.value)} className="mt-1.5" />
        <FieldError msg={errors.full_name} t={t} />
      </div>
      <div>
        <Label htmlFor="job_title">{t("signup.jobTitle")} *</Label>
        <Input id="job_title" value={data.job_title}
          onChange={(e) => set("job_title", e.target.value)} className="mt-1.5" />
        <FieldError msg={errors.job_title} t={t} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="phone">{t("signup.phone")} *</Label>
          <Input id="phone" inputMode="tel" placeholder={phonePlaceholder} value={data.phone}
            onChange={(e) => set("phone", formatBRPhone(e.target.value))} className="mt-1.5" />
          {showPhoneDDDHint && (
            <p className="mt-1 text-xs text-muted-foreground">{t("signup.hints.includeDDD")}</p>
          )}
          <FieldError msg={errors.phone} t={t} />
        </div>
        <div>
          <Label htmlFor="whatsapp">{t("signup.whatsapp")} *</Label>
          <Input
            id="whatsapp"
            inputMode="tel"
            placeholder={phonePlaceholder}
            value={whatsappSameAsPhone ? data.phone : data.whatsapp}
            disabled={whatsappSameAsPhone}
            onChange={(e) => set("whatsapp", formatBRPhone(e.target.value))}
            className="mt-1.5"
          />
          {showWhatsappDDDHint && (
            <p className="mt-1 text-xs text-muted-foreground">{t("signup.hints.includeDDD")}</p>
          )}
          {!whatsappSameAsPhone && <FieldError msg={errors.whatsapp} t={t} />}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="whatsappSameAsPhone"
          checked={whatsappSameAsPhone}
          onCheckedChange={(v) => setWhatsappSameAsPhone(v === true)}
        />
        <Label htmlFor="whatsappSameAsPhone" className="text-sm font-normal leading-snug">
          {t("signup.labels.whatsappSameAsPhone")}
        </Label>
      </div>
      <div>
        <Label htmlFor="preferred_language">{t("signup.preferredLanguage")} *</Label>
        <select id="preferred_language" value={data.preferred_language}
          onChange={(e) => set("preferred_language", e.target.value as "pt-BR" | "es")}
          className="mt-1.5 h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
          <option value="pt-BR">Português</option>
          <option value="es">Español</option>
        </select>
      </div>
    </div>
  );
}

function Step4Contacts({ data, set, errors, t }: StepProps) {
  const contacts = data.additional_contacts;
  const update = (i: number, patch: Partial<AdditionalContact>) => {
    const next = contacts.map((c, idx) => (idx === i ? { ...c, ...patch } : c));
    set("additional_contacts", next);
  };
  const add = () => {
    if (contacts.length >= 5) return;
    set("additional_contacts", [
      ...contacts,
      { name: "", job_title: "", email: "", phone_whatsapp: "", linkedin: "" },
    ]);
  };
  const remove = (i: number) => {
    set("additional_contacts", contacts.filter((_, idx) => idx !== i));
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("signup.additionalContactsHint")}</p>
      {contacts.length === 0 && (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          {t("signup.noAdditionalContacts")}
        </p>
      )}
      {contacts.map((c, i) => {
        const errBase = `additional_contacts.${i}`;
        return (
          <div key={i} className="space-y-3 rounded-md border p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                {t("signup.contactN", { n: i + 2 })}
              </h3>
              <Button type="button" variant="ghost" size="sm" onClick={() => remove(i)}>
                {t("signup.removeContact")}
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>{t("auth.fullName")} *</Label>
                <Input value={c.name} onChange={(e) => update(i, { name: e.target.value })}
                  className="mt-1.5" />
                <FieldError msg={errors[`${errBase}.name`]} t={t} />
              </div>
              <div>
                <Label>{t("signup.jobTitle")}</Label>
                <Input value={c.job_title}
                  onChange={(e) => update(i, { job_title: e.target.value })}
                  className="mt-1.5" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>{t("auth.email")} *</Label>
                <Input type="email" value={c.email}
                  onChange={(e) => update(i, { email: e.target.value })}
                  className="mt-1.5" />
                <FieldError msg={errors[`${errBase}.email`]} t={t} />
              </div>
              <div>
                <Label>{t("signup.whatsapp")} *</Label>
                <Input inputMode="tel" placeholder="(DDD) 9XXXX-XXXX"
                  value={c.phone_whatsapp}
                  onChange={(e) => update(i, { phone_whatsapp: formatBRPhone(e.target.value) })}
                  className="mt-1.5" />
                <FieldError msg={errors[`${errBase}.phone_whatsapp`]} t={t} />
              </div>
            </div>
            <div>
              <Label>LinkedIn</Label>
              <Input placeholder="linkedin.com/in/..." value={c.linkedin}
                onChange={(e) => update(i, { linkedin: e.target.value })}
                className="mt-1.5" />
            </div>
          </div>
        );
      })}
      {contacts.length < 5 && (
        <Button type="button" variant="outline" onClick={add}>
          {t("signup.addContact")}
        </Button>
      )}
    </div>
  );
}

function Step5({ data, set, errors, t, lang }: StepProps & { lang: "pt" | "es" }) {
  return (
    <div className="space-y-5">
      <div>
        <Label htmlFor="buyer_type">{t("signup.buyerType")} *</Label>
        <select id="buyer_type" value={data.buyer_type}
          onChange={(e) => set("buyer_type", e.target.value)}
          className="mt-1.5 h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
          <option value="">—</option>
          {TAXONOMY.buyer_types.map((b) => (
            <option key={b.value} value={b.value}>{lang === "es" ? b.es : b.pt}</option>
          ))}
        </select>
        <FieldError msg={errors.buyer_type} t={t} />
      </div>
      <div>
        <Label>{t("signup.segments")}</Label>
        <div className="mt-1.5">
          <MultiSelectChips taxonomyKey="segments" value={data.interests_segments}
            onChange={(v) => set("interests_segments", v)} />
        </div>
      </div>
      <div>
        <Label>{t("signup.destinations")}</Label>
        <div className="mt-1.5">
          <MultiSelectChips taxonomyKey="destinations" value={data.interests_destinations}
            onChange={(v) => set("interests_destinations", v)} />
        </div>
        <Input className="mt-2" placeholder={t("signup.destinationsFreePlaceholder")}
          value={data.interests_destinations_free}
          onChange={(e) => set("interests_destinations_free", e.target.value)} />
      </div>
      <div>
        <Label>{t("signup.services")}</Label>
        <div className="mt-1.5">
          <MultiSelectChips taxonomyKey="services" value={data.interests_services}
            onChange={(v) => set("interests_services", v)} />
        </div>
      </div>
      <div>
        <Label htmlFor="demand_profile">{t("signup.demandProfile")}</Label>
        <Textarea id="demand_profile" rows={3} placeholder={t("signup.demandProfilePlaceholder")}
          value={data.demand_profile}
          onChange={(e) => set("demand_profile", e.target.value)} className="mt-1.5" />
      </div>
    </div>
  );
}

function Step6({ data, set, errors, t }: StepProps) {
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="portfolio_pt">{t("signup.portfolioPt")}</Label>
        <Textarea id="portfolio_pt" rows={4} value={data.portfolio_pt}
          onChange={(e) => set("portfolio_pt", e.target.value)} className="mt-1.5" />
      </div>
      <div>
        <Label htmlFor="portfolio_es">{t("signup.portfolioEs")}</Label>
        <Textarea id="portfolio_es" rows={4} value={data.portfolio_es}
          onChange={(e) => set("portfolio_es", e.target.value)} className="mt-1.5" />
      </div>
      <div>
        <Label htmlFor="notes">{t("signup.notes")}</Label>
        <Textarea id="notes" rows={2} value={data.notes}
          onChange={(e) => set("notes", e.target.value)} className="mt-1.5" />
      </div>
      <div className="flex items-start gap-2 rounded-md border p-3">
        <Checkbox id="consent_data_sharing" checked={data.consent_data_sharing}
          onCheckedChange={(v) => set("consent_data_sharing", v === true)} />
        <Label htmlFor="consent_data_sharing" className="text-sm leading-snug">
          {t("signup.consentDataSharing")} *
        </Label>
      </div>
      <FieldError msg={errors.consent_data_sharing} t={t} />
      <div className="flex items-start gap-2 rounded-md border p-3">
        <Checkbox id="consent_marketing" checked={data.consent_marketing}
          onCheckedChange={(v) => set("consent_marketing", v === true)} />
        <Label htmlFor="consent_marketing" className="text-sm leading-snug">
          {t("signup.consentMarketing")}
        </Label>
      </div>
    </div>
  );
}