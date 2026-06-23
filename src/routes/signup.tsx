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
import { PasswordStrength } from "@/components/ui/password-strength";
import { friendlyAuthErrorKey, passwordStrength } from "@/lib/password-strength";
import { Checkbox } from "@/components/ui/checkbox";
import { MultiSelectChips } from "@/components/multi-select-chips";
import { supabase } from "@/integrations/supabase/client";
import {
  formatBRPhone,
  formatCNPJ,
  toE164BR,
  UF_LIST,
} from "@/lib/validation/br-masks";
import {
  BUYER_SIGNUP_STORAGE_KEY,
  type BuyerSignupData,
  stepAccountSchema,
  stepCompanyQuickSchema,
  stepContactProfileQuickSchema,
} from "@/lib/validation/buyer-signup.schema";
import { TAXONOMY } from "@/lib/taxonomy";
import { lookupPreRegistration, type PreRegPrefill } from "@/lib/pre-registration.functions";
import { checkSignupAvailability } from "@/lib/signup-availability.functions";
import { trackMauticEvent } from "@/lib/mautic";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Cadastro — PERU MICE Networking Evento" }] }),
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/dashboard" });
  },
  component: SignupPage,
});

const TOTAL_STEPS = 3;

const emptyData: BuyerSignupData = {
  email: "",
  password: "",
  confirmPassword: "",
  tax_id: "",
  trade_name: "",
  city: "",
  state_code: "",
  registration_id: "",
  legal_name: "",
  website: "",
  instagram: "",
  linkedin: "",
  address: "",
  general_phone: "",
  specialty: "",
  import_profile: "",
  full_name: "",
  job_title: "",
  whatsapp: "",
  preferred_language: "pt-BR",
  buyer_types: [],
  interests_segments: [],
  networking_lunch_participation: "",
  consent_data_sharing: false,
  phone: "",
  additional_contacts: [],
  interests_destinations: [],
  interests_destinations_free: "",
  interests_services: [],
  portfolio_pt: "",
  notes: "",
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
  const [prefill, setPrefill] = useState<Prefill>({ status: "idle" });
  const prefillRequestId = useRef(0);
  const lookupFn = useServerFn(lookupPreRegistration);
  const availabilityFn = useServerFn(checkSignupAvailability);

  const set = <K extends keyof BuyerSignupData>(key: K, value: BuyerSignupData[K]) =>
    setData((d) => ({ ...d, [key]: value }));

  // Mautic: signup_started — dispara quando o usuário abre a tela de cadastro.
  // Dedupe fixo por sessão para não duplicar em reload/hot reload/StrictMode.
  useEffect(() => {
    trackMauticEvent(
      "signup_started",
      {
        page_url: typeof window !== "undefined"
          ? `${window.location.origin}/signup`
          : "/signup",
        page_title: "signup_started",
      },
      { dedupeKey: "session" },
    );
  }, []);

  const runLookup = async (rawEmail: string) => {
    const email = rawEmail.trim().toLowerCase();
    if (!email) {
      setPrefill({ status: "idle" });
      return;
    }
    if (!z.string().email().max(255).safeParse(email).success) return;
    if (
      (prefill.status === "found" ||
        prefill.status === "none" ||
        prefill.status === "consumed" ||
        prefill.status === "loading") &&
      prefill.email === email
    ) return;
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

  const validateStep = (s: number): boolean => {
    const schemas = [stepAccountSchema, stepCompanyQuickSchema, stepContactProfileQuickSchema];
    const r = schemas[s - 1].safeParse(data);
    if (r.success) { setErrors({}); return true; }
    const flat = flattenZodErrors(r.error);
    if (s === 1 && !flat.password && data.password && passwordStrength(data.password) === "weak") {
      flat.password = "auth.errors.passwordWeak";
    }
    setErrors(flat);
    // Mautic: signup_validation_error. Dedupe por (step + chaves de erro)
    // para não inflar a timeline em cliques repetidos com os mesmos erros,
    // mas registrar quando o usuário muda os campos quebrados.
    const errorKeys = Object.keys(flat).sort().join("|");
    trackMauticEvent(
      "signup_validation_error",
      {
        page_url: typeof window !== "undefined"
          ? `${window.location.origin}/signup`
          : "/signup",
        page_title: "signup_validation_error",
        ...(data.email ? { email: data.email } : {}),
        signup_step: s,
        error_fields: errorKeys,
      },
      { dedupeKey: `${s}:${errorKeys}` },
    );
    return false;
  };

  const next = () => {
    if (!validateStep(step)) return;
    // Mautic: signup_step_N_completed. Dedupe por (email|sessão + step) para
    // não duplicar em re-cliques no botão Continuar.
    const stepEvent = (
      step === 1
        ? "signup_step_1_completed"
        : step === 2
          ? "signup_step_2_completed"
          : "signup_step_3_completed"
    ) as
      | "signup_step_1_completed"
      | "signup_step_2_completed"
      | "signup_step_3_completed";
    trackMauticEvent(
      stepEvent,
      {
        page_url: typeof window !== "undefined"
          ? `${window.location.origin}/signup`
          : "/signup",
        page_title: stepEvent,
        email: data.email || undefined,
      },
      { dedupeKey: `${data.email.toLowerCase() || "anon"}:${step}` },
    );
    setStep((s) => Math.min(TOTAL_STEPS, s + 1));
  };
  const back = () => setStep((s) => Math.max(1, s - 1));

  const onFinish = async () => {
    if (!validateStep(TOTAL_STEPS)) return;
    // Mautic: step 3 concluída (validação passou no submit final).
    trackMauticEvent(
      "signup_step_3_completed",
      {
        page_url: typeof window !== "undefined"
          ? `${window.location.origin}/signup`
          : "/signup",
        page_title: "signup_step_3_completed",
        email: data.email || undefined,
      },
      { dedupeKey: `${data.email.toLowerCase() || "anon"}:3` },
    );
    setLoading(true);
    try {
      // Pre-check: e-mail e CNPJ duplicados ANTES de chamar supabase.auth.signUp,
      // porque o Supabase Auth NÃO retorna erro para e-mail existente (anti
      // user-enumeration) e o CNPJ só é validado no RPC de onboarding —
      // sem este pré-check o usuário recebe "confirmação enviada" indevidamente
      // e os eventos Mautic signup_duplicate_* nunca disparam.
      try {
        const availability = await availabilityFn({
          data: { email: data.email, tax_id: data.tax_id },
        });
        console.info("[mautic] signup availability", availability);
        const emailKey = data.email.toLowerCase();
        if (availability.email_taken) {
          toast.error(t("auth.emailAlreadyRegistered", { defaultValue: "Este e-mail já está cadastrado. Faça login ou recupere a senha." }));
          trackMauticEvent(
            "signup_duplicate_email",
            {
              page_url: `${window.location.origin}/signup`,
              page_title: "signup_duplicate_email",
              email: data.email,
            },
            { dedupeKey: emailKey },
          );
          setErrors((e) => ({ ...e, email: "signup.errors.emailTaken" }));
          setStep(1);
          return;
        }
        if (availability.cnpj_taken) {
          toast.error(t("signup.errors.cnpjTaken", { defaultValue: "Este CNPJ já está cadastrado em outra conta." }));
          trackMauticEvent(
            "signup_duplicate_cnpj",
            {
              page_url: `${window.location.origin}/signup`,
              page_title: "signup_duplicate_cnpj",
              email: data.email,
              tax_id: data.tax_id,
            },
            { dedupeKey: `${emailKey}:${data.tax_id}` },
          );
          setErrors((e) => ({ ...e, tax_id: "signup.errors.cnpjTaken" }));
          setStep(2);
          return;
        }
      } catch (availErr) {
        // Falha no pré-check não bloqueia o fluxo — segue para signUp e a
        // classificação do erro do Supabase Auth abaixo cobre o fallback.
        console.warn("[mautic] signup availability check failed", availErr);
      }

      // Payload sent to complete_buyer_signup. Optional complementary fields
      // are sent empty; user fills them later in /profile.
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
        phone: toE164BR(data.whatsapp),       // mirror whatsapp into phone
        whatsapp: toE164BR(data.whatsapp),
        preferred_language: data.preferred_language,
        additional_contacts: [],
        buyer_types: data.buyer_types,
        interests_segments: data.interests_segments,
        interests_destinations: [],
        interests_destinations_free: "",
        interests_services: [],
        portfolio_pt: "",
        notes: "",
        networking_lunch_participation: data.networking_lunch_participation === "yes",
        consent_data_sharing: data.consent_data_sharing,
        consent_marketing: false,
      };
      try {
        sessionStorage.setItem(BUYER_SIGNUP_STORAGE_KEY, JSON.stringify(payload));
      } catch { /* ignore */ }

      const { error } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          data: {
            full_name: data.full_name,
            preferred_language: data.preferred_language,
            buyer_signup_payload: payload,
          },
        },
      });
      if (error) {
        toast.error(error.message);
        // Mautic: classificar a falha do signUp.
        const msg = (error.message || "").toLowerCase();
        const emailKey = data.email.toLowerCase();
        const isDupEmail =
          msg.includes("already registered") ||
          msg.includes("already exists") ||
          msg.includes("user already") ||
          msg.includes("registrado") ||
          msg.includes("já existe") ||
          msg.includes("duplicate") && msg.includes("email");
        const isDupCnpj =
          msg.includes("cnpj") || msg.includes("tax_id") || msg.includes("tax id");
        if (isDupEmail) {
          trackMauticEvent(
            "signup_duplicate_email",
            {
              page_url: `${window.location.origin}/signup`,
              page_title: "signup_duplicate_email",
              email: data.email,
            },
            { dedupeKey: emailKey },
          );
        } else if (isDupCnpj) {
          trackMauticEvent(
            "signup_duplicate_cnpj",
            {
              page_url: `${window.location.origin}/signup`,
              page_title: "signup_duplicate_cnpj",
              email: data.email,
              tax_id: data.tax_id,
            },
            { dedupeKey: `${emailKey}:${data.tax_id}` },
          );
        } else {
          trackMauticEvent(
            "signup_submit_failed",
            {
              page_url: `${window.location.origin}/signup`,
              page_title: "signup_submit_failed",
              email: data.email,
              error_message: error.message,
            },
            { dedupeKey: `${emailKey}:${error.message}` },
          );
        }
        return;
      }
      // Mautic: conta criada. Disparado só no caminho de sucesso, com
      // dedupe por e-mail para evitar duplicidade em reenvios.
      try {
        const firstname = data.full_name.trim().split(/\s+/)[0] ?? "";
        trackMauticEvent(
          "lead_account_created",
          {
            page_url: `${window.location.origin}/signup/sucesso`,
            page_title: "Lead account created",
            email: data.email,
            firstname,
          },
          { dedupeKey: data.email.toLowerCase() },
        );
      } catch { /* analytics never breaks the flow */ }
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
            <p className="text-xs text-muted-foreground">{t("signup.completeProfileHint")}</p>
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
            <h1 className="text-3xl font-bold">{t("signup.quickTitle")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t("signup.quickSubtitle")}</p>
            <p className="mt-2 text-xs text-muted-foreground">{t("signup.mandatoryNote")}</p>
            <div className="mt-6">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t("signup.stepLabel", { current: step, total: TOTAL_STEPS })}</span>
                <span>{t(`signup.quickStepTitles.${step}`)}</span>
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
                  <Step1 data={data} set={set} errors={errors} t={t}
                    onEmailBlur={() => void runLookup(data.email)} />
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
                <Step3 data={data} set={set} errors={errors} t={t} lang={lang} />
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
  let text: string;
  if (msg.startsWith("signup.") || msg.startsWith("auth.")) {
    text = t(msg);
  } else {
    const known = ["cnpjInvalid", "phoneInvalid", "urlInvalid", "passwordMismatch", "consentRequired"];
    text = known.includes(msg) ? t(`signup.errors.${msg}`) : t("signup.errors.required");
  }
  return <p className="mt-1 text-xs font-medium text-destructive">{text}</p>;
}

