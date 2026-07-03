import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

import {
  listDedupeImpacted,
  suggestRecoverySlots,
  rebookImpacted,
  type DedupeImpactedRow,
  type RecoverySlotSuggestion,
} from "@/lib/dedupe-recovery.functions";
import { BOOKING_INVALIDATE_KEYS } from "@/lib/booking-invalidate-keys";

function fmtDateTime(iso: string) {
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

export function DedupeRecoveryTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listDedupeImpacted);
  const suggestFn = useServerFn(suggestRecoverySlots);
  const rebookFn = useServerFn(rebookImpacted);

  const [mode, setMode] = useState<"urgent" | "all">("urgent");
  const [view, setView] = useState<"contact" | "company">("contact");
  const [target, setTarget] = useState<DedupeImpactedRow | null>(null);

  const listQuery = useQuery({
    queryKey: ["dedupe-recovery", "list", mode],
    queryFn: () => listFn({ data: { mode } }),
  });

  const suggestionsQuery = useQuery({
    queryKey: ["dedupe-recovery", "suggestions", target?.profile_id],
    enabled: !!target?.profile_id,
    queryFn: () => suggestFn({ data: { profileId: target!.profile_id } }),
  });

  const rebookMutation = useMutation({
    mutationFn: async (slot: RecoverySlotSuggestion) => {
      if (!target) throw new Error("no target");
      return rebookFn({
        data: {
          profileId: target.profile_id,
          tableId: slot.table_id,
          slotId: slot.slot_id,
          source: slot.source,
          priorCancelledByDedupe: target.cancelled_by_dedupe,
        },
      });
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Reagendado com sucesso.");
        qc.invalidateQueries({ queryKey: ["dedupe-recovery"] });
        for (const k of BOOKING_INVALIDATE_KEYS) {
          qc.invalidateQueries({ queryKey: k as unknown as string[] });
        }
        setTarget(null);
      } else {
        toast.error(res.friendlyMessage);
        qc.invalidateQueries({
          queryKey: ["dedupe-recovery", "suggestions", target?.profile_id],
        });
      }
    },
    onError: () => {
      toast.error("Falha inesperada — a ação foi registrada. Tente outro slot.");
      qc.invalidateQueries({
        queryKey: ["dedupe-recovery", "suggestions", target?.profile_id],
      });
    },
  });

  const rows = listQuery.data?.by_contact ?? [];
  const companyRows = listQuery.data?.by_company ?? [];

  const summary = useMemo(() => {
    const contacts = rows.length;
    const cancelled = rows.reduce((s, r) => s + r.cancelled_by_dedupe, 0);
    return { contacts, cancelled };
  }, [rows]);

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div>
            <h2 className="text-lg font-semibold">Reacomodação por dedupe</h2>
            <p className="text-sm text-muted-foreground">
              Contatos que perderam reuniões pela regra "1 slot = 1 empresa".
              Reagenda usando o fluxo admin padrão.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => listQuery.refetch()}
            disabled={listQuery.isFetching}
          >
            <RefreshCw className="h-4 w-4 mr-2" /> Atualizar
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
            <TabsList>
              <TabsTrigger value="urgent">Urgentes (padrão)</TabsTrigger>
              <TabsTrigger value="all">Todos impactados</TabsTrigger>
            </TabsList>
          </Tabs>
          <Tabs value={view} onValueChange={(v) => setView(v as any)}>
            <TabsList>
              <TabsTrigger value="contact">Por contato</TabsTrigger>
              <TabsTrigger value="company">Por empresa</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="text-xs text-muted-foreground">
          {summary.contacts} contato(s) · {summary.cancelled} cancelada(s) por dedupe
          {mode === "urgent" && " (scheduled=1, histórico>1)"}
        </div>
      </Card>

      {listQuery.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : view === "contact" ? (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-2">Contato</th>
                <th className="p-2">Empresa</th>
                <th className="p-2">Email</th>
                <th className="p-2 text-right">Scheduled</th>
                <th className="p-2 text-right">Total</th>
                <th className="p-2 text-right">Canc. dedupe</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-muted-foreground">
                    Nenhum contato para reacomodar.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.profile_id} className="border-t">
                    <td className="p-2">{r.full_name ?? "—"}</td>
                    <td className="p-2">{r.company_trade_name ?? "—"}</td>
                    <td className="p-2">{r.email ?? "—"}</td>
                    <td className="p-2 text-right">{r.scheduled_count}</td>
                    <td className="p-2 text-right">{r.total_history}</td>
                    <td className="p-2 text-right">
                      <Badge variant="destructive">{r.cancelled_by_dedupe}</Badge>
                    </td>
                    <td className="p-2 text-right">
                      <Button size="sm" onClick={() => setTarget(r)}>
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
                <th className="p-2 text-right">Contatos</th>
                <th className="p-2 text-right">Scheduled</th>
                <th className="p-2 text-right">Histórico</th>
                <th className="p-2 text-right">Canc. dedupe</th>
              </tr>
            </thead>
            <tbody>
              {companyRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-muted-foreground">
                    Nenhuma empresa afetada.
                  </td>
                </tr>
              ) : (
                companyRows.map((r) => (
                  <tr key={r.company_id ?? "none"} className="border-t">
                    <td className="p-2">{r.company_trade_name ?? "—"}</td>
                    <td className="p-2 text-right">{r.contacts}</td>
                    <td className="p-2 text-right">{r.scheduled_total}</td>
                    <td className="p-2 text-right">{r.history_total}</td>
                    <td className="p-2 text-right">
                      <Badge variant="destructive">{r.cancelled_by_dedupe}</Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      )}

      <Sheet open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Reacomodar {target?.full_name ?? ""}</SheetTitle>
            <SheetDescription>
              {target?.company_trade_name ?? "—"} · {target?.email ?? ""}
            </SheetDescription>
          </SheetHeader>

          {!target ? null : suggestionsQuery.isLoading ? (
            <div className="mt-4 space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              {(suggestionsQuery.data?.suggestions ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum slot compatível encontrado no momento.
                </p>
              ) : (
                (suggestionsQuery.data?.suggestions ?? []).map((s) => (
                  <div
                    key={`${s.table_id}-${s.slot_id}`}
                    className="flex items-center justify-between gap-3 border rounded-md p-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            s.source === "same_company" ? "default" : "secondary"
                          }
                        >
                          {s.source === "same_company"
                            ? "Mesma empresa"
                            : "Livre"}
                        </Badge>
                        <span className="text-sm font-medium">
                          Mesa {s.table_number}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {s.exhibitor_company_name ?? "Expositor"} ·{" "}
                        {fmtDateTime(s.start_at)}
                        {s.colleague_name
                          ? ` · com ${s.colleague_name}`
                          : ""}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      disabled={rebookMutation.isPending}
                      onClick={() => rebookMutation.mutate(s)}
                    >
                      Reagendar
                    </Button>
                  </div>
                ))
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}