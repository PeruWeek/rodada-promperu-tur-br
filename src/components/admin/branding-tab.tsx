/**
 * Admin > Configuração do site — edita cores, textos institucionais e
 * SEO do site white-label ativo. Persiste em `site_configs`; o frontend
 * reflete as mudanças ao próximo carregamento via SiteContext + CSS vars.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  getAdminSiteConfig,
  listAdminSiteConfigs,
  updateAdminSiteConfig,
} from "@/lib/site-branding.functions";
import {
  EDITABLE_CONTENT_KEYS,
  EDITABLE_LANGUAGES,
  THEME_TOKEN_KEYS,
} from "@/lib/site-theme";

type FormState = {
  name: string;
  tagline: string;
  footer_text: string;
  event_display_name: string;
  event_display_date: string;
  meta_description: string;
  og_image_url: string;
  logo_url: string;
  favicon_url: string;
  theme_tokens: Record<string, string>;
  content_overrides: Record<string, Record<string, string>>;
};

const COLOR_LABELS: Record<string, string> = {
  primary: "Primária",
  primaryForeground: "Texto sobre primária",
  secondary: "Secundária",
  secondaryForeground: "Texto sobre secundária",
  accent: "Destaque (accent)",
  accentForeground: "Texto sobre destaque",
  background: "Fundo principal",
  foreground: "Texto principal",
  card: "Cards / superfícies",
  cardForeground: "Texto em cards",
  muted: "Silenciada / bg suave",
  mutedForeground: "Texto silenciado",
  border: "Bordas",
  ring: "Anel de foco",
};

function emptyForm(): FormState {
  return {
    name: "",
    tagline: "",
    footer_text: "",
    event_display_name: "",
    event_display_date: "",
    meta_description: "",
    og_image_url: "",
    logo_url: "",
    favicon_url: "",
    theme_tokens: {},
    content_overrides: {},
  };
}

export function BrandingTab() {
  const { t: _t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(listAdminSiteConfigs);
  const getFn = useServerFn(getAdminSiteConfig);
  const updateFn = useServerFn(updateAdminSiteConfig);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const list = useQuery({ queryKey: ["admin-site-configs"], queryFn: () => listFn() });

  useEffect(() => {
    if (!selectedId && list.data && list.data.length > 0) {
      const def = list.data.find((s) => s.is_default) ?? list.data[0];
      setSelectedId(def.id);
    }
  }, [list.data, selectedId]);

  const detail = useQuery({
    queryKey: ["admin-site-config", selectedId],
    queryFn: () => getFn({ data: { id: selectedId! } }),
    enabled: !!selectedId,
  });

  const [form, setForm] = useState<FormState>(emptyForm);

  useEffect(() => {
    if (!detail.data) return;
    const d = detail.data;
    setForm({
      name: d.name ?? "",
      tagline: d.tagline ?? "",
      footer_text: d.footer_text ?? "",
      event_display_name: d.event_display_name ?? "",
      event_display_date: d.event_display_date ?? "",
      meta_description: d.meta_description ?? "",
      og_image_url: d.og_image_url ?? "",
      logo_url: d.logo_url ?? "",
      favicon_url: d.favicon_url ?? "",
      theme_tokens: (d.theme_tokens as Record<string, string> | null) ?? {},
      content_overrides:
        (d.content_overrides as Record<string, Record<string, string>> | null) ?? {},
    });
  }, [detail.data]);

  const mutation = useMutation({
    mutationFn: async (payload: FormState) => {
      if (!selectedId) throw new Error("Selecione um site");
      return updateFn({
        data: {
          id: selectedId,
          name: payload.name,
          tagline: payload.tagline || null,
          footer_text: payload.footer_text || null,
          event_display_name: payload.event_display_name || null,
          event_display_date: payload.event_display_date || null,
          meta_description: payload.meta_description || null,
          og_image_url: payload.og_image_url || null,
          logo_url: payload.logo_url || null,
          favicon_url: payload.favicon_url || null,
          theme_tokens: payload.theme_tokens,
          content_overrides: payload.content_overrides,
        },
      });
    },
    onSuccess: () => {
      toast.success("Configuração salva. Recarregue as páginas públicas para ver as mudanças.");
      qc.invalidateQueries({ queryKey: ["admin-site-config", selectedId] });
      qc.invalidateQueries({ queryKey: ["admin-site-configs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const setToken = (k: string, v: string) =>
    setForm((f) => ({ ...f, theme_tokens: { ...f.theme_tokens, [k]: v } }));
  const setOverride = (lng: string, key: string, v: string) =>
    setForm((f) => ({
      ...f,
      content_overrides: {
        ...f.content_overrides,
        [lng]: { ...(f.content_overrides[lng] ?? {}), [key]: v },
      },
    }));

  const sites = list.data ?? [];
  const selectedSite = useMemo(() => sites.find((s) => s.id === selectedId), [sites, selectedId]);

  if (list.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!sites.length) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Nenhum site cadastrado ainda. Crie um site white-label para personalizar o branding.
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[260px] flex-1">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Site</Label>
            <Select value={selectedId ?? undefined} onValueChange={(v) => setSelectedId(v)}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Selecionar site" />
              </SelectTrigger>
              <SelectContent>
                {sites.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} — {s.hostname}
                    {s.is_default ? " (padrão)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={() => mutation.mutate(form)}
            disabled={!selectedId || mutation.isPending}
          >
            {mutation.isPending ? "Salvando..." : "Salvar alterações"}
          </Button>
        </div>
        {selectedSite ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Editando: <span className="font-mono">{selectedSite.hostname}</span>. Alterações
            entram em vigor no próximo carregamento das páginas públicas.
          </p>
        ) : null}
      </Card>

      {detail.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <Tabs defaultValue="branding">
          <TabsList>
            <TabsTrigger value="branding">Branding visual</TabsTrigger>
            <TabsTrigger value="content">Textos do frontend</TabsTrigger>
            <TabsTrigger value="seo">SEO & Meta</TabsTrigger>
          </TabsList>

          <TabsContent value="branding" className="mt-4 space-y-6">
            <Card className="p-5">
              <h3 className="text-lg font-semibold">Identidade</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Nome público, tagline, logo e favicon usados em todo o site.
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <FormField label="Nome público">
                  <Input value={form.name} onChange={(e) => setField("name", e.target.value)} />
                </FormField>
                <FormField label="Tagline">
                  <Input value={form.tagline} onChange={(e) => setField("tagline", e.target.value)} />
                </FormField>
                <FormField label="Nome de exibição do evento">
                  <Input
                    value={form.event_display_name}
                    onChange={(e) => setField("event_display_name", e.target.value)}
                  />
                </FormField>
                <FormField label="Data de exibição do evento">
                  <Input
                    value={form.event_display_date}
                    onChange={(e) => setField("event_display_date", e.target.value)}
                    placeholder="ex: 08 de julho de 2026"
                  />
                </FormField>
                <FormField label="URL do logo">
                  <Input value={form.logo_url} onChange={(e) => setField("logo_url", e.target.value)} />
                </FormField>
                <FormField label="URL do favicon">
                  <Input value={form.favicon_url} onChange={(e) => setField("favicon_url", e.target.value)} />
                </FormField>
                <FormField label="Texto do footer" className="md:col-span-2">
                  <Textarea
                    rows={2}
                    value={form.footer_text}
                    onChange={(e) => setField("footer_text", e.target.value)}
                  />
                </FormField>
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="text-lg font-semibold">Paleta de cores</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Deixe em branco para usar o valor padrão do design system. Aceita hex
                (#RRGGBB), rgb(), hsl() ou oklch().
              </p>
              <Separator className="my-4" />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {THEME_TOKEN_KEYS.map((k) => {
                  const val = form.theme_tokens[k] ?? "";
                  const isHex = /^#[0-9a-fA-F]{3,8}$/.test(val);
                  return (
                    <div key={k} className="rounded-md border border-border p-3">
                      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {COLOR_LABELS[k] ?? k}
                      </Label>
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          type="color"
                          value={isHex ? val : "#ffffff"}
                          onChange={(e) => setToken(k, e.target.value)}
                          className="h-9 w-12 cursor-pointer rounded border border-border bg-background"
                          aria-label={`Escolher cor: ${k}`}
                        />
                        <Input
                          value={val}
                          onChange={(e) => setToken(k, e.target.value)}
                          placeholder="#RRGGBB"
                          className="font-mono text-sm"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="content" className="mt-4 space-y-6">
            <Card className="p-5">
              <h3 className="text-lg font-semibold">Textos institucionais</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Substitui as strings da landing, login e signup por idioma. Deixe em branco
                para usar o texto padrão traduzido do produto.
              </p>
              {EDITABLE_LANGUAGES.map((lng) => (
                <div key={lng.code} className="mt-6">
                  <h4 className="text-sm font-bold uppercase tracking-wider text-primary">
                    {lng.label} ({lng.code})
                  </h4>
                  <div className="mt-3 grid gap-3">
                    {EDITABLE_CONTENT_KEYS.map((entry) => {
                      const cur = form.content_overrides[lng.code]?.[entry.key] ?? "";
                      return (
                        <FormField key={entry.key} label={entry.label} hint={entry.key}>
                          {entry.multiline ? (
                            <Textarea
                              rows={2}
                              value={cur}
                              onChange={(e) => setOverride(lng.code, entry.key, e.target.value)}
                            />
                          ) : (
                            <Input
                              value={cur}
                              onChange={(e) => setOverride(lng.code, entry.key, e.target.value)}
                            />
                          )}
                        </FormField>
                      );
                    })}
                  </div>
                </div>
              ))}
            </Card>
          </TabsContent>

          <TabsContent value="seo" className="mt-4 space-y-6">
            <Card className="p-5">
              <h3 className="text-lg font-semibold">SEO & Meta</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Título/descrição herdam do nome + tagline. Ajuste aqui para reforçar palavras-chave.
              </p>
              <div className="mt-4 grid gap-4">
                <FormField label="Meta description">
                  <Textarea
                    rows={3}
                    value={form.meta_description}
                    onChange={(e) => setField("meta_description", e.target.value)}
                  />
                </FormField>
                <FormField label="OG image (URL 1200×630)">
                  <Input
                    value={form.og_image_url}
                    onChange={(e) => setField("og_image_url", e.target.value)}
                  />
                </FormField>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function FormField({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      {hint ? <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">{hint}</div> : null}
      <div className="mt-1">{children}</div>
    </div>
  );
}