function PrefillBanner({ t, onAccept, onDismiss }: { t: StepProps["t"]; onAccept: () => void; onDismiss: () => void }) {
  return (
    <div className="rounded-md border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/40">
      <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-100">
        {t("signup.prefill.bannerTitle")}
      </h3>
      <p className="mt-1 text-sm text-blue-900/80 dark:text-blue-100/80">
        {t("signup.prefill.bannerBody")}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={onAccept}>{t("signup.prefill.useMyData")}</Button>
        <Button type="button" size="sm" variant="outline" onClick={onDismiss}>{t("signup.prefill.startBlank")}</Button>
      </div>
    </div>
  );
}

function Step1({ data, set, errors, t, onEmailBlur }: StepProps & { onEmailBlur?: () => void }) {
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="email">{t("auth.email")} *</Label>
        <Input id="email" type="email" autoComplete="email" value={data.email}
          onChange={(e) => set("email", e.target.value)} onBlur={onEmailBlur} className="mt-1.5" />
        <FieldError msg={errors.email} t={t} />
      </div>
      <div>
        <Label htmlFor="password">{t("auth.password")} *</Label>
        <PasswordInput id="password" autoComplete="new-password" value={data.password}
          onChange={(e) => set("password", e.target.value)} className="mt-1.5" />
        <p className="mt-1 text-xs text-muted-foreground">{t("auth.passwordGuidelines")}</p>
        <PasswordStrength value={data.password} />
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
        <Label htmlFor="tax_id">{t("signup.taxId")} *</Label>
        <Input id="tax_id" inputMode="numeric" placeholder="00.000.000/0000-00" value={data.tax_id}
          onChange={(e) => set("tax_id", formatCNPJ(e.target.value))} className="mt-1.5" />
        <p className="mt-1 text-xs text-muted-foreground">{t("signup.taxIdHelp")}</p>
        <FieldError msg={errors.tax_id} t={t} />
      </div>
      <div>
        <Label htmlFor="legal_name">{t("signup.legalName")} *</Label>
        <Input id="legal_name" value={data.legal_name}
          onChange={(e) => set("legal_name", e.target.value)} className="mt-1.5" />
        <FieldError msg={errors.legal_name} t={t} />
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
    </div>
  );
}

