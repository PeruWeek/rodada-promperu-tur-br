import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { RefreshCw, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  listLostBookings,
  type LostBookingRow,
} from "@/lib/lost-bookings.functions";

const REASON_OPTIONS = [
  { value: "admin_dedupe_table_slot", label: "Dedupe admin (mesa/horário)" },
  {
    value: "admin_dedupe_table_slot_company",
    label: "Dedupe admin (mesa/horário/empresa)",
  },
  { value: "admin_dedupe_company_slot", label: "Dedupe admin (empresa/horário)" },
  {
    value: "auto-sanitize:duplicate_table_slot_different_company",
    label: "Auto-sanitize (outra empresa)",
  },
  {
    value: "auto-sanitize:duplicate_table_slot_different_company_v2",
    label: "Auto-sanitize v2 (outra empresa)",
  },
] as const;

function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function goToRecoveryTab() {
  if (typeof document === "undefined") return;
  const buttons = document.querySelectorAll<HTMLButtonElement>(
    'button[role="tab"]',
  );
  for (const b of buttons) {
    if ((b.textContent ?? "").trim() === "Reacomodação") {
      b.click();
      return true;
    }
  }
  return false;
}

export function LostBookingsTab() {
  const listFn = useServerFn(listLostBookings);

  const [view, setView] = useState<"contact" | "company">("contact");
  const [order, setOrder] = useState<"recent" | "impact">("recent");
  const [companyFilter, setCompanyFilter] = useState("");
  const [contactFilter, setContactFilter] = useState("");
  const [reasons, setReasons] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [limit, setLimit] = useState(500);

  const queryPayload = useMemo(
    () => ({
      limit,
      reasons: reasons.length > 0 ? reasons : null,
      dateFrom: dateFrom ? new Date(dateFrom).toISOString() : null,
      dateTo: dateTo ? new Date(dateTo).toISOString() : null,
    }),
    [limit, reasons, dateFrom, dateTo],
  );

  const q = useQuery({
    queryKey: ["lost-bookings", queryPayload],
    queryFn: () => listFn({ data: queryPayload as any }),
  });

  const rowsAll = q.data?.rows ?? [];
  const byCompanyAll = q.data?.by_company ?? [];

  // filtros client-side (empresa/contato por nome)
  const rows = useMemo(() => {
    const cf = companyFilter.trim().toLowerCase();
    const nf = contactFilter.trim().toLowerCase();
    return rowsAll.filter((r) => {
      if (
        cf &&
        !(r.loser.company_trade_name ?? "").toLowerCase().includes(cf)
      )
        return false;
      if (nf && !(r.loser.full_name ?? "").toLowerCase().includes(nf))
        return false;
      return true;
    });
  }, [rowsAll, companyFilter, contactFilter]);

  const byCompany = useMemo(() => {
    const cf = companyFilter.trim().toLowerCase();
    const arr = byCompanyAll.filter((c) =>
      cf ? (c.company_trade_name ?? "").toLowerCase().includes(cf) : true,
    );
    if (order === "impact") {
      return [...arr].sort((a, b) => b.lost_total - a.lost_total);
    }
    return [...arr].sort((a, b) =>
      (b.last_lost_at ?? "").localeCompare(a.last_lost_at ?? ""),
    );
  }, [byCompanyAll, companyFilter, order]);

  const orderedRows = useMemo(() => {
    if (order === "impact") {
      // ordena por empresa impactada com mais perdas primeiro; fallback recente
      const counts = new Map<string, number>();
      for (const r of rows) {
        const k = r.loser.company_id ?? "__none__";
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      return [...rows].sort((a, b) => {
        const ka = a.loser.company_id ?? "__none__";
        const kb = b.loser.company_id ?? "__none__";
        return (
          (counts.get(kb) ?? 0) - (counts.get(ka) ?? 0) ||
          b.cancelled_at.localeCompare(a.cancelled_at)
        );
      });
    }
    return rows;
  }, [rows, order]);

  function toggleReason(v: string) {
    setReasons((cur) =>
      cur.includes(v) ? cur.filter((r) => r !== v) : [...cur, v],
    );
  }

  function openRecovery(row: LostBookingRow) {
    try {
      navigator.clipboard?.writeText(row.loser.profile_id).catch(() => {});
    } catch {
      /* noop */
    }
    const ok = goToRecoveryTab();
    if (ok) {
      toast.success(
        `Abrindo Reacomodação. Contato: ${row.loser.full_name ?? row.loser.profile_id} (ID copiado).`,
      );
    } else {
      toast.message(
        "Abra a aba \"Reacomodação\" para reagendar este contato. ID copiado.",
      );
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div>
            <h2 className="text-lg font-semibold">Histórico de perdas</h2>
            <p className="text-sm text-muted-foreground">
              Reuniões canceladas por dedupe/conflito, com a "vencedora" do mesmo
              horário e mesa. Somente leitura.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => q.refetch()}
            disabled={q.isFetching}
          >
            <RefreshCw className="h-4 w-4 mr-2" /> Atualizar
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={companyFilter}
              onChange={(e) => setCompanyFilter(e.target.value)}
              placeholder="Empresa"
              className="pl-8"
            />
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={contactFilter}
              onChange={(e) => setContactFilter(e.target.value)}
              placeholder="Contato"
              className="pl-8"
            />
          </div>
          <Input
            type="datetime-local"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
          <Input
            type="datetime-local"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
          {REASON_OPTIONS.map((r) => {
            const id = `lb-reason-${r.value}`;
            const checked = reasons.includes(r.value);
            return (
              <label
                key={r.value}
                htmlFor={id}
                className="flex items-center gap-2 cursor-pointer"
              >
                <Checkbox
                  id={id}
                  checked={checked}
                  onCheckedChange={() => toggleReason(r.value)}
                />
                <span>{r.label}</span>
              </label>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={view} onValueChange={(v) => setView(v as any)}>
            <TabsList>
              <TabsTrigger value="contact">Por contato</TabsTrigger>
              <TabsTrigger value="company">Por empresa</TabsTrigger>
            </TabsList>
          </Tabs>
          <Tabs value={order} onValueChange={(v) => setOrder(v as any)}>
            <TabsList>
              <TabsTrigger value="recent">Mais recente</TabsTrigger>
              <TabsTrigger value="impact">Maior impacto</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-2 ml-auto">
            <Label className="text-xs">Limite</Label>
            <Input
              type="number"
              min={50}
              max={2000}
              step={50}
              value={limit}
              onChange={(e) =>
                setLimit(Math.max(50, Math.min(2000, Number(e.target.value) || 500)))
              }
              className="w-24"
            />
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          {q.data
            ? `${orderedRows.length} exibido(s) · ${q.data.total_found} encontrado(s) no total`
            : "—"}
        </div>

        {q.data?.truncated && (
          <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 text-xs px-3 py-2">
            Mostrando {q.data.rows.length} de {q.data.total_found}. Refine os
            filtros ou aumente o limite para ver o restante.
          </div>
        )}
      </Card>

      {q.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : view === "contact" ? (
        <Card className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-2">Contato</th>
                <th className="p-2">Empresa</th>
                <th className="p-2">Email</th>
                <th className="p-2">Mesa</th>
                <th className="p-2">Horário perdido</th>
                <th className="p-2">Cancelado em</th>
                <th className="p-2">Motivo</th>
                <th className="p-2">Empresa vencedora</th>
                <th className="p-2">Contato vencedor</th>
                <th className="p-2">Status venc.</th>
                <th className="p-2">Criada em (venc.)</th>
                <th className="p-2">Fonte</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {orderedRows.length === 0 ? (
                <tr>
                  <td colSpan={13} className="p-6 text-center text-muted-foreground">
                    Nenhum histórico de perda encontrado com esses filtros.
                  </td>
                </tr>
              ) : (
                orderedRows.map((r) => (
                  <tr key={r.meeting_id} className="border-t align-top">
                    <td className="p-2">{r.loser.full_name ?? "—"}</td>
                    <td className="p-2">{r.loser.company_trade_name ?? "—"}</td>
                    <td className="p-2 text-muted-foreground">
                      {r.loser.email ?? "—"}
                    </td>
                    <td className="p-2">
                      {r.slot.table_number != null ? `#${r.slot.table_number}` : "—"}
                    </td>
                    <td className="p-2">{fmtDateTime(r.slot.start_at)}</td>
                    <td className="p-2">{fmtDateTime(r.cancelled_at)}</td>
                    <td className="p-2">
                      <Badge variant="secondary" className="whitespace-nowrap">
                        {r.loss_source_label}
                      </Badge>
                      <div className="text-[10px] text-muted-foreground mt-1">
                        {r.cancel_reason}
                      </div>
                    </td>
                    <td className="p-2">
                      {r.winner?.company_trade_name ?? "—"}
                    </td>
                    <td className="p-2">{r.winner?.full_name ?? "—"}</td>
                    <td className="p-2">
                      {r.winner ? (
                        <Badge
                          variant={
                            r.winner.status === "scheduled" ? "default" : "outline"
                          }
                        >
                          {r.winner.status}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="p-2">
                      {r.winner ? fmtDateTime(r.winner.created_at) : "—"}
                    </td>
                    <td className="p-2 text-[10px] text-muted-foreground">
                      {r.winner?.winner_source === "audit_log"
                        ? "audit_log"
                        : r.winner
                          ? "heurística"
                          : "—"}
                    </td>
                    <td className="p-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openRecovery(r)}
                      >
                        Reacomodar
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-2">Empresa</th>
                <th className="p-2 text-right">Contatos impactados</th>
                <th className="p-2 text-right">Perdas totais</th>
                <th className="p-2">Breakdown por motivo</th>
                <th className="p-2">Última perda</th>
              </tr>
            </thead>
            <tbody>
              {byCompany.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-muted-foreground">
                    Sem empresas afetadas nesse recorte.
                  </td>
                </tr>
              ) : (
                byCompany.map((c) => (
                  <tr key={c.company_id ?? "__none__"} className="border-t">
                    <td className="p-2">{c.company_trade_name ?? "—"}</td>
                    <td className="p-2 text-right">{c.contacts_impacted}</td>
                    <td className="p-2 text-right">
                      <Badge variant="destructive">{c.lost_total}</Badge>
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">
                      Admin: {c.by_source.admin_manual} · Auto-sanit:{" "}
                      {c.by_source.auto_sanitize_other_company} · Chegou antes:{" "}
                      {c.by_source.lost_to_earlier_booking} · Outro:{" "}
                      {c.by_source.other_technical}
                    </td>
                    <td className="p-2">{fmtDateTime(c.last_lost_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}