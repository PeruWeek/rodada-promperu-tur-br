import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useProfile, hasRole } from "@/hooks/use-profile";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MultiSelectChips } from "@/components/multi-select-chips";
import { COUNTRIES, TAXONOMY } from "@/lib/taxonomy";

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language === "es" ? "es" : "pt") as "pt" | "es";
  const { data: profile, isLoading } = useProfile();
  const qc = useQueryClient();

  const isExhibitor = hasRole(profile?.roles, "exhibitor");
  const isVisitor = hasRole(profile?.roles, "visitor") || !isExhibitor;

  const { data: extra, isLoading: extraLoading } = useQuery({
    enabled: !!profile,
    queryKey: ["profile-extra", profile?.id, isExhibitor],
    queryFn: async () => {
      if (!profile) return null;
      const [{ data: company }, { data: vis }, { data: exh }] = await Promise.all([
        profile.company_id
          ? supabase.from("companies").select("*").eq("id", profile.company_id).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.from("visitor_profiles").select("*").eq("profile_id", profile.id).maybeSingle(),
        supabase.from("exhibitor_profiles").select("*").eq("profile_id", profile.id).maybeSingle(),
      ]);
      return { company, vis: vis ?? null, exh: exh ?? null };
    },
  });

  // Personal
  const [fullName, setFullName] = useState("");
  const [prefLang, setPrefLang] = useState<"pt-BR" | "es">("pt-BR");
  // Company
  const [trade, setTrade] = useState("");
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [website, setWebsite] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [instagram, setInstagram] = useState("");
  // Visitor
  const [buyerType, setBuyerType] = useState("");
  const [vSegments, setVSegments] = useState<string[]>([]);
  const [vServices, setVServices] = useState<string[]>([]);
  const [vDestinations, setVDestinations] = useState<string[]>([]);
  const [vPortPt, setVPortPt] = useState("");
  const [vPortEs, setVPortEs] = useState("");
  const [vNotes, setVNotes] = useState("");
  // Exhibitor
  const [eSegments, setESegments] = useState<string[]>([]);
  const [eServices, setEServices] = useState<string[]>([]);
  const [eDestinations, setEDestinations] = useState<string[]>([]);
  const [eTargetBuyers, setETargetBuyers] = useState<string[]>([]);
  const [pitchPt, setPitchPt] = useState("");
  const [pitchEs, setPitchEs] = useState("");
  const [ePortPt, setEPortPt] = useState("");
  const [ePortEs, setEPortEs] = useState("");
  const [materials, setMaterials] = useState<string[]>([]);

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setFullName(profile.full_name ?? "");
    setPrefLang(profile.preferred_language);
  }, [profile]);

  useEffect(() => {
    if (!extra) return;
    const c = extra.company;
    if (c) {
      setTrade(c.trade_name ?? "");
      setCountry(c.country_code ?? "");
      setCity(c.city ?? "");
      setWebsite(c.website ?? "");
      setPhone(c.phone ?? "");
      setWhatsapp(c.whatsapp ?? "");
      setLinkedin(c.linkedin ?? "");
      setInstagram(c.instagram ?? "");
    }
    if (extra.vis) {
      setBuyerType(extra.vis.buyer_type ?? "");
      setVSegments(extra.vis.interests_segments ?? []);
      setVServices(extra.vis.interests_services ?? []);
      setVDestinations(extra.vis.interests_destinations ?? []);
      setVPortPt(extra.vis.portfolio_pt ?? "");
      setVPortEs(extra.vis.portfolio_es ?? "");
      setVNotes(extra.vis.notes ?? "");
    }
    if (extra.exh) {
      setESegments(extra.exh.segments ?? []);
      setEServices(extra.exh.services ?? []);
      setEDestinations(extra.exh.destinations ?? []);
      setETargetBuyers(extra.exh.target_buyers ?? []);
      setPitchPt(extra.exh.pitch_pt ?? "");
      setPitchEs(extra.exh.pitch_es ?? "");
      setEPortPt(extra.exh.portfolio_pt ?? "");
      setEPortEs(extra.exh.portfolio_es ?? "");
      setMaterials(extra.exh.materials_links ?? []);
    }
  }, [extra]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);
    try {
      const { error: pErr } = await supabase
        .from("profiles")
        .update({ full_name: fullName, preferred_language: prefLang })
        .eq("id", profile.id);
      if (pErr) throw pErr;
      i18n.changeLanguage(prefLang);

      if (profile.company_id) {
        const { error: cErr } = await supabase
          .from("companies")
          .update({
            trade_name: trade,
            country_code: country || "BR",
            city: city || null,
            website: website || null,
            phone: phone || null,
            whatsapp: whatsapp || null,
            linkedin: linkedin || null,
            instagram: instagram || null,
          })
          .eq("id", profile.company_id);
        if (cErr) throw cErr;
      }

      if (isVisitor) {
        const { error: vErr } = await supabase.from("visitor_profiles").upsert({
          profile_id: profile.id,
          buyer_type: buyerType || null,
          interests_segments: vSegments,
          interests_services: vServices,
          interests_destinations: vDestinations,
          portfolio_pt: vPortPt || null,
          portfolio_es: vPortEs || null,
          notes: vNotes || null,
        });
        if (vErr) throw vErr;
      }

      if (isExhibitor) {
        const cleanMaterials = materials.map((m) => m.trim()).filter(Boolean);
        const { error: eErr } = await supabase.from("exhibitor_profiles").upsert({
          profile_id: profile.id,
          segments: eSegments,
          services: eServices,
          destinations: eDestinations,
          target_buyers: eTargetBuyers,
          pitch_pt: pitchPt || null,
          pitch_es: pitchEs || null,
          portfolio_pt: ePortPt || null,
          portfolio_es: ePortEs || null,
          materials_links: cleanMaterials,
        });
        if (eErr) throw eErr;
      }

      await qc.invalidateQueries({ queryKey: ["profile"] });
      await qc.invalidateQueries({ queryKey: ["profile-extra"] });
      toast.success(t("profile.saved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("profile.errorSave"));
    } finally {
      setSaving(false);
    }
  };

  if (isLoading || extraLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-10">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:py-12">
      <form onSubmit={onSubmit} className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold">{t("profile.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("profile.subtitle")}</p>
      </header>

      <Card className="space-y-4 p-6">
        <h2 className="text-lg font-semibold">{t("profile.personal")}</h2>
        <div>
          <Label htmlFor="fullName">{t("auth.fullName")}</Label>
          <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} className="mt-1.5" required />
        </div>
        <div>
          <Label htmlFor="prefLang">{t("profile.preferredLanguage")}</Label>
          <select
            id="prefLang"
            value={prefLang}
            onChange={(e) => setPrefLang(e.target.value as "pt-BR" | "es")}
            className="mt-1.5 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="pt-BR">Português (BR)</option>
            <option value="es">Español</option>
          </select>
        </div>
      </Card>

      <Card className="space-y-4 p-6">
        <h2 className="text-lg font-semibold">{t("profile.company")}</h2>
        <div>
          <Label htmlFor="trade">{t("onboarding.companyName")}</Label>
          <Input id="trade" value={trade} onChange={(e) => setTrade(e.target.value)} className="mt-1.5" required />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="country">{t("onboarding.country")}</Label>
            <select id="country" value={country} onChange={(e) => setCountry(e.target.value)} className="mt-1.5 h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="">—</option>
              {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{lang === "es" ? c.es : c.pt}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="city">{t("onboarding.city")}</Label>
            <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} className="mt-1.5" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><Label htmlFor="website">{t("profile.website")}</Label><Input id="website" value={website} onChange={(e) => setWebsite(e.target.value)} className="mt-1.5" placeholder="https://" /></div>
          <div><Label htmlFor="phone">{t("profile.phone")}</Label><Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1.5" /></div>
          <div><Label htmlFor="whatsapp">WhatsApp</Label><Input id="whatsapp" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} className="mt-1.5" /></div>
          <div><Label htmlFor="linkedin">LinkedIn</Label><Input id="linkedin" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} className="mt-1.5" placeholder="https://" /></div>
          <div className="sm:col-span-2"><Label htmlFor="instagram">Instagram</Label><Input id="instagram" value={instagram} onChange={(e) => setInstagram(e.target.value)} className="mt-1.5" placeholder="https://" /></div>
        </div>
      </Card>

      {isVisitor && !isExhibitor && (
        <Card className="space-y-5 p-6">
          <h2 className="text-lg font-semibold">{t("profile.visitorSection")}</h2>
          <div>
            <Label htmlFor="buyer">{t("profile.buyerType")}</Label>
            <select id="buyer" value={buyerType} onChange={(e) => setBuyerType(e.target.value)} className="mt-1.5 h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="">—</option>
              {TAXONOMY.buyer_types.map((b) => <option key={b.value} value={b.value}>{lang === "es" ? b.es : b.pt}</option>)}
            </select>
          </div>
          <ChipsField label={t("profile.interestsSegments")} value={vSegments} onChange={setVSegments} taxonomyKey="segments" />
          <ChipsField label={t("profile.interestsServices")} value={vServices} onChange={setVServices} taxonomyKey="services" />
          <ChipsField label={t("profile.interestsDestinations")} value={vDestinations} onChange={setVDestinations} taxonomyKey="destinations" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label>{t("profile.portfolioPt")}</Label><Textarea value={vPortPt} onChange={(e) => setVPortPt(e.target.value)} rows={4} className="mt-1.5" /></div>
            <div><Label>{t("profile.portfolioEs")}</Label><Textarea value={vPortEs} onChange={(e) => setVPortEs(e.target.value)} rows={4} className="mt-1.5" /></div>
          </div>
          <div><Label>{t("profile.notes")}</Label><Textarea value={vNotes} onChange={(e) => setVNotes(e.target.value)} rows={3} className="mt-1.5" /></div>
        </Card>
      )}

      {isExhibitor && (
        <Card className="space-y-5 p-6">
          <h2 className="text-lg font-semibold">{t("profile.exhibitorSection")}</h2>
          <ChipsField label={t("profile.segments")} value={eSegments} onChange={setESegments} taxonomyKey="segments" />
          <ChipsField label={t("profile.services")} value={eServices} onChange={setEServices} taxonomyKey="services" />
          <ChipsField label={t("profile.destinations")} value={eDestinations} onChange={setEDestinations} taxonomyKey="destinations" />
          <ChipsField label={t("profile.targetBuyers")} value={eTargetBuyers} onChange={setETargetBuyers} taxonomyKey="buyer_types" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label>{t("profile.pitchPt")}</Label><Textarea value={pitchPt} onChange={(e) => setPitchPt(e.target.value)} rows={4} className="mt-1.5" placeholder={t("profile.pitchPlaceholder") ?? ""} /></div>
            <div><Label>{t("profile.pitchEs")}</Label><Textarea value={pitchEs} onChange={(e) => setPitchEs(e.target.value)} rows={4} className="mt-1.5" /></div>
            <div><Label>{t("profile.portfolioPt")}</Label><Textarea value={ePortPt} onChange={(e) => setEPortPt(e.target.value)} rows={4} className="mt-1.5" /></div>
            <div><Label>{t("profile.portfolioEs")}</Label><Textarea value={ePortEs} onChange={(e) => setEPortEs(e.target.value)} rows={4} className="mt-1.5" /></div>
          </div>
          <div>
            <Label>{t("profile.materials")}</Label>
            <div className="mt-1.5 space-y-2">
              {materials.map((m, idx) => (
                <div key={idx} className="flex gap-2">
                  <Input value={m} onChange={(e) => setMaterials(materials.map((x, i) => i === idx ? e.target.value : x))} placeholder="https://" />
                  <Button type="button" size="icon" variant="ghost" onClick={() => setMaterials(materials.filter((_, i) => i !== idx))}>
                    <Trash2 size={16} />
                  </Button>
                </div>
              ))}
              <Button type="button" size="sm" variant="outline" onClick={() => setMaterials([...materials, ""])}>
                <Plus size={14} /> {t("profile.addMaterial")}
              </Button>
            </div>
          </div>
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <Button type="submit" size="lg" disabled={saving}>
          {saving ? t("common.loading") : t("common.save")}
        </Button>
      </div>
      </form>

      <PasswordCard />
    </div>
  );
}

