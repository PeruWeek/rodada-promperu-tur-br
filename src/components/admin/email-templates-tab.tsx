import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";

import {
  listEmailTemplates,
  resetEmailTemplateField,
  updateEmailTemplate,
} from "@/lib/email-templates.functions";
import type { OverrideField } from "@/lib/email-templates/copy-defaults";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";

type Lang = "pt" | "es";
type FormState = Record<OverrideField, string>;

const EMPTY: FormState = {
  from_name: "",
  subject_pt: "", subject_es: "",
  greeting_pt: "", greeting_es: "",
  intro_pt: "", intro_es: "",
  outro_pt: "", outro_es: "",
  cta_label_pt: "", cta_label_es: "",
  signature_pt: "", signature_es: "",
};

const FIELD_LABELS: Record<string, string> = {
  subject: "Assunto",
  greeting: "Saudação",
  intro: "Parágrafo de abertura",
  outro: "Parágrafo de fechamento",
  cta_label: "Rótulo do botão",
  signature: "Assinatura / rodapé",
};

const BODY_FIELDS: Array<{ key: "greeting" | "intro" | "outro" | "cta_label" | "signature"; lines: number }> = [
  { key: "greeting", lines: 1 },
  { key: "intro", lines: 3 },
  { key: "outro", lines: 3 },
  { key: "cta_label", lines: 1 },
  { key: "signature", lines: 2 },
];

export function EmailTemplatesTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listEmailTemplates);
  const updateFn = useServerFn(updateEmailTemplate);
  const resetFn = useServerFn(resetEmailTemplateField);

  const { data, isLoading } = useQuery({
    queryKey: ["email-templates"],
    queryFn: () => listFn({ data: undefined as never }),
  });

  if (isLoading) {
    return (
      <Card className="p-4 space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Modelos de e-mail</h2>
        <p className="text-sm text-muted-foreground">
          Edite assunto, nome do remetente e textos do corpo. O layout (cores, logo, estrutura) permanece o mesmo.
          Use <code className="text-xs">{"{{visitorName}}"}</code> e variáveis similares para inserir dados dinâmicos.
        </p>
      </div>

      <Accordion type="single" collapsible className="w-full">
        {(data?.templates ?? []).map((t) => (
          <TemplateEditor
            key={t.templateName}
            template={t as never}
            defaultFromName={data!.defaultFromName}
            onSave={async (fields) => {
              await updateFn({ data: { templateName: t.templateName, fields } });
              toast.success("Template atualizado");
              qc.invalidateQueries({ queryKey: ["email-templates"] });
            }}
            onReset={async (field) => {
              await resetFn({ data: { templateName: t.templateName, field } });
              toast.success("Campo restaurado");
              qc.invalidateQueries({ queryKey: ["email-templates"] });
            }}
          />
        ))}
      </Accordion>
    </Card>
  );
}

interface TemplateProp {
  templateName: string;
  displayName: string;
  placeholders: string[];
  defaults: {
    fromName: string;
    subject: { "pt-BR": string; es: string };
    copy: Record<
      "pt-BR" | "es",
      { greeting: string; intro: string; outro: string; ctaLabel: string; signature: string }
    >;
  };
  override: Record<string, string | null> | null;
}

