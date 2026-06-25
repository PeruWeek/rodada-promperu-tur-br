import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import {
  assignPipelineOwner,
  completeNextAction,
  getPipelineAlerts,
  getPipelineKpis,
  listFollowUps,
  listPipeline,
  listStaffOwners,
  updatePipelineEntry,
} from "@/lib/pipeline.functions";
import {
  COMPANY_CATEGORIES,
  COMPANY_TYPES,
  NEXT_ACTIONS,
  PRIORITIES,
  REGISTRATION_STATUSES,
  SCHEDULING_STATUSES,
  type NextAction,
  type Priority,
} from "@/lib/pipeline.constants";

type Props = { isAdmin: boolean };

export function PipelineDashboard({ isAdmin }: Props) {
  return (
    <Tabs defaultValue="overview" className="mt-2">
      <TabsList className="flex flex-wrap h-auto">
        <TabsTrigger value="overview">Visão Geral</TabsTrigger>
        <TabsTrigger value="registrations">Cadastros</TabsTrigger>
        <TabsTrigger value="scheduling">Agendamentos</TabsTrigger>
        <TabsTrigger value="followup">Follow-up</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="mt-4"><OverviewTab isAdmin={isAdmin} /></TabsContent>
      <TabsContent value="registrations" className="mt-4"><RegistrationsTab isAdmin={isAdmin} /></TabsContent>
      <TabsContent value="scheduling" className="mt-4"><SchedulingTab isAdmin={isAdmin} /></TabsContent>
      <TabsContent value="followup" className="mt-4"><FollowUpTab isAdmin={isAdmin} /></TabsContent>
    </Tabs>
  );
}

function Kpi({ label, value }: { label: string; value: number | string }) {
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </Card>
  );
}

function OverviewTab({ isAdmin }: Props) {
  const kpisFn = useServerFn(getPipelineKpis);
  const alertsFn = useServerFn(getPipelineAlerts);
  const [period, setPeriod] = useState(30);
  const [mine, setMine] = useState(!isAdmin);

  const { data: kpis, isLoading } = useQuery({
    queryKey: ["pipeline-kpis", period, mine],
    queryFn: () => kpisFn({ data: { periodDays: period, mine } }),
  });
  const { data: alerts } = useQuery({
    queryKey: ["pipeline-alerts", mine],
    queryFn: () => alertsFn({ data: { mine } }),
  });

  if (isLoading || !kpis) return <Skeleton className="h-60 w-full" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={String(period)} onValueChange={(v) => setPeriod(Number(v))}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Últimos 7 dias</SelectItem>
            <SelectItem value="30">Últimos 30 dias</SelectItem>
            <SelectItem value="90">Últimos 90 dias</SelectItem>
            <SelectItem value="365">Último ano</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Switch checked={mine} onCheckedChange={setMine} id="mine-overview" />
          <Label htmlFor="mine-overview" className="text-sm">Apenas minha carteira</Label>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Total empresas" value={kpis.kpis.total} />
        <Kpi label="Novos no período" value={kpis.kpis.newInPeriod} />
        <Kpi label="Empresas inscritas" value={kpis.kpis.registeredCompanies} />
        <Kpi label="Cadastros concluídos" value={kpis.kpis.completed} />
        <Kpi label="Cadastros incompletos" value={kpis.kpis.incomplete} />
        <Kpi label="Sem agendamento" value={kpis.kpis.withoutScheduling} />
        <Kpi label="Com agendamento" value={kpis.kpis.withScheduling ?? 0} />
        <Kpi label="Follow-up pendente" value={kpis.kpis.followUpPending} />
        <Kpi label="Aguardando aprovação" value={kpis.kpis.awaitingApproval} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Distribution title="Por tipo de empresa" rows={kpis.byType} />
        <Distribution title="Por categoria" rows={kpis.byCategory} />
        <Distribution title="Por país" rows={kpis.byCountry} />
        <Distribution title="Por estado" rows={kpis.byState} />
        <Distribution title="Top cidades" rows={kpis.byCity} />
        <Distribution title="Status de cadastro" rows={kpis.byRegistrationStatus} />
        <Distribution title="Status de agendamento" rows={kpis.bySchedulingStatus} />
        <Distribution title="Por responsável" rows={kpis.byOwner} />
      </div>

      {alerts && (
        <div className="grid gap-4 lg:grid-cols-2">
          <AlertList title="Sem agendamento (cadastro concluído)" rows={alerts.withoutScheduling} />
          <AlertList title="Cadastro incompleto há +14 dias" rows={alerts.incompleteStale} />
          <AlertList title="Aguardando contato" rows={alerts.awaitingContact} />
          <AlertList title="Aguardando aprovação" rows={alerts.awaitingApproval} />
        </div>
      )}
    </div>
  );
}

