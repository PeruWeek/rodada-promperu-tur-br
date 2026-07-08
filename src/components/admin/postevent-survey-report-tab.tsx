import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, RefreshCw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { getPostEventSurveyReport } from "@/lib/postevent-qa.functions";

type Row = {
  profile_id: string;
  full_name: string;
  email: string;
  company: string | null;
  sent_at: string | null;
  first_opened_at: string | null;
  submitted_at: string | null;
  survey: {
    overall_rating: number | null;
    meetings_quality: number | null;
    next_edition_interest: "yes" | "maybe" | "no" | null;
    comments: string | null;
    created_at: string | null;
  } | null;
  meetings: Array<{
    meeting_id: string;
    counterpart_name: string;
    counterpart_company: string;
    table_number: number | null;
    slot_start: string | null;
    status: string;
    checkin_status: string | null;
  }>;
  meetings_done: number;
  meetings_no_show: number;
  meetings_pending: number;
};

function fmt(dt: string | null): string {
  if (!dt) return "—";
  return new Date(dt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function nextEditionLabel(v: string | null): string {
  if (v === "yes") return "Sim";
  if (v === "maybe") return "Talvez";
  if (v === "no") return "Não";
  return "—";
}

function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCsv(rows: Row[]): string {
  const header = [
    "participante",
    "email",
    "empresa",
    "enviado_em",
    "aberto_em",
    "respondido_em",
    "nota_geral_1a5",
    "qualidade_reunioes_1a5",
    "interesse_proxima_edicao",
    "comentarios",
    "reunioes_realizadas",
    "reunioes_nao_realizadas",
    "reunioes_pendentes",
    "reuniao_contraparte",
    "reuniao_empresa",
    "reuniao_mesa",
    "reuniao_horario",
    "reuniao_status_canonico",
    "reuniao_checkin",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const base = [
      r.full_name,
      r.email,
      r.company ?? "",
      r.sent_at ?? "",
      r.first_opened_at ?? "",
      r.submitted_at ?? "",
      r.survey?.overall_rating ?? "",
      r.survey?.meetings_quality ?? "",
      nextEditionLabel(r.survey?.next_edition_interest ?? null),
      r.survey?.comments ?? "",
      r.meetings_done,
      r.meetings_no_show,
      r.meetings_pending,
    ];
    if (r.meetings.length === 0) {
      lines.push([...base.map(csvEscape), "", "", "", "", "", ""].join(","));
    } else {
      for (const m of r.meetings) {
        lines.push(
          [
            ...base.map(csvEscape),
            csvEscape(m.counterpart_name),
            csvEscape(m.counterpart_company),
            csvEscape(m.table_number ?? ""),
            csvEscape(m.slot_start ?? ""),
            csvEscape(m.status),
            csvEscape(m.checkin_status ?? ""),
          ].join(","),
        );
      }
    }
  }
  return lines.join("\n");
}

function Metric({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}

export function PostEventSurveyReportTab() {
  const reportFn = useServerFn(getPostEventSurveyReport);
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["postevent-survey-report"],
    queryFn: () => reportFn({ data: {} }),
  });
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);

  const allRows = (data?.rows ?? []) as Row[];
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allRows;
    return allRows.filter(
      (r) =>
        (r.full_name ?? "").toLowerCase().includes(q) ||
        (r.email ?? "").toLowerCase().includes(q) ||
        (r.company ?? "").toLowerCase().includes(q),
    );
  }, [allRows, search]);

  const m = data?.metrics;

  const exportCsv = () => {
    const csv = buildCsv(rows);
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pesquisa-evento-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Metric label="Elegíveis (check-in)" value={m?.eligible ?? 0} />
        <Metric label="Enviados" value={m?.sent ?? 0} />
        <Metric label="Respostas" value={m?.submitted ?? 0} />
        <Metric
          label="Taxa de resposta"
          value={`${Math.round((m?.responseRate ?? 0) * 1000) / 10}%`}
          hint="respondidos ÷ enviados"
        />
        <Metric label="Reuniões realizadas" value={m?.meetingsDone ?? 0} />
        <Metric label="Reuniões não realizadas" value={m?.meetingsNoShow ?? 0} />
        <Metric label="Reuniões pendentes" value={m?.meetingsPending ?? 0} />
        <Metric
          label="Nota geral do evento"
          value={m?.overallRatingAvg != null ? `${m.overallRatingAvg} / 5` : "—"}
        />
        <Metric
          label="Qualidade das reuniões"
          value={m?.meetingsQualityAvg != null ? `${m.meetingsQualityAvg} / 5` : "—"}
        />
        <Metric
          label="Próxima edição"
          value={`${m?.nextEdition.yes ?? 0} sim · ${m?.nextEdition.maybe ?? 0} talvez · ${m?.nextEdition.no ?? 0} não`}
        />
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Buscar por empresa, participante ou e-mail…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className="mr-1 h-4 w-4" /> Atualizar
          </Button>
          <Button size="sm" onClick={exportCsv} disabled={!rows.length}>
            <Download className="mr-1 h-4 w-4" /> Exportar CSV
          </Button>
        </div>

        <div className="mt-3 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Participante</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Enviado</TableHead>
                <TableHead>Respondido</TableHead>
                <TableHead>Nota</TableHead>
                <TableHead>Qualidade</TableHead>
                <TableHead>Próxima</TableHead>
                <TableHead>Reuniões (R / N / P)</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.profile_id}>
                  <TableCell>
                    <div className="font-medium">{r.full_name}</div>
                    <div className="text-xs text-muted-foreground">{r.email}</div>
                  </TableCell>
                  <TableCell>{r.company ?? "—"}</TableCell>
                  <TableCell className="text-xs">{fmt(r.sent_at)}</TableCell>
                  <TableCell className="text-xs">
                    {r.submitted_at ? (
                      <Badge>{fmt(r.submitted_at)}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>{r.survey?.overall_rating ?? "—"}</TableCell>
                  <TableCell>{r.survey?.meetings_quality ?? "—"}</TableCell>
                  <TableCell>{nextEditionLabel(r.survey?.next_edition_interest ?? null)}</TableCell>
                  <TableCell className="text-xs">
                    {r.meetings_done} / {r.meetings_no_show} / {r.meetings_pending}
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={() => setSelected(r)}>
                      Ver
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!rows.length && (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                    Nenhum participante encontrado.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selected?.full_name}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-muted-foreground">Empresa:</span> {selected.company ?? "—"}</div>
                <div><span className="text-muted-foreground">E-mail:</span> {selected.email}</div>
                <div><span className="text-muted-foreground">Enviado:</span> {fmt(selected.sent_at)}</div>
                <div><span className="text-muted-foreground">Aberto:</span> {fmt(selected.first_opened_at)}</div>
                <div><span className="text-muted-foreground">Respondido:</span> {fmt(selected.submitted_at)}</div>
              </div>

              <div className="rounded-md border p-3">
                <p className="text-xs font-semibold uppercase text-muted-foreground">Pesquisa</p>
                {selected.survey ? (
                  <div className="mt-2 space-y-1">
                    <div>Nota geral: <b>{selected.survey.overall_rating ?? "—"}</b> / 5</div>
                    <div>Qualidade das reuniões: <b>{selected.survey.meetings_quality ?? "—"}</b> / 5</div>
                    <div>Próxima edição: <b>{nextEditionLabel(selected.survey.next_edition_interest)}</b></div>
                    {selected.survey.comments ? (
                      <div className="mt-2 rounded bg-muted/50 p-2 text-xs">{selected.survey.comments}</div>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-2 text-muted-foreground">Sem respostas.</p>
                )}
              </div>

              <div className="rounded-md border p-3">
                <p className="text-xs font-semibold uppercase text-muted-foreground">
                  Reuniões (fonte canônica: meeting_checkins / meetings.status)
                </p>
                {selected.meetings.length === 0 ? (
                  <p className="mt-2 text-muted-foreground">Sem reuniões.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Contraparte</TableHead>
                        <TableHead>Empresa</TableHead>
                        <TableHead>Mesa</TableHead>
                        <TableHead>Horário</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selected.meetings.map((mm) => (
                        <TableRow key={mm.meeting_id}>
                          <TableCell>{mm.counterpart_name}</TableCell>
                          <TableCell>{mm.counterpart_company}</TableCell>
                          <TableCell>{mm.table_number ?? "—"}</TableCell>
                          <TableCell className="text-xs">{fmt(mm.slot_start)}</TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                mm.status === "done"
                                  ? "default"
                                  : mm.status === "no_show"
                                  ? "destructive"
                                  : "secondary"
                              }
                            >
                              {mm.status === "done"
                                ? "Realizada"
                                : mm.status === "no_show"
                                ? "Não aconteceu"
                                : "Pendente"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}