function TemplateEditor({
  template,
  defaultFromName,
  onSave,
  onReset,
}: {
  template: TemplateProp;
  defaultFromName: string;
  onSave: (fields: Partial<Record<OverrideField, string | null>>) => Promise<void>;
  onReset: (field: OverrideField) => Promise<void>;
}) {
  const [lang, setLang] = useState<Lang>("pt");
  const [form, setForm] = useState<FormState>(EMPTY);

  useEffect(() => {
    const o = template.override ?? {};
    setForm({
      from_name: o.from_name ?? "",
      subject_pt: o.subject_pt ?? "", subject_es: o.subject_es ?? "",
      greeting_pt: o.greeting_pt ?? "", greeting_es: o.greeting_es ?? "",
      intro_pt: o.intro_pt ?? "", intro_es: o.intro_es ?? "",
      outro_pt: o.outro_pt ?? "", outro_es: o.outro_es ?? "",
      cta_label_pt: o.cta_label_pt ?? "", cta_label_es: o.cta_label_es ?? "",
      signature_pt: o.signature_pt ?? "", signature_es: o.signature_es ?? "",
    });
  }, [template.override]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const patch: Partial<Record<OverrideField, string | null>> = {};
      (Object.keys(form) as OverrideField[]).forEach((k) => {
        patch[k] = form[k].trim() === "" ? null : form[k];
      });
      await onSave(patch);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetMut = useMutation({
    mutationFn: (field: OverrideField) => onReset(field),
    onError: (e: Error) => toast.error(e.message),
  });

  const langKey = lang === "pt" ? "pt-BR" : "es";
  const suffix = lang === "pt" ? "_pt" : "_es";
  const defaults = template.defaults.copy[langKey];
  const subjectDefault = template.defaults.subject[langKey];

  const isCustom = (field: OverrideField) => (template.override?.[field] ?? null) !== null;

  const copyPlaceholder = (name: string) => {
    navigator.clipboard.writeText(`{{${name}}}`).then(
      () => toast.success(`{{${name}}} copiado`),
      () => toast.error("Falha ao copiar"),
    );
  };

  return (
    <AccordionItem value={template.templateName}>
      <AccordionTrigger>
        <div className="flex items-center gap-2">
          <span className="font-medium">{template.displayName}</span>
          {template.override && (
            <Badge variant="secondary" className="text-xs">Personalizado</Badge>
          )}
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <div className="space-y-4 pt-2">
          <div className="grid gap-3 sm:grid-cols-[1fr,auto] sm:items-end">
            <FieldRow
              label="Nome do remetente"
              field="from_name"
              value={form.from_name}
              defaultValue={defaultFromName}
              onChange={(v) => setForm((s) => ({ ...s, from_name: v }))}
              isCustom={isCustom("from_name")}
              onReset={() => resetMut.mutate("from_name")}
              singleLine
            />
          </div>

          <Tabs value={lang} onValueChange={(v) => setLang(v as Lang)}>
            <TabsList>
              <TabsTrigger value="pt">Português</TabsTrigger>
              <TabsTrigger value="es">Español</TabsTrigger>
            </TabsList>

            <TabsContent value={lang} className="mt-3 space-y-3">
              <FieldRow
                label={FIELD_LABELS.subject}
                field={("subject" + suffix) as OverrideField}
                value={form[("subject" + suffix) as OverrideField]}
                defaultValue={subjectDefault}
                onChange={(v) => setForm((s) => ({ ...s, [("subject" + suffix) as OverrideField]: v }))}
                isCustom={isCustom(("subject" + suffix) as OverrideField)}
                onReset={() => resetMut.mutate(("subject" + suffix) as OverrideField)}
                singleLine
              />
              {BODY_FIELDS.map(({ key, lines }) => {
                const field = (key + suffix) as OverrideField;
                const def =
                  key === "cta_label"
                    ? defaults.ctaLabel
                    : (defaults as any)[key];
                return (
                  <FieldRow
                    key={field}
                    label={FIELD_LABELS[key]}
                    field={field}
                    value={form[field]}
                    defaultValue={def}
                    onChange={(v) => setForm((s) => ({ ...s, [field]: v }))}
                    isCustom={isCustom(field)}
                    onReset={() => resetMut.mutate(field)}
                    lines={lines}
                  />
                );
              })}
            </TabsContent>
          </Tabs>

          {template.placeholders.length > 0 && (
            <div className="rounded-md border border-dashed p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Variáveis disponíveis</p>
              <div className="flex flex-wrap gap-2">
                {template.placeholders.map((p) => (
                  <Button
                    key={p}
                    size="sm"
                    variant="outline"
                    type="button"
                    onClick={() => copyPlaceholder(p)}
                  >
                    <Copy className="h-3 w-3 mr-1" />
                    {`{{${p}}}`}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              <Save className="h-4 w-4 mr-1" />
              {saveMut.isPending ? "Salvando..." : "Salvar alterações"}
            </Button>
          </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

function FieldRow({
  label,
  field,
  value,
  defaultValue,
  onChange,
  isCustom,
  onReset,
  lines = 1,
  singleLine,
}: {
  label: string;
  field: OverrideField;
  value: string;
  defaultValue: string;
  onChange: (v: string) => void;
  isCustom: boolean;
  onReset: () => void;
  lines?: number;
  singleLine?: boolean;
}) {
  const placeholder = useMemo(() => `Padrão: ${defaultValue}`, [defaultValue]);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-sm">
          {label}
          {isCustom ? (
            <Badge variant="secondary" className="ml-2 text-[10px]">Personalizado</Badge>
          ) : (
            <Badge variant="outline" className="ml-2 text-[10px]">Padrão</Badge>
          )}
        </Label>
        {isCustom && (
          <Button size="sm" variant="ghost" type="button" onClick={onReset}>
            <RotateCcw className="h-3 w-3 mr-1" /> Restaurar
          </Button>
        )}
      </div>
      {singleLine || lines === 1 ? (
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} maxLength={1000} />
      ) : (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={lines}
          maxLength={2000}
        />
      )}
    </div>
  );
}