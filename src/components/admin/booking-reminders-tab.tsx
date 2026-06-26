import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Play, Save, FlaskConical } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getBookingReminderSettings,
  updateBookingReminderSettings,
  runBookingRemindersNow,
  listBookingReminderHistory,
  listBookingReminderEvents,
} from "@/lib/booking-reminders.functions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function BookingRemindersTab() {
  const qc = useQueryClient();
  const getFn = useServerFn(getBookingReminderSettings);
  const updateFn = useServerFn(updateBookingReminderSettings);
  const runFn = useServerFn(runBookingRemindersNow);
  const historyFn = useServerFn(listBookingReminderHistory);
  const eventsFn = useServerFn(listBookingReminderEvents);

  const { data, isLoading } = useQuery({
    queryKey: ["booking-reminder-settings"],
    queryFn: () => getFn(),
  });

  const { data: eventsList } = useQuery({
    queryKey: ["booking-reminder-events"],
    queryFn: () => eventsFn(),
  });

  const [filters, setFilters] = useState({
    from: "",
    to: "",
    eventId: "",
    status: "",
    mode: "",
    query: "",
  });

  const historyQuery = useQuery({
    queryKey: ["booking-reminder-history", filters],
    queryFn: () =>
      historyFn({
        data: {
          from: filters.from ? new Date(filters.from).toISOString() : undefined,
          to: filters.to ? new Date(filters.to).toISOString() : undefined,
          eventId: filters.eventId || undefined,
          status: (filters.status || undefined) as any,
          mode: (filters.mode || undefined) as any,
          query: filters.query.trim() || undefined,
          limit: 200,
        },
      }),
  });

  const [form, setForm] = useState({
    enabled: false,
    run_hour: 10,
    timezone: "America/Sao_Paulo",
    max_reminders_per_event: 3,
    min_interval_hours: 24,
    event_scope: "" as string,
  });

  useEffect(() => {
    if (data) {
      setForm({
        enabled: !!data.enabled,
        run_hour: data.run_hour ?? 10,
        timezone: data.timezone ?? "America/Sao_Paulo",
        max_reminders_per_event: data.max_reminders_per_event ?? 3,
        min_interval_hours: data.min_interval_hours ?? 24,
        event_scope: data.event_scope ?? "",
      });
    }
  }, [data]);

  const saveMut = useMutation({
    mutationFn: async () =>
      updateFn({
        data: {
          enabled: form.enabled,
          run_hour: Number(form.run_hour),
          timezone: form.timezone,
          max_reminders_per_event: Number(form.max_reminders_per_event),
          min_interval_hours: Number(form.min_interval_hours),
          event_scope: form.event_scope.trim() ? form.event_scope.trim() : null,
        },
      }),
    onSuccess: () => {
      toast.success("Configuração salva");
      qc.invalidateQueries({ queryKey: ["booking-reminder-settings"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao salvar"),
  });

  const runMut = useMutation({
    mutationFn: async (dryRun: boolean) => runFn({ data: { dryRun } }),
    onSuccess: (s) => {
      toast.success(
        `Execução concluída — enviados: ${s.sent}, elegíveis: ${s.eligible}, avaliados: ${s.evaluated}`,
      );
      qc.invalidateQueries({ queryKey: ["booking-reminder-settings"] });
      qc.invalidateQueries({ queryKey: ["booking-reminder-history"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao executar"),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const lastSummary = (data?.last_run_summary as any) ?? null;

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Lembretes de agendamento</h3>
            <p className="text-sm text-muted-foreground">
              Envio diário de lembrete por e-mail para compradores cadastrados
              que ainda não agendaram reuniões.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={form.enabled}
              onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
            />
            <span className="text-sm">{form.enabled ? "Ativo" : "Pausado"}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Hora da execução diária (0–23)</Label>
            <Input
              type="number"
              min={0}
              max={23}
              value={form.run_hour}
              onChange={(e) =>
                setForm((f) => ({ ...f, run_hour: Number(e.target.value) }))
              }
            />
          </div>
          <div>
            <Label>Timezone</Label>
            <Input
              value={form.timezone}
              onChange={(e) =>
                setForm((f) => ({ ...f, timezone: e.target.value }))
              }
              placeholder="America/Sao_Paulo"
            />
          </div>
          <div>
            <Label>Máximo de lembretes por evento</Label>
            <Input
              type="number"
              min={1}
              max={20}
              value={form.max_reminders_per_event}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  max_reminders_per_event: Number(e.target.value),
                }))
              }
            />
          </div>
          <div>
            <Label>Intervalo mínimo entre lembretes (horas)</Label>
            <Input
              type="number"
              min={1}
              max={720}
              value={form.min_interval_hours}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  min_interval_hours: Number(e.target.value),
                }))
              }
            />
          </div>
          <div className="md:col-span-2">
            <Label>Evento (UUID) — opcional, vazio = evento ativo</Label>
            <Input
              value={form.event_scope}
              onChange={(e) =>
                setForm((f) => ({ ...f, event_scope: e.target.value }))
              }
              placeholder="Deixe em branco para usar o evento ativo"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
            <Save className="h-4 w-4 mr-2" /> Salvar configuração
          </Button>
          <Button
            variant="secondary"
            onClick={() => runMut.mutate(true)}
            disabled={runMut.isPending}
          >
            <FlaskConical className="h-4 w-4 mr-2" /> Simular (dry-run)
          </Button>
          <Button
            variant="default"
            onClick={() => runMut.mutate(false)}
            disabled={runMut.isPending}
          >
            <Play className="h-4 w-4 mr-2" /> Executar agora
          </Button>
        </div>
      </Card>

      <Card className="p-4">
        <h4 className="font-semibold mb-2">Última execução</h4>
        {data?.last_run_at ? (
          <div className="text-sm space-y-1">
            <div>
              <strong>Quando:</strong>{" "}
              {new Date(data.last_run_at).toLocaleString("pt-BR")}
            </div>
            {lastSummary && (
              <pre className="text-xs bg-muted p-3 rounded overflow-auto">
{JSON.stringify(lastSummary, null, 2)}
              </pre>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhuma execução registrada ainda.</p>
        )}
      </Card>

      <Card className="p-4 space-y-4">
        <div>
          <h4 className="font-semibold">Histórico de lembretes</h4>
          <p className="text-sm text-muted-foreground">
            Envios, skips e erros registrados pela rotina (automática e manual).
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-2 text-sm">
          <div>
            <Label>De</Label>
            <Input
              type="datetime-local"
              value={filters.from}
              onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
            />
          </div>
          <div>
            <Label>Até</Label>
            <Input
              type="datetime-local"
              value={filters.to}
              onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
            />
          </div>
          <div>
            <Label>Evento</Label>
            <Select
              value={filters.eventId || "all"}
              onValueChange={(v) =>
                setFilters((f) => ({ ...f, eventId: v === "all" ? "" : v }))
              }
            >
              <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {(eventsList ?? []).map((e: any) => (
                  <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Status</Label>
            <Select
              value={filters.status || "all"}
              onValueChange={(v) =>
                setFilters((f) => ({ ...f, status: v === "all" ? "" : v }))
              }
            >
              <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="sent">Enviado</SelectItem>
                <SelectItem value="queued">Em fila</SelectItem>
                <SelectItem value="skipped">Skipped</SelectItem>
                <SelectItem value="error">Erro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Modo</Label>
            <Select
              value={filters.mode || "all"}
              onValueChange={(v) =>
                setFilters((f) => ({ ...f, mode: v === "all" ? "" : v }))
              }
            >
              <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="auto">Automático</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Usuário / e-mail</Label>
            <Input
              placeholder="email contém..."
              value={filters.query}
              onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
            />
          </div>
        </div>

        <div className="overflow-auto max-h-[600px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data/hora</TableHead>
                <TableHead>Evento</TableHead>
                <TableHead>Usuário</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Idioma</TableHead>
                <TableHead>Modo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Detalhe</TableHead>
                <TableHead className="text-right">Enviados</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {historyQuery.isLoading ? (
                <TableRow><TableCell colSpan={9}><Skeleton className="h-24 w-full" /></TableCell></TableRow>
              ) : (historyQuery.data?.items ?? []).length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">Nenhum registro</TableCell></TableRow>
              ) : (
                (historyQuery.data?.items ?? []).map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell>{new Date(r.sent_at).toLocaleString("pt-BR")}</TableCell>
                    <TableCell className="max-w-[140px] truncate">{r.event_name ?? r.event_id}</TableCell>
                    <TableCell className="max-w-[160px] truncate">{r.user_name ?? "—"}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{r.recipient_email}</TableCell>
                    <TableCell>{r.language ?? "—"}</TableCell>
                    <TableCell>{r.mode === "manual" ? "Manual" : r.mode === "auto" ? "Auto" : "—"}</TableCell>
                    <TableCell>
                      <Badge variant={
                        r.status === "sent" ? "default"
                        : r.status === "error" ? "destructive"
                        : r.status === "skipped" ? "secondary"
                        : "outline"
                      }>{r.status}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">
                      {r.error_reason ?? r.skip_reason ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">{r.sent_count_for_user_event}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}