import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertTriangle, Pencil, Undo2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { hasRole, useProfile } from "@/hooks/use-profile";
import {
  getLiveOperations,
  setAvailableForFillin,
  setCheckinNote,
  undoGeneralCheckIn,
} from "@/lib/checkin.functions";

import { KpiStrip, type LiveFilter } from "./kpi-strip";

function fmtTime(iso: string, locale: string) {
  return new Date(iso).toLocaleTimeString(locale === "es" ? "es" : "pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function LiveOpsPanel() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { data: me } = useProfile();
  const isAdmin = hasRole(me?.roles, "admin");

  const liveFn = useServerFn(getLiveOperations);
  const setAvailFn = useServerFn(setAvailableForFillin);
  const setNoteFn = useServerFn(setCheckinNote);
  const undoFn = useServerFn(undoGeneralCheckIn);

  const [filter, setFilter] = useState<LiveFilter>("all");
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [undoTarget, setUndoTarget] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["checkin-live"],
    queryFn: () => liveFn({ data: {} }),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const availMut = useMutation({
    mutationFn: async (v: { checkinId: string; value: boolean }) =>
      setAvailFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["checkin-live"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const noteMut = useMutation({
    mutationFn: async (v: { checkinId: string; note: string | null }) =>
      setNoteFn({ data: v }),
    onSuccess: () => {
      toast.success(t("admin.checkin.live.noteSaved"));
      setEditingNote(null);
      qc.invalidateQueries({ queryKey: ["checkin-live"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const undoMut = useMutation({
    mutationFn: async (checkinId: string) => undoFn({ data: { checkinId } }),
    onSuccess: () => {
      toast.success(t("admin.checkin.live.undoDone"));
      setUndoTarget(null);
      qc.invalidateQueries({ queryKey: ["checkin-live"] });
      qc.invalidateQueries({ queryKey: ["admin-checkin"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const kpis = data?.kpis ?? { present: 0, inMeeting: 0, idle: 0, atRisk: 0, freeTables: 0 };

  const inMeetingSet = useMemo(
    () => new Set(data?.inMeetingProfileIds ?? []),
    [data?.inMeetingProfileIds],
  );
  const idleSet = useMemo(
    () => new Set(data?.idleProfileIds ?? []),
    [data?.idleProfileIds],
  );

  const filteredProfiles = useMemo(() => {
    const list = data?.presentProfiles ?? [];
    if (filter === "all" || filter === "present") return list;
    if (filter === "inMeeting") return list.filter((p) => inMeetingSet.has(p.id));
    if (filter === "idle") return list.filter((p) => idleSet.has(p.id));
    return [];
  }, [data?.presentProfiles, filter, inMeetingSet, idleSet]);

  const showAtRisk = filter === "atRisk";
  const showFreeTables = filter === "freeTables";

  return (
    <Card className="p-5">
      <div className="mb-4 space-y-1">
        <p className="text-sm font-medium">{t("admin.checkin.live.title")}</p>
        <p className="text-xs text-muted-foreground">
          {t("admin.checkin.live.subtitle")}
        </p>
        <p className="text-xs text-muted-foreground">
          {data?.slotCurrent
            ? `${t("admin.checkin.kpi.slotCurrent")}: ${fmtTime(
                data.slotCurrent.start_at,
                i18n.language,
              )}–${fmtTime(data.slotCurrent.end_at, i18n.language)}`
            : t("admin.checkin.kpi.noSlot")}
          {data?.slotNext
            ? ` · ${t("admin.checkin.kpi.slotNext")}: ${fmtTime(
                data.slotNext.start_at,
                i18n.language,
              )}`
            : ""}
        </p>
      </div>

      <KpiStrip kpis={kpis} active={filter} onSelect={setFilter} />

      <div className="mt-4 space-y-1.5">
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : showAtRisk ? (
          (data?.atRiskMeetings ?? []).length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              {t("admin.checkin.live.empty")}
            </p>
          ) : (
            (data?.atRiskMeetings ?? []).map((m) => (
              <div
                key={m.meetingId}
                className="flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50/50 p-3 dark:border-red-900 dark:bg-red-950/20"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={14} className="text-red-600" />
                    <p className="truncate text-sm font-medium">
                      {m.visitorName ?? "—"}
                      {" × "}
                      {m.exhibitorCompany ?? "—"}
                    </p>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {t("admin.checkin.fillin.table", { n: m.tableNumber ?? "—" })}
                    {" · "}
                    {fmtTime(m.slotStart, i18n.language)}–
                    {fmtTime(m.slotEnd, i18n.language)}
                  </p>
                </div>
                <Badge variant="destructive" className="shrink-0">
                  {t("admin.checkin.live.atRiskLabel", { minutes: m.minutesLate })}
                </Badge>
              </div>
            ))
          )
        ) : showFreeTables ? (
          (data?.freeTables ?? []).length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              {t("admin.checkin.live.empty")}
            </p>
          ) : (
            (data?.freeTables ?? []).map((tb) => (
              <div
                key={tb.tableId}
                className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {t("admin.checkin.fillin.table", { n: tb.tableNumber ?? "—" })}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {tb.exhibitorCompany ?? tb.exhibitorName ?? "—"}
                  </p>
                </div>
              </div>
            ))
          )
        ) : filteredProfiles.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            {t("admin.checkin.live.empty")}
          </p>
        ) : (
          filteredProfiles.map((p) => {
            const roleKey = (p.role ?? "visitor") as
              | "visitor"
              | "exhibitor"
              | "staff"
              | "admin"
              | "cliente";
            const isInMeeting = inMeetingSet.has(p.id);
            const isEditing = editingNote === p.checkinId;
            return (
              <div
                key={p.checkinId}
                className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{p.full_name ?? "—"}</p>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {t(`admin.checkin.live.role.${roleKey}`)}
                    </Badge>
                    {isInMeeting ? (
                      <Badge className="shrink-0 bg-blue-600 text-white hover:bg-blue-600">
                        {t("admin.checkin.kpi.inMeeting")}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {[p.company, p.email].filter(Boolean).join(" · ")}
                  </p>
                  {p.note && !isEditing ? (
                    <p className="mt-1 truncate text-[11px] italic text-muted-foreground">
                      “{p.note}”
                    </p>
                  ) : null}
                  {isEditing ? (
                    <div className="mt-2 flex items-center gap-2">
                      <Input
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value.slice(0, 140))}
                        placeholder={t("admin.checkin.live.notePlaceholder")}
                        className="h-8 text-xs"
                      />
                      <Button
                        size="sm"
                        onClick={() =>
                          noteMut.mutate({
                            checkinId: p.checkinId,
                            note: noteDraft.trim() || null,
                          })
                        }
                        disabled={noteMut.isPending}
                      >
                        OK
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingNote(null)}
                      >
                        ✕
                      </Button>
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Switch
                      checked={p.availableForFillin}
                      onCheckedChange={(v) =>
                        availMut.mutate({ checkinId: p.checkinId, value: v })
                      }
                    />
                    <span className="hidden sm:inline">
                      {p.availableForFillin
                        ? t("admin.checkin.live.availableOn")
                        : t("admin.checkin.live.availableOff")}
                    </span>
                  </label>
                  {!isEditing ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingNote(p.checkinId);
                        setNoteDraft(p.note ?? "");
                      }}
                    >
                      <Pencil size={14} />
                      <span className="sr-only">
                        {p.note
                          ? t("admin.checkin.live.noteEdit")
                          : t("admin.checkin.live.noteAdd")}
                      </span>
                    </Button>
                  ) : null}
                  {isAdmin ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setUndoTarget(p.checkinId)}
                      title={t("admin.checkin.live.undo")}
                    >
                      <Undo2 size={14} />
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>

      <AlertDialog open={!!undoTarget} onOpenChange={(o) => !o && setUndoTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.checkin.live.undo")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.checkin.live.undoConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => undoTarget && undoMut.mutate(undoTarget)}
            >
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}