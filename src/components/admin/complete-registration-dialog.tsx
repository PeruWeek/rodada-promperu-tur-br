import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MultiSelectChips } from "@/components/multi-select-chips";
import {
  staffCompleteRegistration,
  staffGetRegistrationDetails,
  type RegistrationDetails,
} from "@/lib/staff-registration.functions";
import {
  REGISTRATION_FIELD_LABEL,
  computeMissing as computeMissingCentral,
} from "@/lib/registration-requirements";

const MISSING_LABEL = REGISTRATION_FIELD_LABEL;

function labelFor(field: string): string {
  return MISSING_LABEL[field] ?? field;
}

type FormState = {
  profile: NonNullable<RegistrationDetails["profile"]>;
  company: NonNullable<RegistrationDetails["company"]>;
  visitor: NonNullable<RegistrationDetails["visitor"]> | null;
  exhibitor: NonNullable<RegistrationDetails["exhibitor"]> | null;
};

export function CompleteRegistrationDialog({
  profileId,
  open,
  onOpenChange,
}: {
  profileId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const getFn = useServerFn(staffGetRegistrationDetails);
  const saveFn = useServerFn(staffCompleteRegistration);

  const detailsQ = useQuery({
    queryKey: ["staff-registration-details", profileId],
    queryFn: () => getFn({ data: { profileId: profileId! } }),
    enabled: !!profileId && open,
  });

  const [form, setForm] = useState<FormState | null>(null);

  useEffect(() => {
    if (detailsQ.data) {
      setForm({
        profile: { ...detailsQ.data.profile },
        company: { ...detailsQ.data.company },
        visitor: detailsQ.data.visitor ? { ...detailsQ.data.visitor } : null,
        exhibitor: detailsQ.data.exhibitor ? { ...detailsQ.data.exhibitor } : null,
      });
    }
  }, [detailsQ.data]);

  const details = detailsQ.data;

  const liveMissing = useMemo(() => {
    if (!details || !form) return details?.missing ?? [];
    // Recalcula com a MESMA regra do backend / RPC / trigger.
    return computeMissingCentral({
      kind: details.kind,
      profile: form.profile as Record<string, unknown>,
      company: form.company as Record<string, unknown>,
      visitor: form.visitor as Record<string, unknown> | null,
      exhibitor: form.exhibitor as Record<string, unknown> | null,
    });
  }, [details, form]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!form || !profileId) throw new Error("Nada para salvar.");
      return saveFn({
        data: {
          profileId,
          profile: form.profile,
          company: form.company,
          visitor: form.visitor ?? undefined,
          exhibitor: form.exhibitor ?? undefined,
        },
      });
    },
    onSuccess: (res) => {
      toast.success(
        res.status === "completo"
          ? "Cadastro marcado como completo."
          : `Cadastro salvo. Faltam ${res.missing.length} campo(s).`,
      );
      qc.invalidateQueries({ queryKey: ["registrants"] });
      qc.invalidateQueries({ queryKey: ["staff-registration-details", profileId] });
      if (res.status === "completo") onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isMissing = (key: string) => liveMissing.includes(key);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Completar cadastro</DialogTitle>
          <DialogDescription>
            Preencha os campos obrigatórios em nome do usuário. Somente Staff/Admin têm acesso a este modo.
          </DialogDescription>
        </DialogHeader>

        {detailsQ.isLoading || !form || !details ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={details.kind === "exhibitor" ? "default" : "secondary"}>
                {details.kind === "exhibitor" ? "Expositor" : "Visitante"}
              </Badge>
              {liveMissing.length === 0 ? (
                <Badge variant="outline" className="border-emerald-500 text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 size={12} className="mr-1" /> Cadastro completo
                </Badge>
              ) : (
                <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">
                  <AlertCircle size={12} className="mr-1" /> Cadastro incompleto · {liveMissing.length} pendente(s)
                </Badge>
              )}
              {details.profile.email && (
                <span className="text-xs text-muted-foreground">{details.profile.email}</span>
              )}
            </div>

            {liveMissing.length > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                <p className="font-medium">Campos pendentes:</p>
                <ul className="mt-1 list-inside list-disc">
                  {liveMissing.map((m) => (
                    <li key={m}>{labelFor(m)}</li>
                  ))}
                </ul>
              </div>
            )}

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Contato</h3>
              <Field label="Nome do contato *" missing={isMissing("profile.full_name")}>
                <Input
                  value={form.profile.full_name}
                  onChange={(e) =>
                    setForm({ ...form, profile: { ...form.profile, full_name: e.target.value } })
                  }
                />
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Cargo *" missing={isMissing("profile.job_title")}>
                  <Input
                    value={form.profile.job_title ?? ""}
                    onChange={(e) =>
                      setForm({ ...form, profile: { ...form.profile, job_title: e.target.value } })
                    }
                  />
                </Field>
                <Field label="WhatsApp *" missing={isMissing("profile.whatsapp")}>
                  <Input
                    value={form.profile.whatsapp ?? ""}
                    onChange={(e) =>
                      setForm({ ...form, profile: { ...form.profile, whatsapp: e.target.value } })
                    }
                  />
                </Field>
              </div>
              <Field label="Idioma preferido" missing={false}>
                <Select
                  value={form.profile.preferred_language}
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      profile: { ...form.profile, preferred_language: v as "pt-BR" | "es" },
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pt-BR">Português</SelectItem>
                    <SelectItem value="es">Español</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Empresa</h3>
              <Field label="Nome fantasia *" missing={isMissing("company.trade_name")}>
                <Input
                  value={form.company.trade_name}
                  onChange={(e) =>
                    setForm({ ...form, company: { ...form.company, trade_name: e.target.value } })
                  }
                />
              </Field>
              {details.kind === "visitor" && (
                <Field label="CNPJ *" missing={isMissing("company.tax_id")}>
                  <Input
                    value={form.company.tax_id ?? ""}
                    onChange={(e) =>
                      setForm({ ...form, company: { ...form.company, tax_id: e.target.value } })
                    }
                  />
                </Field>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Cidade *" missing={isMissing("company.city")}>
                  <Input
                    value={form.company.city ?? ""}
                    onChange={(e) =>
                      setForm({ ...form, company: { ...form.company, city: e.target.value } })
                    }
                  />
                </Field>
                {details.kind === "visitor" && (
                  <Field label="UF *" missing={isMissing("company.state_code")}>
                    <Input
                      maxLength={2}
                      value={form.company.state_code ?? ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          company: { ...form.company, state_code: e.target.value.toUpperCase() },
                        })
                      }
                    />
                  </Field>
                )}
              </div>
            </section>

            {details.kind === "visitor" && form.visitor && (
              <section className="space-y-3">
                <h3 className="text-sm font-semibold">Perfil de Visitante</h3>
                <Field label="Tipo de comprador">
                  <MultiSelectChips
                    taxonomyKey="buyer_types"
                    value={form.visitor.buyer_types}
                    onChange={(v) =>
                      setForm({ ...form, visitor: { ...form.visitor!, buyer_types: v } })
                    }
                  />
                </Field>
                <Field label="Segmentos de interesse">
                  <MultiSelectChips
                    taxonomyKey="segments"
                    value={form.visitor.interests_segments}
                    onChange={(v) =>
                      setForm({ ...form, visitor: { ...form.visitor!, interests_segments: v } })
                    }
                  />
                </Field>
                <Field
                  label="Participação no almoço networking *"
                  missing={isMissing("visitor.networking_lunch_participation")}
                >
                  <Select
                    value={
                      form.visitor.networking_lunch_participation === true
                        ? "yes"
                        : form.visitor.networking_lunch_participation === false
                          ? "no"
                          : ""
                    }
                    onValueChange={(v) =>
                      setForm({
                        ...form,
                        visitor: {
                          ...form.visitor!,
                          networking_lunch_participation: v === "yes" ? true : v === "no" ? false : null,
                        },
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yes">Sim</SelectItem>
                      <SelectItem value="no">Não</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  label="Autorização de uso de imagem *"
                  missing={isMissing("visitor.image_authorization")}
                >
                  <Select
                    value={
                      form.visitor.image_authorization === true
                        ? "yes"
                        : form.visitor.image_authorization === false
                          ? "no"
                          : ""
                    }
                    onValueChange={(v) =>
                      setForm({
                        ...form,
                        visitor: {
                          ...form.visitor!,
                          image_authorization: v === "yes" ? true : v === "no" ? false : null,
                        },
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yes">Sim, autorizo</SelectItem>
                      <SelectItem value="no">Não autorizo</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  label="Consentimento de compartilhamento de dados *"
                  missing={isMissing("visitor.consent_data_sharing")}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.visitor.consent_data_sharing}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          visitor: { ...form.visitor!, consent_data_sharing: e.target.checked },
                        })
                      }
                    />
                    <span className="text-xs text-muted-foreground">
                      O usuário autoriza o compartilhamento de seus dados com expositores do evento.
                    </span>
                  </div>
                </Field>
              </section>
            )}

            {details.kind === "exhibitor" && form.exhibitor && (
              <section className="space-y-3">
                <h3 className="text-sm font-semibold">Perfil de Expositor</h3>
                <Field label="Segmentos *" missing={isMissing("exhibitor.segments")}>
                  <MultiSelectChips
                    taxonomyKey="segments"
                    value={form.exhibitor.segments}
                    onChange={(v) =>
                      setForm({ ...form, exhibitor: { ...form.exhibitor!, segments: v } })
                    }
                  />
                </Field>
                <Field label="Serviços *" missing={isMissing("exhibitor.services")}>
                  <MultiSelectChips
                    taxonomyKey="services"
                    value={form.exhibitor.services}
                    onChange={(v) =>
                      setForm({ ...form, exhibitor: { ...form.exhibitor!, services: v } })
                    }
                  />
                </Field>
                <Field label="Destinos atendidos">
                  <MultiSelectChips
                    taxonomyKey="destinations"
                    value={form.exhibitor.destinations}
                    onChange={(v) =>
                      setForm({ ...form, exhibitor: { ...form.exhibitor!, destinations: v } })
                    }
                  />
                </Field>
              </section>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !form}>
            {saveMut.isPending ? t("common.loading") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  missing,
  children,
}: {
  label: string;
  missing?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label
        className={
          missing ? "text-amber-700 dark:text-amber-400" : undefined
        }
      >
        {label}
        {missing && <span className="ml-1 text-xs">(pendente)</span>}
      </Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}