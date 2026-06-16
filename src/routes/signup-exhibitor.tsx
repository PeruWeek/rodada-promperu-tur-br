import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";

import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Checkbox } from "@/components/ui/checkbox";
import { MultiSelectChips } from "@/components/multi-select-chips";
import { supabase } from "@/integrations/supabase/client";
import {
  EXHIBITOR_SIGNUP_STORAGE_KEY,
  type ExhibitorSignupData,
  exhibitorAccountSchema,
  exhibitorCompanyQuickSchema,
  exhibitorContactProfileQuickSchema,
} from "@/lib/validation/exhibitor-signup.schema";

export const Route = createFileRoute("/signup-exhibitor")({
  head: () => ({ meta: [{ title: "Registro de expositor — PERU MICE Networking Evento" }] }),
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/dashboard" });
  },
  component: SignupExhibitorPage,
});

const TOTAL_STEPS = 3;

const emptyData: ExhibitorSignupData = {
  email: "",
  password: "",
  confirmPassword: "",
  trade_name: "",
  city: "",
  full_name: "",
  job_title: "",
  whatsapp: "",
  preferred_language: "es",
  segments: [],
  services: [],
  consent_data_sharing: false,
};

type Errors = Record<string, string>;

function flattenZodErrors(err: z.ZodError): Errors {
  const out: Errors = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

function SignupExhibitorPage() {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language === "es" ? "es" : "pt") as "pt" | "es";
  const [step, setStep] = useState(1);
  const [data, setData] = useState<ExhibitorSignupData>({
    ...emptyData,
    preferred_language: i18n.language?.startsWith("es") ? "es" : "pt-BR",
  });
  const [errors, setErrors] = useState<Errors>({});
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const set = <K extends keyof ExhibitorSignupData>(k: K, v: ExhibitorSignupData[K]) =>
    setData((d) => ({ ...d, [k]: v }));

  const validateStep = (s: number) => {
    const schemas = [exhibitorAccountSchema, exhibitorCompanyQuickSchema, exhibitorContactProfileQuickSchema];
    const r = schemas[s - 1].safeParse(data);
    if (r.success) { setErrors({}); return true; }
    setErrors(flattenZodErrors(r.error));
    return false;
  };

  const next = () => { if (validateStep(step)) setStep((s) => Math.min(TOTAL_STEPS, s + 1)); };
  const back = () => setStep((s) => Math.max(1, s - 1));

  const onFinish = async () => {
    if (!validateStep(TOTAL_STEPS)) return;
    setLoading(true);
    try {
      const payload = {
        trade_name: data.trade_name,
        city: data.city,
        full_name: data.full_name,
        job_title: data.job_title,
        whatsapp: data.whatsapp,
        preferred_language: data.preferred_language,
        segments: data.segments,
        services: data.services,
      };
      try { sessionStorage.setItem(EXHIBITOR_SIGNUP_STORAGE_KEY, JSON.stringify(payload)); }
      catch { /* ignore */ }

      const { error } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          emailRedirectTo: `${window.location.origin}/onboarding`,
          data: {
            full_name: data.full_name,
            preferred_language: data.preferred_language,
            exhibitor_signup_payload: payload,
          },
        },
      });
      if (error) { toast.error(error.message); return; }
      setSent(true);
    } finally { setLoading(false); }
  };

  const progress = useMemo(() => Math.round((step / TOTAL_STEPS) * 100), [step]);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-2xl px-4 py-12">
        {sent ? (
          <div className="space-y-4 rounded-lg border bg-card p-6">
            <h1 className="text-2xl font-bold">{t("auth.signupSuccessTitle")}</h1>
            <p className="text-sm text-muted-foreground">{t("auth.checkEmailBody", { email: data.email })}</p>
            <p className="text-xs text-muted-foreground">{t("auth.checkEmailHint")}</p>
            <p className="text-xs text-muted-foreground">{t("signup.exhibitor.afterEmailHint")}</p>
          </div>
        ) : (
          <>
            <h1 className="text-3xl font-bold">{t("signup.exhibitor.quickTitle")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t("signup.exhibitor.quickSubtitle")}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              <Link to="/signup" className="font-medium text-primary hover:underline">
                {t("signup.buyerCta")}
              </Link>
            </p>
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
              onSubmit={(e) => { e.preventDefault(); if (step < TOTAL_STEPS) next(); else void onFinish(); }}
            >
              {step === 1 && <Step1 data={data} set={set} errors={errors} t={t} />}
              {step === 2 && <Step2 data={data} set={set} errors={errors} t={t} />}
              {step === 3 && <Step3 data={data} set={set} errors={errors} t={t} lang={lang} />}

              <div className="flex items-center justify-between pt-2">
                {step > 1
                  ? <Button type="button" variant="outline" onClick={back} disabled={loading}>{t("common.back")}</Button>
                  : <span />}
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
  data: ExhibitorSignupData;
  set: <K extends keyof ExhibitorSignupData>(k: K, v: ExhibitorSignupData[K]) => void;
  errors: Errors;
  t: (k: string, opts?: Record<string, unknown>) => string;
};

function FieldError({ msg, t }: { msg?: string; t: StepProps["t"] }) {
  if (!msg) return null;
  let text: string;
  if (msg.startsWith("signup.")) text = t(msg);
  else {
    const known = ["phoneInvalid", "passwordMismatch", "consentRequired"];
    text = known.includes(msg) ? t(`signup.errors.${msg}`) : t("signup.errors.required");
  }
  return <p className="mt-1 text-xs font-medium text-destructive">{text}</p>;
}

function Step1({ data, set, errors, t }: StepProps) {
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="email">{t("auth.email")} *</Label>
        <Input id="email" type="email" autoComplete="email" value={data.email}
          onChange={(e) => set("email", e.target.value)} className="mt-1.5" />
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
        <Input value="Perú" disabled className="mt-1.5" />
      </div>
      <div>
        <Label htmlFor="trade_name">{t("signup.tradeName")} *</Label>
        <Input id="trade_name" value={data.trade_name}
          onChange={(e) => set("trade_name", e.target.value)} className="mt-1.5" />
        <FieldError msg={errors.trade_name} t={t} />
      </div>
      <div>
        <Label htmlFor="city">{t("signup.exhibitor.cityRegion")} *</Label>
        <Input id="city" value={data.city}
          onChange={(e) => set("city", e.target.value)} className="mt-1.5" />
        <FieldError msg={errors.city} t={t} />
      </div>
      <p className="text-xs text-muted-foreground">{t("signup.exhibitor.complementaryHint")}</p>
    </div>
  );
}

