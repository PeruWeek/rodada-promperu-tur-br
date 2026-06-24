import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useProfile, getPrimaryRole } from "@/hooks/use-profile";
import { requestExhibitorAccess } from "@/lib/exhibitor-requests.functions";
import { completeExhibitorSignup } from "@/lib/exhibitor-requests.functions";
import { BUYER_SIGNUP_STORAGE_KEY } from "@/lib/validation/buyer-signup.schema";
import { EXHIBITOR_SIGNUP_STORAGE_KEY } from "@/lib/validation/exhibitor-signup.schema";
import { trackMauticEvent } from "@/lib/mautic";

export const Route = createFileRoute("/onboarding")({ component: OnboardingPage });

type Kind = "visitor" | "exhibitor";

function OnboardingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, loading: authLoading } = useAuth();
  const { data: profile } = useProfile();
  const requestExhibitorFn = useServerFn(requestExhibitorAccess);
  const completeExhibitorFn = useServerFn(completeExhibitorSignup);
  const [kind, setKind] = useState<Kind | null>(null);
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [saving, setSaving] = useState(false);
  const [autoFinishing, setAutoFinishing] = useState(false);
  const autoRan = useRef(false);
  const [buyerSuccess, setBuyerSuccess] = useState(false);
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const redirectedRef = useRef(false);

  useEffect(() => {
    if (!buyerSuccess) return;
    if (redirectedRef.current) return;
    try { sessionStorage.setItem("buyer_success_pending", "1"); } catch { /* ignore */ }
    redirectTimerRef.current = setTimeout(() => {
      if (redirectedRef.current) return;
      redirectedRef.current = true;
      try { sessionStorage.removeItem("buyer_success_pending"); } catch { /* ignore */ }
      navigate({ to: "/agenda", replace: true });
    }, 3000);
    return () => {
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current);
        redirectTimerRef.current = null;
      }
      if (!redirectedRef.current) {
        try { sessionStorage.removeItem("buyer_success_pending"); } catch { /* ignore */ }
      }
    };
  }, [buyerSuccess, navigate]);

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/login", replace: true });
  }, [authLoading, user, navigate]);
  if (!authLoading && !user) return null;

  const primaryRole = profile ? getPrimaryRole(profile.roles) : null;
  const lockedKind: Kind | null =
    primaryRole === "visitor" ? "visitor" : primaryRole === "exhibitor" ? "exhibitor" : null;
  const effectiveKind: Kind | null = lockedKind ?? kind;

  // Pre-select kind when role is already known (no picker needed).
  useEffect(() => {
    if (lockedKind && kind !== lockedKind) setKind(lockedKind);
  }, [lockedKind, kind]);

  // Pre-fill full name from current profile so the visitor can correct it here.
  useEffect(() => {
    if (profile && !fullName) setFullName(profile.full_name ?? "");
  }, [profile, fullName]);

  // If the user already has a role/profile set up, skip the kind picker entirely.
  useEffect(() => {
    if (!profile) return;
    // Don't short-circuit while the buyer success screen is showing
    // (auto-finalize just ran and we need the 3s redirect to play).
    if (buyerSuccess || autoFinishing) return;
    const primary = getPrimaryRole(profile.roles);
    if (primary === "admin" || primary === "staff") {
      navigate({ to: "/admin" });
    } else if (primary === "exhibitor") {
      // Exhibitor with a company already set goes straight to dashboard; otherwise show only the company form.
      if (profile.company_id) navigate({ to: "/dashboard" });
    } else if (primary === "visitor" && profile.company_id) {
      navigate({ to: "/agenda" });
    }
  }, [profile, navigate, buyerSuccess, autoFinishing]);

  // If the buyer wizard left a pending payload, finalize automatically and skip the kind picker.
  useEffect(() => {
    if (!user || !profile) return;
    if (autoRan.current) return;
    const clearPayloads = async () => {
      try { sessionStorage.removeItem(BUYER_SIGNUP_STORAGE_KEY); } catch { /* ignore */ }
      try { sessionStorage.removeItem(EXHIBITOR_SIGNUP_STORAGE_KEY); } catch { /* ignore */ }
      try {
        await supabase.auth.updateUser({
          data: { buyer_signup_payload: null, exhibitor_signup_payload: null },
        });
      } catch { /* ignore */ }
    };
    // Exhibitor quick-signup payload takes priority over buyer payload.
    let exhRaw: string | null = null;
    try { exhRaw = sessionStorage.getItem(EXHIBITOR_SIGNUP_STORAGE_KEY); } catch { /* ignore */ }
    let exhPayload: Record<string, unknown> | null = null;
    if (exhRaw) { try { exhPayload = JSON.parse(exhRaw); } catch { exhPayload = null; } }
    if (!exhPayload) {
      const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
      const fromMeta = meta.exhibitor_signup_payload;
      if (fromMeta && typeof fromMeta === "object") exhPayload = fromMeta as Record<string, unknown>;
    }
    if (exhPayload) {
      autoRan.current = true;
      setAutoFinishing(true);
      (async () => {
        try {
          await completeExhibitorFn({ data: exhPayload as never });
          try { sessionStorage.removeItem(EXHIBITOR_SIGNUP_STORAGE_KEY); } catch { /* ignore */ }
          try { await supabase.auth.updateUser({ data: { exhibitor_signup_payload: null } }); } catch { /* ignore */ }
          await qc.invalidateQueries();
          toast.success(t("onboarding.requestedExhibitor"));
          navigate({ to: "/pending-exhibitor" });
        } catch (err) {
          console.error("[onboarding.auto-exhibitor] failed", err);
          await clearPayloads();
          setAutoFinishing(false);
          toast.error(err instanceof Error ? err.message : "erro", { id: "onboarding-auto-error" });
        }
      })();
      return;
    }
    let raw: string | null = null;
    try { raw = sessionStorage.getItem(BUYER_SIGNUP_STORAGE_KEY); } catch { /* ignore */ }
    let payload: Record<string, unknown> | null = null;
    if (raw) {
      try { payload = JSON.parse(raw); } catch { payload = null; }
    }
    if (!payload) {
      // Fallback: payload stored in auth user_metadata at signup (survives cross-device).
      const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
      const fromMeta = meta.buyer_signup_payload;
      if (fromMeta && typeof fromMeta === "object") {
        payload = fromMeta as Record<string, unknown>;
      }
    }
    if (!payload) return;
    autoRan.current = true;
    setAutoFinishing(true);
    (async () => {
      try {
        const { error } = await (supabase.rpc as unknown as (
          fn: string, args: Record<string, unknown>,
        ) => Promise<{ error: { message: string } | null }>)("complete_buyer_signup", { p_payload: payload });
        if (error) throw error;
        try { sessionStorage.removeItem(BUYER_SIGNUP_STORAGE_KEY); } catch { /* ignore */ }
        // Clear the metadata copy so we don't replay on subsequent visits.
        try { await supabase.auth.updateUser({ data: { buyer_signup_payload: null } }); } catch { /* ignore */ }
        // Mautic: inscrição concluída (RPC retornou sem erro = conversão real).
        // Dedupe por user.id para evitar duplicidade em reexecuções do efeito.
        try {
          const email = user.email ?? (payload as Record<string, unknown>)["email"] as string | undefined;
          const fullName = ((payload as Record<string, unknown>)["full_name"] as string | undefined) ?? profile.full_name ?? "";
          const firstname = fullName.trim().split(/\s+/)[0] ?? "";
          trackMauticEvent(
            "lead_signup_completed",
            {
              page_url: `${window.location.origin}/onboarding/sucesso`,
              page_title: "Lead signup completed",
              email,
              firstname,
            },
            { dedupeKey: user.id },
          );
        } catch { /* analytics never breaks the flow */ }
        await qc.invalidateQueries();
        setAutoFinishing(false);
        setBuyerSuccess(true);
      } catch (err) {
        console.error("[onboarding.auto-buyer] failed", err);
        // Clear corrupted/invalid payload so we don't retry the same failure.
        await clearPayloads();
        setAutoFinishing(false);
        toast.error(err instanceof Error ? err.message : "erro", { id: "onboarding-auto-error" });
      }
    })();
  }, [user, profile, qc, navigate, t, completeExhibitorFn]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const submitKind = effectiveKind;
    if (!user || !profile || !submitKind) return;
    const cleanName = fullName.trim();
    if (!cleanName) {
      toast.error(t("auth.fullName") + " *");
      return;
    }
    setSaving(true);
    try {
      if (cleanName !== profile.full_name) {
        const { error: nErr } = await supabase
          .from("profiles")
          .update({ full_name: cleanName })
          .eq("id", profile.id);
        if (nErr) throw nErr;
      }
      const finalCountry = country || (submitKind === "exhibitor" ? "PE" : "BR");
      const { error: cErr } = await supabase.rpc("onboard_company", {
        p_trade_name: companyName,
        p_country_code: finalCountry,
        p_city: city || "",
      });
      if (cErr) throw cErr;

      if (submitKind === "visitor") {
        await supabase.from("visitor_profiles").upsert({ profile_id: profile.id });
        await qc.invalidateQueries();
        setBuyerSuccess(true);
      } else {
        await requestExhibitorFn();
        await qc.invalidateQueries();
        toast.success(t("onboarding.requestedExhibitor"));
        navigate({ to: "/pending-exhibitor" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "erro");
    } finally { setSaving(false); }
  };

  if (autoFinishing) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <div className="mx-auto max-w-md px-4 py-16 text-center">
          <p className="text-muted-foreground">{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  if (buyerSuccess) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <div className="mx-auto max-w-md space-y-3 px-4 py-16 text-center">
          <h1 className="text-2xl font-bold">{t("onboarding.buyerSuccessTitle")}</h1>
          <p className="text-muted-foreground">{t("onboarding.buyerSuccessBody")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="text-3xl font-bold">{t("onboarding.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("onboarding.subtitle")}</p>
        {!lockedKind && (
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {(["visitor"] as Kind[]).map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)} className={`text-left rounded-xl border-2 p-5 transition-colors ${kind === k ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}>
                <div className="font-bold">{t(`onboarding.${k}`)}</div>
                <div className="mt-1 text-sm text-muted-foreground">{t(`onboarding.${k}Desc`)}</div>
              </button>
            ))}
          </div>
        )}
        {effectiveKind && (
          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            <div><Label htmlFor="fullName">{t("auth.fullName")} *</Label><Input id="fullName" required value={fullName} onChange={(e) => setFullName(e.target.value)} className="mt-1.5" /></div>
            <div><Label htmlFor="company">{t("onboarding.companyName")}</Label><Input id="company" required value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="mt-1.5" /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label htmlFor="country">{t("onboarding.country")}</Label>
                <select id="country" value={country} onChange={(e) => setCountry(e.target.value)} className="mt-1.5 h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">—</option><option value="BR">Brasil</option><option value="PE">Perú</option>
                </select>
              </div>
              <div><Label htmlFor="city">{t("onboarding.city")}</Label><Input id="city" value={city} onChange={(e) => setCity(e.target.value)} className="mt-1.5" /></div>
            </div>
            <Button type="submit" size="lg" className="w-full" disabled={saving}>{t("onboarding.continue")}</Button>
          </form>
        )}
      </div>
    </div>
  );
}