function Distribution({ title, rows }: { title: string; rows: Array<{ key: string; count: number }> }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Card className="p-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sem dados.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.slice(0, 10).map((r) => (
            <li key={r.key} className="text-xs">
              <div className="flex justify-between">
                <span className="truncate">{r.key || "—"}</span>
                <span className="font-semibold">{r.count}</span>
              </div>
              <div className="mt-1 h-1.5 rounded bg-muted">
                <div className="h-full rounded bg-primary" style={{ width: `${(r.count / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

type AlertRow = {
  id: string | null;
  company_trade_name: string | null;
  primary_contact_name?: string | null;
  region_label?: string | null;
};
function AlertList({ title, rows }: { title: string; rows: AlertRow[] }) {
  return (
    <Card className="p-4">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sem itens.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id ?? Math.random()} className="py-2 text-sm">
              <div className="font-medium">{r.company_trade_name ?? "—"}</div>
              <div className="text-xs text-muted-foreground">
                {r.primary_contact_name ?? "—"}{r.region_label ? ` · ${r.region_label}` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

type PipelineRow = {
  id: string;
  company_trade_name: string | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  company_role: string | null;
  company_type: string | null;
  company_category: string | null;
  country_code: string | null;
  state_code: string | null;
  city: string | null;
  region_label: string | null;
  registration_status: string;
  scheduling_status: string;
  next_action: string;
  next_action_due_at: string | null;
  priority: string;
  notes: string | null;
  is_profile_complete: boolean;
  owner_staff_profile_id: string | null;
  owner_name: string | null;
  scheduled_meetings_count: number | null;
  updated_at: string;
  created_at: string;
};

function useStaffOwners() {
  const fn = useServerFn(listStaffOwners);
  return useQuery({ queryKey: ["pipeline-staff-owners"], queryFn: () => fn() });
}

function RegistrationsTab({ isAdmin }: Props) {
  const listFn = useServerFn(listPipeline);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<string>(isAdmin ? "any" : "visitor");
  const [type, setType] = useState<string>("any");
  const [category, setCategory] = useState<string>("any");
  const [country, setCountry] = useState<string>("");
  const [regStatus, setRegStatus] = useState<string>("any");
  const [mine, setMine] = useState(!isAdmin);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["pipeline-list", { search, role, type, category, country, regStatus, mine, page }],
    queryFn: () =>
      listFn({
        data: {
          page,
          pageSize: 50,
          search: search || undefined,
          role: role === "any" ? undefined : (role as "exhibitor" | "visitor"),
          companyType: type === "any" ? undefined : (type as (typeof COMPANY_TYPES)[number]),
          companyCategory: category === "any" ? undefined : (category as (typeof COMPANY_CATEGORIES)[number]),
          country: country || undefined,
          registrationStatus: regStatus === "any" ? undefined : (regStatus as (typeof REGISTRATION_STATUSES)[number]),
          mine,
        },
      }),
  });

  const chips = [
    { label: "Brasil", apply: () => setCountry("BR") },
    { label: "Peru", apply: () => setCountry("PE") },
    { label: "Agências", apply: () => setType("agencia") },
    { label: "Operadoras", apply: () => setType("operadora") },
    { label: "Hotéis", apply: () => setType("hotel") },
    { label: "DMCs", apply: () => setType("dmc") },
    { label: "Buyers prioritários", apply: () => setCategory("buyer_prioritario") },
    { label: "Limpar", apply: () => { setRole("any"); setType("any"); setCategory("any"); setCountry(""); setRegStatus("any"); setSearch(""); } },
  ];

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap gap-2">
        {chips.map((c) => (
          <Button key={c.label} size="sm" variant="outline" onClick={() => { c.apply(); setPage(1); }}>{c.label}</Button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Switch checked={mine} onCheckedChange={setMine} id="mine-reg" />
          <Label htmlFor="mine-reg" className="text-sm">Apenas meus</Label>
        </div>
      </div>

      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <Input placeholder="Buscar empresa, contato, e-mail..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="lg:col-span-2" />
        <EnumSelect value={role} onChange={(v) => { setRole(v); setPage(1); }} placeholder="Papel" options={["exhibitor","visitor"]} />
        <EnumSelect value={type} onChange={(v) => { setType(v); setPage(1); }} placeholder="Tipo" options={[...COMPANY_TYPES]} />
        <EnumSelect value={category} onChange={(v) => { setCategory(v); setPage(1); }} placeholder="Categoria" options={[...COMPANY_CATEGORIES]} />
        <EnumSelect value={regStatus} onChange={(v) => { setRegStatus(v); setPage(1); }} placeholder="Status cadastro" options={[...REGISTRATION_STATUSES]} />
      </div>

      {isLoading ? (
        <Skeleton className="h-60 w-full" />
      ) : (data?.rows ?? []).length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma empresa encontrada.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome Fantasia</TableHead>
                  <TableHead>Contato</TableHead>
                  <TableHead>Papel</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Localidade</TableHead>
                  <TableHead>Cadastro</TableHead>
                  <TableHead>Perfil</TableHead>
                  <TableHead>Responsável</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data!.rows as PipelineRow[]).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.company_trade_name ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      <div>{r.primary_contact_name ?? "—"}</div>
                      <div className="text-muted-foreground">{r.primary_contact_email ?? ""}</div>
                    </TableCell>
                    <TableCell><Badge variant="outline">{r.company_role}</Badge></TableCell>
                    <TableCell>{r.company_type ?? "—"}</TableCell>
                    <TableCell>{r.company_category ?? "—"}</TableCell>
                    <TableCell className="text-xs">{[r.city, r.state_code, r.country_code].filter(Boolean).join(", ") || "—"}</TableCell>
                    <TableCell><Badge>{r.registration_status}</Badge></TableCell>
                    <TableCell>{r.is_profile_complete ? "✓" : "—"}</TableCell>
                    <TableCell className="text-xs">{r.owner_name ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>{data!.total} resultados</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
              <Button size="sm" variant="outline" disabled={(page * 50) >= data!.total} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

function EnumSelect({ value, onChange, placeholder, options }: { value: string; onChange: (v: string) => void; placeholder: string; options: string[] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        <SelectItem value="any">{placeholder} — todos</SelectItem>
        {options.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
      </SelectContent>
    </Select>
  );
}

function SchedulingTab({ isAdmin }: Props) {
  const listFn = useServerFn(listPipeline);
  // Grupo principal (count-based). Sub-status operacional só para staff/admin.
  const [group, setGroup] = useState<"any" | "sem_agendamento" | "com_agendamento">("any");
  const [opStatus, setOpStatus] = useState<"any" | "agendado_parcial" | "agendado_ok">("any");
  const [mine, setMine] = useState(!isAdmin);
  const { data, isLoading } = useQuery({
    queryKey: ["pipeline-scheduling", group, opStatus, mine],
    queryFn: () =>
      listFn({
        data: {
          pageSize: 200,
          page: 1,
          schedulingGroup: group === "any" ? undefined : group,
          schedulingStatus:
            group === "com_agendamento" && opStatus !== "any"
              ? (opStatus as (typeof SCHEDULING_STATUSES)[number])
              : undefined,
          mine,
        },
      }),
  });

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Select value={group} onValueChange={(v) => setGroup(v as typeof group)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Agendamento — todos</SelectItem>
            <SelectItem value="sem_agendamento">Sem agendamento</SelectItem>
            <SelectItem value="com_agendamento">Com agendamento</SelectItem>
          </SelectContent>
        </Select>
        {group === "com_agendamento" && (
          <Select value={opStatus} onValueChange={(v) => setOpStatus(v as typeof opStatus)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Operacional — todos</SelectItem>
              <SelectItem value="agendado_parcial">Parcial</SelectItem>
              <SelectItem value="agendado_ok">Completo</SelectItem>
            </SelectContent>
          </Select>
        )}
        <div className="flex items-center gap-2">
          <Switch checked={mine} onCheckedChange={setMine} id="mine-sch" />
          <Label htmlFor="mine-sch" className="text-sm">Apenas meus</Label>
        </div>
      </div>
      {isLoading ? <Skeleton className="h-60 w-full" /> : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome Fantasia</TableHead>
                <TableHead>Papel</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Localidade</TableHead>
                <TableHead className="text-right">Reuniões</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Responsável</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.rows as PipelineRow[] | undefined)?.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.company_trade_name ?? "—"}</TableCell>
                  <TableCell>{r.company_role}</TableCell>
                  <TableCell>{r.company_type ?? "—"}</TableCell>
                  <TableCell>{r.company_category ?? "—"}</TableCell>
                  <TableCell className="text-xs">{r.region_label ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{r.scheduled_meetings_count ?? 0}</TableCell>
                  <TableCell><Badge>{r.scheduling_status}</Badge></TableCell>
                  <TableCell className="text-xs">{r.owner_name ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

function FollowUpTab({ isAdmin }: Props) {
  const qc = useQueryClient();
  const listFn = useServerFn(listFollowUps);
  const updateFn = useServerFn(updatePipelineEntry);
  const completeFn = useServerFn(completeNextAction);
  const assignFn = useServerFn(assignPipelineOwner);
  const owners = useStaffOwners();
  const [mine, setMine] = useState(!isAdmin);
  const [sort, setSort] = useState<"priority" | "due">("priority");

  const { data, isLoading } = useQuery({
    queryKey: ["pipeline-followups", mine, sort],
    queryFn: () => listFn({ data: { mine, sort } }),
  });

  type PatchInput = {
    next_action?: NextAction;
    priority?: Priority;
    next_action_due_at?: string | null;
    notes?: string | null;
  };
  const mutPatch = useMutation({
    mutationFn: (v: { id: string; patch: PatchInput }) =>
      updateFn({ data: v }),
    onSuccess: () => { toast.success("Atualizado"); qc.invalidateQueries({ queryKey: ["pipeline-followups"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const mutComplete = useMutation({
    mutationFn: (v: { id: string; nextAction: NextAction; dueAt: string | null; channel: string }) =>
      completeFn({ data: v }),
    onSuccess: () => { toast.success("Ação registrada"); qc.invalidateQueries({ queryKey: ["pipeline-followups"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const mutAssign = useMutation({
    mutationFn: (v: { id: string; ownerProfileId: string | null }) => assignFn({ data: v }),
    onSuccess: () => { toast.success("Responsável atualizado"); qc.invalidateQueries({ queryKey: ["pipeline-followups"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const ownerOptions = useMemo(() => owners.data?.owners ?? [], [owners.data]);

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="priority">Ordenar por prioridade</SelectItem>
            <SelectItem value="due">Ordenar por vencimento</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Switch checked={mine} onCheckedChange={setMine} id="mine-fu" />
          <Label htmlFor="mine-fu" className="text-sm">Apenas meus</Label>
        </div>
      </div>
      {isLoading ? <Skeleton className="h-60 w-full" /> : (data?.rows ?? []).length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nenhum follow-up pendente.</p>
      ) : (
        <div className="space-y-3">
          {(data!.rows as PipelineRow[]).map((r) => (
            <div key={r.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{r.company_trade_name ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.primary_contact_name ?? "—"}{r.region_label ? ` · ${r.region_label}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={r.priority === "alta" ? "destructive" : r.priority === "media" ? "default" : "secondary"}>{r.priority}</Badge>
                  <Badge variant="outline">{r.next_action}</Badge>
                  {r.next_action_due_at && (
                    <Badge variant="outline">{new Date(r.next_action_due_at).toLocaleDateString()}</Badge>
                  )}
                </div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-4">
                <Select value={r.next_action} onValueChange={(v) => mutPatch.mutate({ id: r.id, patch: { next_action: v as NextAction } })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{NEXT_ACTIONS.map((a) => (<SelectItem key={a} value={a}>{a}</SelectItem>))}</SelectContent>
                </Select>
                <Select value={r.priority} onValueChange={(v) => mutPatch.mutate({ id: r.id, patch: { priority: v as Priority } })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PRIORITIES.map((p) => (<SelectItem key={p} value={p}>{p}</SelectItem>))}</SelectContent>
                </Select>
                <Input
                  type="date"
                  defaultValue={r.next_action_due_at ? r.next_action_due_at.slice(0, 10) : ""}
                  onBlur={(e) => {
                    const v = e.target.value ? new Date(e.target.value).toISOString() : null;
                    mutPatch.mutate({ id: r.id, patch: { next_action_due_at: v } });
                  }}
                />
                {isAdmin && (
                  <Select
                    value={r.owner_staff_profile_id ?? "none"}
                    onValueChange={(v) => mutAssign.mutate({ id: r.id, ownerProfileId: v === "none" ? null : v })}
                  >
                    <SelectTrigger><SelectValue placeholder="Responsável" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Sem responsável —</SelectItem>
                      {ownerOptions.map((o) => (<SelectItem key={o.id} value={o.id}>{o.full_name}</SelectItem>))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <Textarea
                className="mt-2"
                rows={2}
                placeholder="Observações"
                defaultValue={r.notes ?? ""}
                onBlur={(e) => mutPatch.mutate({ id: r.id, patch: { notes: e.target.value || null } })}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => mutComplete.mutate({ id: r.id, nextAction: "nenhuma", dueAt: null, channel: "manual" })}>Concluir</Button>
                <Button size="sm" variant="outline" onClick={() => {
                  const d = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
                  mutPatch.mutate({ id: r.id, patch: { next_action_due_at: d } });
                }}>Reagendar +3d</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}