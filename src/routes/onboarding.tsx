import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";

export const Route = createFileRoute("/onboarding")({ component: OnboardingPage });

type Kind = "visitor" | "exhibitor";

function OnboardingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { data: profile } = useProfile();
  const [kind, setKind] = useState<Kind | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [saving, setSaving] = useState(false);

  if (!authLoading && !user) { navigate({ to: "/login" }); return null; }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !profile || !kind) return;
    setSaving(true);
    try {
      const finalCountry = country || (kind === "exhibitor" ? "PE" : "BR");
      const { data: company, error: cErr } = await supabase.from("companies").insert({ trade_name: companyName, country_code: finalCountry, city: city || null }).select().single();
      if (cErr) throw cErr;
      const { error: pErr } = await supabase.from("profiles").update({ company_id: company.id }).eq("id", profile.id);
      if (pErr) throw pErr;
      if (kind === "visitor") {
        await supabase.from("visitor_profiles").upsert({ profile_id: profile.id });
      } else {
        await supabase.from("exhibitor_profiles").upsert({ profile_id: profile.id });
        await supabase.from("user_roles").upsert({ user_id: user.id, role: "exhibitor" });
      }
      toast.success("OK");
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "erro");
    } finally { setSaving(false); }
  };

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