function PasswordCard() {
  const { t } = useTranslation();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [saving, setSaving] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) {
      toast.error(t("profile.passwordMin", { defaultValue: "A senha deve ter ao menos 8 caracteres." }));
      return;
    }
    if (pw !== pw2) {
      toast.error(t("profile.passwordMismatch", { defaultValue: "As senhas não coincidem." }));
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;
      setPw("");
      setPw2("");
      toast.success(t("profile.passwordUpdated", { defaultValue: "Senha atualizada com sucesso." }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-6">
      <form onSubmit={onSubmit} className="space-y-4">
        <h2 className="text-lg font-semibold">{t("profile.security", { defaultValue: "Segurança" })}</h2>
        <p className="text-sm text-muted-foreground">
          {t("profile.changePasswordDesc", { defaultValue: "Defina uma nova senha para sua conta." })}
        </p>
        <div>
          <Label htmlFor="newPw">{t("profile.newPassword", { defaultValue: "Nova senha" })}</Label>
          <PasswordInput id="newPw" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} className="mt-1.5" minLength={8} required />
        </div>
        <div>
          <Label htmlFor="newPw2">{t("profile.confirmPassword", { defaultValue: "Confirmar nova senha" })}</Label>
          <PasswordInput id="newPw2" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} className="mt-1.5" minLength={8} required />
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? t("common.loading") : t("profile.updatePassword", { defaultValue: "Atualizar senha" })}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ChipsField({ label, value, onChange, taxonomyKey }: { label: string; value: string[]; onChange: (v: string[]) => void; taxonomyKey: "segments" | "services" | "destinations" | "buyer_types" }) {
  return (
    <div>
      <Label className="mb-2 block">{label}</Label>
      <MultiSelectChips taxonomyKey={taxonomyKey} value={value} onChange={onChange} />
    </div>
  );
}