function Step3({ data, set, errors, t }: StepProps & { lang: "pt" | "es" }) {
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
        <Input id="whatsapp" inputMode="tel" placeholder="+51 9 12345 6789"
          value={data.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} className="mt-1.5" />
        <FieldError msg={errors.whatsapp} t={t} />
      </div>
      <div>
        <Label htmlFor="preferred_language">{t("signup.preferredLanguage")} *</Label>
        <select id="preferred_language" value={data.preferred_language}
          onChange={(e) => set("preferred_language", e.target.value as "pt-BR" | "es")}
          className="mt-1.5 h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
          <option value="es">Español</option>
          <option value="pt-BR">Português</option>
        </select>
      </div>
      <div>
        <Label>{t("signup.exhibitor.segments")} *</Label>
        <div className="mt-1.5">
          <MultiSelectChips taxonomyKey="segments" value={data.segments}
            onChange={(v) => set("segments", v)} />
        </div>
        <FieldError msg={errors.segments} t={t} />
      </div>
      <div>
        <Label>{t("signup.exhibitor.services")} *</Label>
        <div className="mt-1.5">
          <MultiSelectChips taxonomyKey="services" value={data.services}
            onChange={(v) => set("services", v)} />
        </div>
        <FieldError msg={errors.services} t={t} />
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
