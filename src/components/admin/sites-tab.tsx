/**
 * Admin > Sites & URLs — CRUD for `site_configs`. Lets an admin create
 * new white-label sites, edit hostname / alt hostnames / site_url, bind
 * a site to an existing event (`active_event_id`), and mark the default
 * fallback site. Branding (colors, copy, SEO) stays in `BrandingTab`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  createAdminSiteConfig,
  deleteAdminSiteConfig,
  listAdminEventsForSites,
  listAdminSiteConfigs,
  updateAdminSiteStructure,
} from "@/lib/site-branding.functions";

type SiteRow = {
  id: string;
  slug: string;
  name: string;
  hostname: string;
  alt_hostnames: string[];
  site_url: string;
  is_default: boolean;
  active_event_id: string | null;
};

type FormState = {
  slug: string;
  name: string;
  hostname: string;
  alt_hostnames: string; // newline-separated in UI
  site_url: string;
  active_event_id: string | null;
  is_default: boolean;
};

function emptyForm(): FormState {
  return {
    slug: "",
    name: "",
    hostname: "",
    alt_hostnames: "",
    site_url: "",
    active_event_id: null,
    is_default: false,
  };
}

function toForm(row: SiteRow): FormState {
  return {
    slug: row.slug,
    name: row.name,
    hostname: row.hostname,
    alt_hostnames: (row.alt_hostnames ?? []).join("\n"),
    site_url: row.site_url,
    active_event_id: row.active_event_id,
    is_default: row.is_default,
  };
}

function parseAlts(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function SitesTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listAdminSiteConfigs);
  const eventsFn = useServerFn(listAdminEventsForSites);
  const createFn = useServerFn(createAdminSiteConfig);
  const updateFn = useServerFn(updateAdminSiteStructure);
  const deleteFn = useServerFn(deleteAdminSiteConfig);

  const list = useQuery({ queryKey: ["admin-site-configs"], queryFn: () => listFn() });
  const events = useQuery({ queryKey: ["admin-events-for-sites"], queryFn: () => eventsFn() });

  const [editing, setEditing] = useState<SiteRow | null>(null);
  const [creating, setCreating] = useState(false);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["admin-site-configs"] });
    qc.invalidateQueries({ queryKey: ["admin-events-selector"] });
  };

  const createMut = useMutation({
    mutationFn: (f: FormState) =>
      createFn({
        data: {
          slug: f.slug,
          name: f.name,
          hostname: f.hostname,
          alt_hostnames: parseAlts(f.alt_hostnames),
          site_url: f.site_url,
          active_event_id: f.active_event_id,
          is_default: f.is_default,
        },
      }),
    onSuccess: () => {
      toast.success("Site criado.");
      setCreating(false);
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: (payload: { id: string; f: FormState }) =>
      updateFn({
        data: {
          id: payload.id,
          slug: payload.f.slug,
          name: payload.f.name,
          hostname: payload.f.hostname,
          alt_hostnames: parseAlts(payload.f.alt_hostnames),
          site_url: payload.f.site_url,
          active_event_id: payload.f.active_event_id,
          is_default: payload.f.is_default,
        },
      }),
    onSuccess: () => {
      toast.success("Site atualizado.");
      setEditing(null);
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Site removido.");
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sites = (list.data ?? []) as SiteRow[];
  const eventsList = events.data ?? [];
  const eventName = (id: string | null) =>
    id ? eventsList.find((e) => e.id === id)?.name ?? "(evento removido)" : "—";

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">Sites white-label</h3>
            <p className="text-xs text-muted-foreground">
              Cada site é resolvido pelo hostname da requisição. O padrão é usado quando
              o hostname não bate com nenhum registro.
            </p>
          </div>
          <Dialog open={creating} onOpenChange={setCreating}>
            <DialogTrigger asChild>
              <Button>Novo site</Button>
            </DialogTrigger>
            <SiteFormDialog
              title="Novo site white-label"
              initial={emptyForm()}
              events={eventsList}
              submitting={createMut.isPending}
              onSubmit={(f) => createMut.mutate(f)}
              onCancel={() => setCreating(false)}
            />
          </Dialog>
        </div>
      </Card>

      {list.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : !sites.length ? (
        <Card className="p-6 text-sm text-muted-foreground">
          Nenhum site cadastrado. Clique em <strong>Novo site</strong>.
        </Card>
      ) : (
        <div className="grid gap-3">
          {sites.map((s) => (
            <Card key={s.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-base font-semibold">{s.name}</h4>
                    {s.is_default ? (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                        padrão
                      </span>
                    ) : null}
                    <span className="rounded bg-muted px-2 py-0.5 font-mono text-[11px]">{s.slug}</span>
                  </div>
                  <div className="mt-1 text-sm">
                    <span className="text-muted-foreground">Hostname:</span>{" "}
                    <span className="font-mono">{s.hostname}</span>
                  </div>
                  {s.alt_hostnames?.length ? (
                    <div className="text-sm">
                      <span className="text-muted-foreground">Alt:</span>{" "}
                      <span className="font-mono">{s.alt_hostnames.join(", ")}</span>
                    </div>
                  ) : null}
                  <div className="text-sm">
                    <span className="text-muted-foreground">URL:</span>{" "}
                    <a href={s.site_url} target="_blank" rel="noreferrer" className="text-primary underline">
                      {s.site_url}
                    </a>
                  </div>
                  <div className="text-sm">
                    <span className="text-muted-foreground">Evento ativo:</span>{" "}
                    <span>{eventName(s.active_event_id)}</span>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Dialog
                    open={editing?.id === s.id}
                    onOpenChange={(o) => setEditing(o ? s : null)}
                  >
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline">
                        Editar
                      </Button>
                    </DialogTrigger>
                    {editing?.id === s.id ? (
                      <SiteFormDialog
                        title={`Editar site — ${s.name}`}
                        initial={toForm(s)}
                        events={eventsList}
                        submitting={updateMut.isPending}
                        onSubmit={(f) => updateMut.mutate({ id: s.id, f })}
                        onCancel={() => setEditing(null)}
                      />
                    ) : null}
                  </Dialog>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    disabled={s.is_default || deleteMut.isPending}
                    onClick={() => {
                      if (confirm(`Remover o site "${s.name}"? Esta ação não pode ser desfeita.`)) {
                        deleteMut.mutate(s.id);
                      }
                    }}
                  >
                    Excluir
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function SiteFormDialog({
  title,
  initial,
  events,
  submitting,
  onSubmit,
  onCancel,
}: {
  title: string;
  initial: FormState;
  events: { id: string; name: string }[];
  submitting: boolean;
  onSubmit: (f: FormState) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<FormState>(initial);
  useEffect(() => setF(initial), [initial]);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setF((prev) => ({ ...prev, [k]: v }));

  const canSubmit =
    f.slug.trim() && f.name.trim() && f.hostname.trim() && f.site_url.trim();

  return (
    <DialogContent className="max-w-xl">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-3">
        <Field label="Nome público">
          <Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Ex: Rodada PromPerú" />
        </Field>
        <Field label="Slug" hint="letras minúsculas, números e hífens">
          <Input
            value={f.slug}
            onChange={(e) => set("slug", e.target.value.toLowerCase())}
            placeholder="ex: promperu"
          />
        </Field>
        <Field label="Hostname principal" hint="ex: rodada.promperu.tur.br">
          <Input
            value={f.hostname}
            onChange={(e) => set("hostname", e.target.value.toLowerCase())}
            placeholder="rodada.exemplo.com"
          />
        </Field>
        <Field label="Hostnames alternativos" hint="um por linha ou separados por vírgula">
          <Textarea
            rows={3}
            value={f.alt_hostnames}
            onChange={(e) => set("alt_hostnames", e.target.value)}
            placeholder={"www.exemplo.com\nexemplo-preview.lovable.app"}
          />
        </Field>
        <Field label="URL pública (site_url)" hint="URL absoluta usada em e-mails e links canônicos">
          <Input
            value={f.site_url}
            onChange={(e) => set("site_url", e.target.value)}
            placeholder="https://rodada.exemplo.com"
          />
        </Field>
        <Field label="Evento ativo">
          <Select
            value={f.active_event_id ?? "__none"}
            onValueChange={(v) => set("active_event_id", v === "__none" ? null : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecionar evento" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">— sem evento vinculado —</SelectItem>
              {events.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="flex items-center justify-between rounded-md border border-border p-3">
          <div>
            <Label className="text-sm font-medium">Site padrão (fallback)</Label>
            <p className="text-xs text-muted-foreground">
              Usado quando o hostname da requisição não bate com nenhum registro. Apenas um site pode ser o padrão.
            </p>
          </div>
          <Switch checked={f.is_default} onCheckedChange={(v) => set("is_default", v)} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancelar
        </Button>
        <Button onClick={() => onSubmit(f)} disabled={!canSubmit || submitting}>
          {submitting ? "Salvando..." : "Salvar"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      {hint ? <div className="text-[10px] text-muted-foreground/70">{hint}</div> : null}
      <div className="mt-1">{children}</div>
    </div>
  );
}