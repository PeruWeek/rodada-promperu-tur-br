import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

import { getCompanyForEdit, updateCompanyFull } from "@/lib/admin.functions";
import { COUNTRIES } from "@/lib/taxonomy";
import { MultiSelectChips } from "@/components/multi-select-chips";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";

type Props = {
  companyId: string;
  onClose: () => void;
  onSaved: () => void;
};

type CompanyForm = {
  trade_name: string;
  legal_name: string;
  tax_id: string;
  registration_id: string;
  country_code: string;
  state_code: string;
  city: string;
  address: string;
  website: string;
  instagram: string;
  linkedin: string;
  general_phone: string;
  whatsapp: string;
  specialty: string;
  import_profile: string;
};

type ProfileForm = {
  full_name: string;
  job_title: string;
  whatsapp: string;
  preferred_language: "pt-BR" | "es";
};

type VisitorForm = {
  buyer_types: string[];
  interests_segments: string[];
  interests_destinations: string[];
  interests_destinations_free: string;
  interests_services: string[];
  portfolio_pt: string;
  notes: string;
  consent_marketing: boolean;
};

type ExhibitorForm = {
  segments: string[];
  destinations: string[];
  services: string[];
  target_buyers: string[];
  pitch_pt: string;
  pitch_es: string;
  portfolio_pt: string;
  portfolio_es: string;
  materials_links: string[];
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function strArr(v: unknown): string[] {
  return Array.isArray(v) ? (v.filter((x) => typeof x === "string") as string[]) : [];
}
function bool(v: unknown): boolean {
  return v === true;
}

export function EditCompanyDrawer({ companyId, onClose, onSaved }: Props) {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language === "es" ? "es" : "pt") as "pt" | "es";
  const fetchFn = useServerFn(getCompanyForEdit);
  const saveFn = useServerFn(updateCompanyFull);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-company-edit", companyId],
    queryFn: () => fetchFn({ data: { companyId } }),
  });

  const [company, setCompany] = useState<CompanyForm | null>(null);
  const [profile, setProfile] = useState<ProfileForm | null>(null);
  const [visitor, setVisitor] = useState<VisitorForm | null>(null);
  const [exhibitor, setExhibitor] = useState<ExhibitorForm | null>(null);

  useEffect(() => {
    if (!data) return;
    const c = data.company as Record<string, unknown>;
    setCompany({
      trade_name: str(c.trade_name),
      legal_name: str(c.legal_name),
      tax_id: str(c.tax_id),
      registration_id: str(c.registration_id),
      country_code: str(c.country_code) || "BR",
      state_code: str(c.state_code),
      city: str(c.city),
      address: str(c.address),
      website: str(c.website),
      instagram: str(c.instagram),
      linkedin: str(c.linkedin),
      general_phone: str(c.general_phone),
      whatsapp: str(c.whatsapp),
      specialty: str(c.specialty),
      import_profile: str(c.import_profile),
    });
    const p = data.primaryProfile as Record<string, unknown> | null;
    if (p) {
      const langVal = str(p.preferred_language);
      setProfile({
        full_name: str(p.full_name),
        job_title: str(p.job_title),
        whatsapp: str(p.whatsapp),
        preferred_language: langVal === "es" ? "es" : "pt-BR",
      });
    }
    if (data.role !== "exhibitor") {
      const v = (data.visitorProfile ?? {}) as Record<string, unknown>;
      setVisitor({
        buyer_types: strArr(v.buyer_types).length > 0
          ? strArr(v.buyer_types)
          : (str(v.buyer_type) ? [str(v.buyer_type)] : []),
        interests_segments: strArr(v.interests_segments),
        interests_destinations: strArr(v.interests_destinations),
        interests_destinations_free: str(v.interests_destinations_free),
        interests_services: strArr(v.interests_services),
        portfolio_pt: str(v.portfolio_pt),
        notes: str(v.notes),
        consent_marketing: bool(v.consent_marketing),
      });
    } else {
      const e = (data.exhibitorProfile ?? {}) as Record<string, unknown>;
      setExhibitor({
        segments: strArr(e.segments),
        destinations: strArr(e.destinations),
        services: strArr(e.services),
        target_buyers: strArr(e.target_buyers),
        pitch_pt: str(e.pitch_pt),
        pitch_es: str(e.pitch_es),
        portfolio_pt: str(e.portfolio_pt),
        portfolio_es: str(e.portfolio_es),
        materials_links: strArr(e.materials_links),
      });
    }
  }, [data]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!company) throw new Error("no data");
      // Required-field parity with the buyer signup wizard.
      const isBR = (company.country_code || "BR") === "BR";
      const missing: string[] = [];
      if (!company.trade_name.trim()) missing.push(t("signup.tradeName"));
      if (isBR && !company.tax_id.trim()) missing.push(t("signup.taxId"));
      if (!company.city.trim()) missing.push(t("signup.city"));
      if (isBR && !company.state_code.trim()) missing.push(t("signup.state"));
      if (missing.length) {
        throw new Error(`${t("signup.errors.required")} ${missing.join(", ")}`);
      }
      return saveFn({
        data: {
          companyId,
          profileId: (data?.primaryProfile as { id?: string } | null)?.id ?? null,
          company,
          profile: profile ?? null,
          visitor: data?.role !== "exhibitor" ? visitor : null,
          exhibitor: data?.role === "exhibitor" ? exhibitor : null,
        },
      });
    },
    onSuccess: () => {
      toast.success(t("admin.companies.saved"));
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{company?.trade_name || t("admin.companies.edit")}</SheetTitle>
          <SheetDescription>
            {data?.role === "exhibitor"
              ? t("admin.companies.roleExhibitor")
              : data?.role === "cliente"
                ? t("admin.companies.roleCliente")
                : t("admin.companies.roleVisitor")}
          </SheetDescription>
        </SheetHeader>

        {isLoading || !company ? (
          <div className="mt-6 space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : (
          <Tabs defaultValue="company" className="mt-4">
            <TabsList className="flex flex-wrap h-auto">
              <TabsTrigger value="company">{t("admin.companies.tabCompany")}</TabsTrigger>
              <TabsTrigger value="contact" disabled={!profile}>
                {t("admin.companies.tabContact")}
              </TabsTrigger>
              {data?.role !== "exhibitor" ? (
                <TabsTrigger value="visitor" disabled={!visitor}>
                  {t("admin.companies.tabVisitor")}
                </TabsTrigger>
              ) : (
                <TabsTrigger value="exhibitor" disabled={!exhibitor}>
                  {t("admin.companies.tabExhibitor")}
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="company" className="mt-4 space-y-4">
              <Field label={t("signup.tradeName")} required>
                <Input value={company.trade_name} onChange={(e) => setCompany({ ...company, trade_name: e.target.value })} />
              </Field>
              <Field label={t("signup.registrationId")}>
                <Input
                  value={company.registration_id}
                  onChange={(e) => setCompany({ ...company, registration_id: e.target.value })}
                  placeholder={t("signup.registrationIdHelp")}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("signup.legalName")}>
                  <Input value={company.legal_name} onChange={(e) => setCompany({ ...company, legal_name: e.target.value })} />
                </Field>
                <Field label={t("signup.taxId")} required={(company.country_code || "BR") === "BR"}>
                  <Input value={company.tax_id} onChange={(e) => setCompany({ ...company, tax_id: e.target.value })} />
                </Field>
                <Field label={t("onboarding.country")}>
                  <select
                    value={company.country_code}
                    onChange={(e) => setCompany({ ...company, country_code: e.target.value })}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {lang === "es" ? c.es : c.pt}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("signup.state")} required={(company.country_code || "BR") === "BR"}>
                  <Input value={company.state_code} onChange={(e) => setCompany({ ...company, state_code: e.target.value.toUpperCase() })} maxLength={3} />
                </Field>
                <Field label={t("signup.city")} required>
                  <Input value={company.city} onChange={(e) => setCompany({ ...company, city: e.target.value })} />
                </Field>
                <Field label={t("signup.address")}>
                  <Input value={company.address} onChange={(e) => setCompany({ ...company, address: e.target.value })} />
                </Field>
                <Field label={t("signup.website")}>
                  <Input value={company.website} onChange={(e) => setCompany({ ...company, website: e.target.value })} placeholder="https://" />
                </Field>
                <Field label="Instagram">
                  <Input value={company.instagram} onChange={(e) => setCompany({ ...company, instagram: e.target.value })} />
                </Field>
                <Field label="LinkedIn">
                  <Input value={company.linkedin} onChange={(e) => setCompany({ ...company, linkedin: e.target.value })} />
                </Field>
                <Field label={t("signup.generalPhone")}>
                  <Input value={company.general_phone} onChange={(e) => setCompany({ ...company, general_phone: e.target.value })} />
                </Field>
                <Field label={t("signup.specialty")}>
                  <Input value={company.specialty} onChange={(e) => setCompany({ ...company, specialty: e.target.value })} />
                </Field>
              </div>
              <Field label={t("signup.importProfile")}>
                <Textarea
                  value={company.import_profile}
                  onChange={(e) => setCompany({ ...company, import_profile: e.target.value })}
                  rows={3}
                />
              </Field>
            </TabsContent>

            {profile && (
              <TabsContent value="contact" className="mt-4 space-y-4">
                <Field label={t("auth.fullName")} required>
                  <Input value={profile.full_name} onChange={(e) => setProfile({ ...profile, full_name: e.target.value })} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("signup.jobTitle")}>
                    <Input value={profile.job_title} onChange={(e) => setProfile({ ...profile, job_title: e.target.value })} />
                  </Field>
                  <Field label="WhatsApp">
                    <Input value={profile.whatsapp} onChange={(e) => setProfile({ ...profile, whatsapp: e.target.value })} />
                  </Field>
                  <Field label={t("signup.preferredLanguage")}>
                    <select
                      value={profile.preferred_language}
                      onChange={(e) => setProfile({ ...profile, preferred_language: e.target.value as "pt-BR" | "es" })}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="pt-BR">Português (BR)</option>
                      <option value="es">Español</option>
                    </select>
                  </Field>
                </div>
              </TabsContent>
            )}

            {visitor && (
              <TabsContent value="visitor" className="mt-4 space-y-4">
                <Field label={t("profile.buyerType")}>
                  <MultiSelectChips
                    taxonomyKey="buyer_types"
                    value={visitor.buyer_types}
                    onChange={(v) => setVisitor({ ...visitor, buyer_types: v })}
                  />
                </Field>
                <Field label={t("profile.interestsSegments")}>
                  <MultiSelectChips
                    taxonomyKey="segments"
                    value={visitor.interests_segments}
                    onChange={(v) => setVisitor({ ...visitor, interests_segments: v })}
                  />
                </Field>
                <Field label={t("profile.interestsServices")}>
                  <MultiSelectChips
                    taxonomyKey="services"
                    value={visitor.interests_services}
                    onChange={(v) => setVisitor({ ...visitor, interests_services: v })}
                  />
                </Field>
                <Field label={t("profile.interestsDestinations")}>
                  <MultiSelectChips
                    taxonomyKey="destinations"
                    value={visitor.interests_destinations}
                    onChange={(v) => setVisitor({ ...visitor, interests_destinations: v })}
                  />
                </Field>
                <Field label={t("signup.destinationsFreePlaceholder")}>
                  <Input
                    value={visitor.interests_destinations_free}
                    onChange={(e) => setVisitor({ ...visitor, interests_destinations_free: e.target.value })}
                  />
                </Field>
                <Field label={t("profile.portfolioPt")}>
                  <Textarea
                    rows={4}
                    value={visitor.portfolio_pt}
                    onChange={(e) => setVisitor({ ...visitor, portfolio_pt: e.target.value })}
                  />
                </Field>
                <Field label={t("profile.notes")}>
                  <Textarea
                    value={visitor.notes}
                    onChange={(e) => setVisitor({ ...visitor, notes: e.target.value })}
                    rows={3}
                  />
                </Field>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={visitor.consent_marketing}
                    onCheckedChange={(c) => setVisitor({ ...visitor, consent_marketing: c })}
                  />
                  <span className="text-sm">{t("signup.consentMarketing")}</span>
                </div>
              </TabsContent>
            )}

            {exhibitor && (
              <TabsContent value="exhibitor" className="mt-4 space-y-4">
                <Field label={t("profile.segments")}>
                  <MultiSelectChips
                    taxonomyKey="segments"
                    value={exhibitor.segments}
                    onChange={(v) => setExhibitor({ ...exhibitor, segments: v })}
                  />
                </Field>
                <Field label={t("profile.services")}>
                  <MultiSelectChips
                    taxonomyKey="services"
                    value={exhibitor.services}
                    onChange={(v) => setExhibitor({ ...exhibitor, services: v })}
                  />
                </Field>
                <Field label={t("profile.destinations")}>
                  <MultiSelectChips
                    taxonomyKey="destinations"
                    value={exhibitor.destinations}
                    onChange={(v) => setExhibitor({ ...exhibitor, destinations: v })}
                  />
                </Field>
                <Field label={t("profile.targetBuyers")}>
                  <MultiSelectChips
                    taxonomyKey="buyer_types"
                    value={exhibitor.target_buyers}
                    onChange={(v) => setExhibitor({ ...exhibitor, target_buyers: v })}
                  />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("profile.pitchPt")}>
                    <Textarea
                      rows={4}
                      value={exhibitor.pitch_pt}
                      onChange={(e) => setExhibitor({ ...exhibitor, pitch_pt: e.target.value })}
                    />
                  </Field>
                  <Field label={t("profile.pitchEs")}>
                    <Textarea
                      rows={4}
                      value={exhibitor.pitch_es}
                      onChange={(e) => setExhibitor({ ...exhibitor, pitch_es: e.target.value })}
                    />
                  </Field>
                  <Field label={t("profile.portfolioPt")}>
                    <Textarea
                      rows={4}
                      value={exhibitor.portfolio_pt}
                      onChange={(e) => setExhibitor({ ...exhibitor, portfolio_pt: e.target.value })}
                    />
                  </Field>
                  <Field label={t("profile.portfolioEs")}>
                    <Textarea
                      rows={4}
                      value={exhibitor.portfolio_es}
                      onChange={(e) => setExhibitor({ ...exhibitor, portfolio_es: e.target.value })}
                    />
                  </Field>
                </div>
                <Field label={t("profile.materials")}>
                  <div className="space-y-2">
                    {exhibitor.materials_links.map((m, idx) => (
                      <div key={idx} className="flex gap-2">
                        <Input
                          value={m}
                          onChange={(e) =>
                            setExhibitor({
                              ...exhibitor,
                              materials_links: exhibitor.materials_links.map((x, i) => (i === idx ? e.target.value : x)),
                            })
                          }
                          placeholder="https://"
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() =>
                            setExhibitor({
                              ...exhibitor,
                              materials_links: exhibitor.materials_links.filter((_, i) => i !== idx),
                            })
                          }
                        >
                          <Trash2 size={16} />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setExhibitor({ ...exhibitor, materials_links: [...exhibitor.materials_links, ""] })
                      }
                    >
                      <Plus size={14} /> {t("profile.addMaterial")}
                    </Button>
                  </div>
                </Field>
              </TabsContent>
            )}
          </Tabs>
        )}

        <SheetFooter className="mt-6 flex-row justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saveMut.isPending}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !company}>
            {saveMut.isPending ? t("common.loading") : t("common.save")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">
        {label}
        {required ? " *" : ""}
      </Label>
      {children}
    </div>
  );
}