import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
import { useProfile } from "@/hooks/use-profile";
import { requestExhibitorAccess } from "@/lib/exhibitor-requests.functions";
import { BUYER_SIGNUP_STORAGE_KEY } from "@/lib/validation/buyer-signup.schema";

export const Route = createFileRoute("/onboarding")({ component: OnboardingPage });

type Kind = "visitor" | "exhibitor";

function OnboardingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, loading: authLoading } = useAuth();
  const { data: profile } = useProfile();
  const requestExhibitorFn = useServerFn(requestExhibitorAccess);
  const [kind, setKind] = useState<Kind | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [saving, setSaving] = useState(false);
  const [autoFinishing, setAutoFinishing] = useState(false);

  if (!authLoading && !user) { navigate({ to: "/login" }); return null; }

  // If the buyer wizard left a pending payload, finalize automatically and skip the kind picker.
  useEffect(() => {
    if (!user || !profile || autoFinishing) return;
    let raw: string | null = null;
    try { raw = sessionStorage.getItem(BUYER_SIGNUP_STORAGE_KEY); } catch { /* ignore */ }
    if (!raw) return;
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(raw); } catch { return; }
    setAutoFinishing(true);
    (async () => {
      try {
        const { error } = await (supabase.rpc as unknown as (
          fn: string, args: Record<string, unknown>,
        ) => Promise<{ error: { message: string } | null }>)("complete_buyer_signup", { p_payload: payload });
        if (error) throw error;
        try { sessionStorage.removeItem(BUYER_SIGNUP_STORAGE_KEY); } catch { /* ignore */ }
        await qc.invalidateQueries();
        toast.success(t("onboarding.savedVisitor"));
        navigate({ to: "/dashboard" });
      } catch (err) {
        setAutoFinishing(false);
        toast.error(err instanceof Error ? err.message : "erro");
      }
    })();
  }, [user, profile, autoFinishing, qc, navigate, t]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !profile || !kind) return;
    setSaving(true);
    try {
      const finalCountry = country || (kind === "exhibitor" ? "PE" : "BR");
      const { error: cErr } = await supabase.rpc("onboard_company", {
        p_trade_name: companyName,
        p_country_code: finalCountry,
        p_city: city || "",
      });
      if (cErr) throw cErr;

      if (kind === "visitor") {
        await supabase.from("visitor_profiles").upsert({ profile_id: profile.id });
        await qc.invalidateQueries();
        toast.success(t("onboarding.savedVisitor"));
        navigate({ to: "/dashboard" });
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

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="text-3xl font-bold">{t("onboarding.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("onboarding.subtitle")}</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {(["visitor", "exhibitor"] as Kind[]).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={`text-left rounded-xl border-2 p-5 transition-colors ${kind === k ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}>
              <div className="font-bold">{t(`onboarding.${k}`)}</div>
              <div className="mt-1 text-sm text-muted-foreground">{t(`onboarding.${k}Desc`)}</div>
              {k === "exhibitor" && (
                <div className="mt-2 inline-block rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                  {t("onboarding.requiresApproval")}
                </div>
              )}
            </button>
          ))}
        </div>
        {kind && (
          <form onSubmit={onSubmit} className="mt-8 space-y-4">
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