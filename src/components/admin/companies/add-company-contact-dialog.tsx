import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { toast } from "sonner";

import {
  addCompanyContact,
  findCompanyForContact,
} from "@/lib/company-contacts.functions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Candidate = {
  id: string;
  trade_name: string;
  legal_name: string | null;
  tax_id: string | null;
  city: string | null;
  state_code: string | null;
};

export function AddCompanyContactDialog({
  open,
  onClose,
  onSuccess,
  initialCompany,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  initialCompany?: Candidate | null;
}) {
  const { t } = useTranslation();
  const findFn = useServerFn(findCompanyForContact);
  const addFn = useServerFn(addCompanyContact);

  const [q, setQ] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [company, setCompany] = useState<Candidate | null>(initialCompany ?? null);

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [lang, setLang] = useState<"pt-BR" | "es">("pt-BR");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setQ("");
    setResults([]);
    setCompany(initialCompany ?? null);
    setEmail("");
    setFullName("");
    setJobTitle("");
    setWhatsapp("");
    setLang("pt-BR");
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const doSearch = async () => {
    if (q.trim().length < 1) return;
    setSearching(true);
    try {
      const r = await findFn({ data: { query: q.trim(), limit: 10 } });
      setResults((r.rows ?? []) as Candidate[]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const mapError = (msg: string): string => {
    switch (msg) {
      case "email_already_active":
        return t("admin.companies.contactDialog.errors.emailActive", {
          defaultValue: "Este e-mail já está vinculado a uma conta ativa.",
        });
      case "email_linked_to_other_company":
        return t("admin.companies.contactDialog.errors.emailOtherCompany", {
          defaultValue: "Este e-mail já está vinculado a outra empresa.",
        });
      case "company_not_found":
        return t("admin.companies.contactDialog.errors.companyNotFound", {
          defaultValue: "Empresa não encontrada.",
        });
      default:
        return msg;
    }
  };

  const submit = async () => {
    if (!company) {
      toast.error(
        t("admin.companies.contactDialog.errors.selectCompany", {
          defaultValue: "Selecione uma empresa.",
        }),
      );
      return;
    }
    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error(
        t("admin.companies.contactDialog.errors.invalidEmail", {
          defaultValue: "Informe um e-mail válido.",
        }),
      );
      return;
    }
    setSubmitting(true);
    try {
      const res = await addFn({
        data: {
          company_id: company.id,
          email: trimmed,
          full_name: fullName.trim() || undefined,
          job_title: jobTitle.trim() || undefined,
          whatsapp: whatsapp.trim() || undefined,
          preferred_language: lang,
        },
      });
      if (res.invite_sent) {
        toast.success(
          t("admin.companies.contactDialog.success", {
            defaultValue: "Convite enviado.",
          }),
        );
      } else {
        toast.warning(
          t("admin.companies.contactDialog.savedNoEmail", {
            defaultValue:
              "Contato salvo, mas o convite não foi enviado. Verifique os logs de e-mail.",
          }),
        );
      }
      reset();
      onSuccess?.();
      onClose();
    } catch (e) {
      toast.error(mapError((e as Error).message));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("admin.companies.contactDialog.title", {
              defaultValue: "Adicionar contato à empresa",
            })}
          </DialogTitle>
          <DialogDescription>
            {t("admin.companies.contactDialog.description", {
              defaultValue:
                "O contato receberá um convite por e-mail para concluir o cadastro e ficará vinculado à empresa.",
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!initialCompany && (
            <div>
              <Label>
                {t("admin.companies.contactDialog.searchLabel", {
                  defaultValue: "Empresa (CNPJ, nome fantasia ou razão social)",
                })}
              </Label>
              <div className="mt-1.5 flex gap-2">
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); doSearch(); } }}
                  placeholder="00.000.000/0000-00 ou nome"
                />
                <Button type="button" variant="outline" onClick={doSearch} disabled={searching}>
                  <Search size={14} />
                </Button>
              </div>
              {results.length > 0 && !company && (
                <div className="mt-2 max-h-40 space-y-1 overflow-auto rounded-md border border-border p-2">
                  {results.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setCompany(r)}
                      className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                    >
                      <div className="font-medium">{r.trade_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {[r.tax_id, r.city, r.state_code].filter(Boolean).join(" · ")}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {company && (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              <div className="font-medium">{company.trade_name}</div>
              <div className="text-xs text-muted-foreground">
                {[company.tax_id, company.city, company.state_code].filter(Boolean).join(" · ")}
              </div>
              {!initialCompany && (
                <button
                  type="button"
                  className="mt-1 text-xs text-primary underline"
                  onClick={() => setCompany(null)}
                >
                  {t("common.change", { defaultValue: "Trocar" })}
                </button>
              )}
            </div>
          )}

          <div>
            <Label htmlFor="cc-email">
              {t("admin.companies.contactDialog.email", { defaultValue: "E-mail" })} *
            </Label>
            <Input
              id="cc-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="cc-name">
                {t("admin.companies.contactDialog.fullName", { defaultValue: "Nome completo" })}
              </Label>
              <Input id="cc-name" value={fullName} onChange={(e) => setFullName(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="cc-job">
                {t("admin.companies.contactDialog.jobTitle", { defaultValue: "Cargo" })}
              </Label>
              <Input id="cc-job" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="cc-wa">WhatsApp</Label>
              <Input id="cc-wa" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label>
                {t("admin.companies.contactDialog.language", { defaultValue: "Idioma" })}
              </Label>
              <Select value={lang} onValueChange={(v) => setLang(v as "pt-BR" | "es")}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pt-BR">Português (BR)</SelectItem>
                  <SelectItem value="es">Español</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={submitting}>
            {t("common.cancel", { defaultValue: "Cancelar" })}
          </Button>
          <Button onClick={submit} disabled={submitting || !company || !email.trim()}>
            {submitting
              ? t("common.loading", { defaultValue: "Enviando..." })
              : t("admin.companies.contactDialog.submit", { defaultValue: "Enviar convite" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}