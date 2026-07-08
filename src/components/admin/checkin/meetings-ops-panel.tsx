import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertTriangle, Check, Clock, Search, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

import { listMeetingsForOps, meetingCheckIn, type MeetingOpsRow } from "@/lib/checkin.functions";

function fmtTime(iso: string | null, locale: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(locale === "es" ? "es" : "pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadge(row: MeetingOpsRow, t: (k: string) => string) {
  if (row.checkinStatus === "present")
    return <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">{t("admin.checkin.meetings.status.present")}</Badge>;
  if (row.checkinStatus === "late")
    return (
      <Badge className="bg-amber-500 text-white hover:bg-amber-500">
        {t("admin.checkin.meetings.status.late")}
        {row.lateMinutes ? ` · +${row.lateMinutes}min` : ""}
      </Badge>
    );
  if (row.checkinStatus === "no_show")
    return <Badge variant="destructive">{t("admin.checkin.meetings.status.no_show")}</Badge>;
  return <Badge variant="secondary">{t("admin.checkin.meetings.status.pending")}</Badge>;
}

export function MeetingsOpsPanel() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(listMeetingsForOps);
  const checkFn = useServerFn(meetingCheckIn);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "done">("all");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-meetings-ops"],
    queryFn: () => listFn({ data: {} }),
    refetchInterval: 30_000,
  });

  const rows = useMemo(() => {
    let list = data?.rows ?? [];
    if (filter === "pending") list = list.filter((r) => !r.checkinStatus);
    if (filter === "done") list = list.filter((r) => !!r.checkinStatus);
    const term = q.trim().toLowerCase();
    if (term) {
      list = list.filter((r) =>
        [r.visitorName, r.visitorCompany, r.exhibitorName, r.exhibitorCompany, r.tableNumber?.toString()]
          .filter(Boolean)
          .join(" | ")
          .toLowerCase()
          .includes(term),
      );
    }
    return list;
  }, [data?.rows, filter, q]);

  const mut = useMutation({
    mutationFn: async (v: { meetingId: string; status: "present" | "late" | "no_show" }) =>
      checkFn({ data: v }),
    onSuccess: (_r, v) => {
      toast.success(t(`admin.checkin.meetings.saved.${v.status}`));
      qc.invalidateQueries({ queryKey: ["admin-meetings-ops"] });
      qc.invalidateQueries({ queryKey: ["checkin-live"] });
      qc.invalidateQueries({ queryKey: ["checkin-postevent"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const counts = useMemo(() => {
    const list = data?.rows ?? [];
    return {
      total: list.length,
      pending: list.filter((r) => !r.checkinStatus).length,
      done: list.filter((r) => !!r.checkinStatus).length,
    };
  }, [data?.rows]);

  return (
    <Card className="p-5">
      <div className="mb-4 space-y-1">
        <p className="text-sm font-medium">{t("admin.checkin.meetings.title")}</p>
        <p className="text-xs text-muted-foreground">{t("admin.checkin.meetings.subtitle")}</p>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>
          {t("admin.checkin.meetings.filter.all")} · {counts.total}
        </Button>
        <Button size="sm" variant={filter === "pending" ? "default" : "outline"} onClick={() => setFilter("pending")}>
          {t("admin.checkin.meetings.filter.pending")} · {counts.pending}
        </Button>
        <Button size="sm" variant={filter === "done" ? "default" : "outline"} onClick={() => setFilter("done")}>
          {t("admin.checkin.meetings.filter.done")} · {counts.done}
        </Button>
      </div>

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("admin.checkin.meetings.searchPlaceholder")}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t("admin.checkin.meetings.empty")}
        </p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => {
            const late = !r.checkinStatus && r.slotStart && Date.now() - new Date(r.slotStart).getTime() > 5 * 60_000;
            return (
              <div
                key={r.meetingId}
                className={`flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between ${
                  late ? "border-red-200 bg-red-50/40 dark:border-red-900 dark:bg-red-950/20" : "border-border"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-primary">
                      {fmtTime(r.slotStart, i18n.language)}–{fmtTime(r.slotEnd, i18n.language)}
                    </p>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {t("admin.checkin.fillin.table", { n: r.tableNumber ?? "—" })}
                    </Badge>
                    {late ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-red-600">
                        <AlertTriangle size={12} />
                        {t("admin.checkin.meetings.risk")}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-sm">
                    <span className="font-medium">{r.visitorName ?? "—"}</span>
                    <span className="text-muted-foreground"> · {r.visitorCompany ?? "—"}</span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    × {r.exhibitorCompany ?? r.exhibitorName ?? "—"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {statusBadge(r, t)}
                  <Button
                    size="sm"
                    variant={r.checkinStatus === "present" ? "default" : "outline"}
                    onClick={() => mut.mutate({ meetingId: r.meetingId, status: "present" })}
                    disabled={mut.isPending}
                    title={t("admin.checkin.meetings.actions.present")}
                  >
                    <Check size={14} /> {t("admin.checkin.meetings.actions.present")}
                  </Button>
                  <Button
                    size="sm"
                    variant={r.checkinStatus === "late" ? "default" : "outline"}
                    onClick={() => mut.mutate({ meetingId: r.meetingId, status: "late" })}
                    disabled={mut.isPending}
                    title={t("admin.checkin.meetings.actions.late")}
                  >
                    <Clock size={14} /> {t("admin.checkin.meetings.actions.late")}
                  </Button>
                  <Button
                    size="sm"
                    variant={r.checkinStatus === "no_show" ? "destructive" : "outline"}
                    onClick={() => mut.mutate({ meetingId: r.meetingId, status: "no_show" })}
                    disabled={mut.isPending}
                    title={t("admin.checkin.meetings.actions.no_show")}
                  >
                    <X size={14} /> {t("admin.checkin.meetings.actions.no_show")}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}