function Step3({ data, set, errors, t, lang }: StepProps & { lang: "pt" | "es" }) {
  const whatsappDigits = data.whatsapp.replace(/\D+/g, "");
  const showDDDHint = whatsappDigits.length >= 8 && whatsappDigits.length <= 9;
  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
        {t("signup.accountEmailNote", { email: data.email })}
      </div>
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
      <div>
        <Label htmlFor="whatsapp">{t("signup.whatsapp")} *</Label>
        <Input id="whatsapp" inputMode="tel" placeholder="(DDD) 9XXXX-XXXX — ex: (11) 98765-4321"
          value={data.whatsapp}
          onChange={(e) => set("whatsapp", formatBRPhone(e.target.value))} className="mt-1.5" />
        {showDDDHint && (
          <p className="mt-1 text-xs text-muted-foreground">{t("signup.hints.includeDDD")}</p>
        )}
        <FieldError msg={errors.whatsapp} t={t} />
      </div>
      <div>
        <Label>{t("signup.buyerType")}</Label>
        <div className="mt-1.5">
          <MultiSelectChips taxonomyKey="buyer_types" value={data.buyer_types}
            onChange={(v) => set("buyer_types", v)} />
        </div>
        <FieldError msg={errors.buyer_types} t={t} />
      </div>
      <div>
        <Label>{t("signup.segments")}</Label>
        <div className="mt-1.5">
          <MultiSelectChips taxonomyKey="segments" value={data.interests_segments}
            onChange={(v) => set("interests_segments", v)} />
        </div>
        <FieldError msg={errors.interests_segments} t={t} />
      </div>
      <div className="space-y-2 rounded-md border p-3">
        <Label>{t("signup.networkingLunch.label")} *</Label>
        <p className="text-xs text-muted-foreground">
          {t("signup.networkingLunch.help")}
        </p>
        <div className="mt-1 space-y-2">
          <label className="flex items-start gap-2 text-sm leading-snug">
            <input
              type="radio"
              name="networking_lunch_participation"
              value="yes"
              checked={data.networking_lunch_participation === "yes"}
              onChange={() => set("networking_lunch_participation", "yes")}
              className="mt-0.5"
            />
            <span>{t("signup.networkingLunch.yes")}</span>
          </label>
          <label className="flex items-start gap-2 text-sm leading-snug">
            <input
              type="radio"
              name="networking_lunch_participation"
              value="no"
              checked={data.networking_lunch_participation === "no"}
              onChange={() => set("networking_lunch_participation", "no")}
              className="mt-0.5"
            />
            <span>{t("signup.networkingLunch.no")}</span>
          </label>
        </div>
        <FieldError msg={errors.networking_lunch_participation} t={t} />
      </div>
      <div className="flex items-start gap-2 rounded-md border p-3">
        <Checkbox id="consent_data_sharing" checked={data.consent_data_sharing}
          onCheckedChange={(v) => set("consent_data_sharing", v === true)} />
        <Label htmlFor="consent_data_sharing" className="text-sm leading-snug">
          {t("signup.consentDataSharing")} *
        </Label>
      </div>
      <FieldError msg={errors.consent_data_sharing} t={t} />
    </div>
  );
}
