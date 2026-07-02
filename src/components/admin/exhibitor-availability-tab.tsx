import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CalendarPlus, Clock, Search, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { formatSlotFull } from "@/components/booking-dialog";
import {
  bookMeetingForVisitor,
  listExhibitorAvailability,
  type ExhibitorAvailabilityRow,
  type ExhibitorAvailabilityStatus,
  type FreeSlot,
} from "@/lib/exhibitor-availability.functions";
import { listEventRegistrants } from "@/lib/staff-exports.functions";
import { BOOKING_INVALIDATE_KEYS } from "@/lib/booking-invalidate-keys";

type StatusFilter =
  | "all"
  | "com_agendamento"
  | "sem_agendamento"
  | "com_vaga"
  | "lotada";


function statusBadge(status: ExhibitorAvailabilityStatus, t: (k: string) => string) {
  switch (status) {
    case "lotada":
      return <Badge variant="secondary">{t("availability.status.lotada")}</Badge>;
    case "com_agendamento":
      return <Badge>{t("availability.status.com_agendamento")}</Badge>;
    case "sem_agendamento":
      return <Badge variant="outline">{t("availability.status.sem_agendamento")}</Badge>;
  }
}

export function ExhibitorAvailabilityTab() {
  const { t, i18n } = useTranslation();
  const listFn = useServerFn(listExhibitorAvailability);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [slotsDialog, setSlotsDialog] = useState<ExhibitorAvailabilityRow | null>(null);
  const [bookingDialog, setBookingDialog] = useState<{
    row: ExhibitorAvailabilityRow;
    slot?: FreeSlot;
  } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["exhibitor-availability"],
    queryFn: () => listFn({ data: {} }),
  });

  const rows = data?.rows ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !r.trade_name.toLowerCase().includes(q)) return false;
      if (status === "all") return true;
      if (status === "com_vaga") return r.slots_free > 0;
      return r.status === status;
    });
  }, [rows, search, status]);

  const kpis = useMemo(() => {
    const total = rows.length;
    const comAgenda = rows.filter((r) => r.slots_booked > 0).length;
    const comVaga = rows.filter((r) => r.slots_free > 0).length;
    const slotsLivres = rows.reduce((s, r) => s + r.slots_free, 0);
    return { total, comAgenda, comVaga, slotsLivres };
  }, [rows]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (error) {
    return (
      <Card className="p-5 text-sm text-destructive">
        {(error as Error).message}
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label={t("availability.kpi.total")} value={kpis.total} />
        <Kpi label={t("availability.kpi.withMeetings")} value={kpis.comAgenda} />
        <Kpi label={t("availability.kpi.withFree")} value={kpis.comVaga} />
        <Kpi label={t("availability.kpi.freeSlots")} value={kpis.slotsLivres} />
      </div>

      {/* Filtros */}
      <Card className="p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("availability.searchPlaceholder")}
              className="pl-8"
            />
          </div>
          <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("availability.filter.all")}</SelectItem>
              <SelectItem value="com_vaga">{t("availability.filter.com_vaga")}</SelectItem>
              <SelectItem value="com_agendamento">{t("availability.status.com_agendamento")}</SelectItem>
              <SelectItem value="sem_agendamento">{t("availability.status.sem_agendamento")}</SelectItem>
              <SelectItem value="lotada">{t("availability.status.lotada")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Lista */}
      {filtered.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">
          {t("availability.empty")}
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => {
            const preview = r.free_slots.slice(0, 3);
            const full = r.status === "lotada";
            return (
              <Card key={r.company_id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{r.trade_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {`${t("availability.tableLabel")}: ${r.table_numbers_label}`}
                      {r.city ? ` · ${r.city}` : ""}
                      {r.country_code ? ` · ${r.country_code}` : ""}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      {statusBadge(r.status, t)}
                      <span className="text-muted-foreground">
                        {t("availability.booked", { count: r.slots_booked })}
                      </span>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-muted-foreground">
                        {t("availability.free", { count: r.slots_free })}
                      </span>
                    </div>
                    {preview.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {preview.map((s) => (
                          <button
                            key={s.slot_id}
                            type="button"
                            onClick={() => setBookingDialog({ row: r, slot: s })}
                            className="rounded-md border border-border px-2 py-1 text-xs hover:border-primary hover:bg-accent"
                            title={t("availability.bookThisSlot")}
                          >
                            <Clock size={10} className="mr-1 inline" />
                            {formatSlotFull(s.start_at, i18n.language)}
                          </button>
                        ))}
                        {r.free_slots.length > preview.length && (
                          <button
                            type="button"
                            onClick={() => setSlotsDialog(r)}
                            className="rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary"
                          >
                            {t("availability.seeAll", { n: r.free_slots.length })}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => setSlotsDialog(r)}>
                      <Clock size={14} /> {t("availability.seeSlots")}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => setBookingDialog({ row: r })}
                      disabled={full}
                    >
                      <CalendarPlus size={14} /> {t("availability.scheduleVisitor")}
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <SlotsDialog row={slotsDialog} onClose={() => setSlotsDialog(null)} onBook={(row, slot) => {
        setSlotsDialog(null);
        setBookingDialog({ row, slot });
      }} />

      <ManualBookingDialog
        payload={bookingDialog}
        eventId={data?.event_id ?? null}
        onClose={() => setBookingDialog(null)}
      />
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </Card>
  );
}

function SlotsDialog({
  row,
  onClose,
  onBook,
}: {
  row: ExhibitorAvailabilityRow | null;
  onClose: () => void;
  onBook: (row: ExhibitorAvailabilityRow, slot: FreeSlot) => void;
}) {
  const { t, i18n } = useTranslation();
  if (!row) return null;

  const allSlots = [
    ...row.free_slots.map((s) => ({ ...s, kind: "free" as const })),
    ...row.booked_slots.map((s) => ({ ...s, kind: "booked" as const })),
  ].sort((a, b) => a.start_at.localeCompare(b.start_at));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{row.trade_name}</DialogTitle>
          <DialogDescription>
            {t("availability.slotsDialog.subtitle", { table: row.table_numbers_label })}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          {allSlots.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">{t("availability.slotsDialog.empty")}</p>
          ) : (
            <div className="space-y-1">
              {allSlots.map((s) => (
                <div
                  key={s.slot_id + s.table_id}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {formatSlotFull(s.start_at, i18n.language)}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {t("availability.tableLabel")} {s.table_number}
                      </span>
                    </p>
                    {s.kind === "booked" && (
                      <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
                        <Users size={12} /> {s.visitor_name}
                        {s.visitor_company_name ? ` · ${s.visitor_company_name}` : ""}
                      </p>
                    )}
                  </div>
                  {s.kind === "free" ? (
                    <Button size="sm" onClick={() => onBook(row, s as FreeSlot)}>
                      {t("availability.slotsDialog.book")}
                    </Button>
                  ) : (
                    <Badge variant="secondary">{t("availability.slotsDialog.booked")}</Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t("common.close", { defaultValue: "Fechar" })}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManualBookingDialog({
  payload,
  eventId,
  onClose,
}: {
  payload: { row: ExhibitorAvailabilityRow; slot?: FreeSlot } | null;
  eventId: string | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const listRegistrantsFn = useServerFn(listEventRegistrants);
  const bookFn = useServerFn(bookMeetingForVisitor);

  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(
    payload?.slot?.slot_id ?? null,
  );
  const [visitorSearch, setVisitorSearch] = useState("");

  // Sincroniza slot inicial quando payload muda
  useMemo(() => {
    setSelectedSlotId(payload?.slot?.slot_id ?? null);
    setSelectedProfileId(null);
    setVisitorSearch("");
  }, [payload?.row.company_id, payload?.slot?.slot_id]);

  const { data: registrantsData, isLoading: loadingRegs } = useQuery({
    queryKey: ["registrants", "visitor", "manual-booking"],
    enabled: !!payload,
    // sem eventId → servidor resolve pelo evento atual (helper canônico)
    queryFn: () =>
      listRegistrantsFn({
        data: { role: "visitor", unrestrictedCliente: true },
      }),
  });

  const visitors = useMemo(() => {
    const rows: any[] = (registrantsData?.rows as any[]) ?? [];
    const q = visitorSearch.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (!q) return true;
        return (
          (r.company_trade_name ?? "").toLowerCase().includes(q) ||
          (r.full_name ?? "").toLowerCase().includes(q) ||
          (r.email ?? "").toLowerCase().includes(q)
        );
      })
      .slice(0, 50);
  }, [registrantsData, visitorSearch]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!payload || !selectedProfileId || !selectedSlotId || !eventId) {
        throw new Error("Seleção incompleta");
      }
      const slot =
        payload.row.free_slots.find((s) => s.slot_id === selectedSlotId) ?? payload.slot;
      if (!slot) throw new Error("Slot inválido");
      return bookFn({
        data: {
          visitorProfileId: selectedProfileId,
          slotId: slot.slot_id,
          tableId: slot.table_id,
          eventId,
        },
      });
    },
    onSuccess: () => {
      toast.success(t("availability.book.success"));
      for (const key of BOOKING_INVALIDATE_KEYS) qc.invalidateQueries({ queryKey: key });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!payload) return null;
  const row = payload.row;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("availability.book.title")}</DialogTitle>
          <DialogDescription>
            {t("availability.book.subtitle", { name: row.trade_name })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Slot */}
          <div>
            <label className="mb-1 block text-xs font-medium">{t("availability.book.slot")}</label>
            <Select
              value={selectedSlotId ?? ""}
              onValueChange={(v) => setSelectedSlotId(v)}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("availability.book.pickSlot")} />
              </SelectTrigger>
              <SelectContent>
                {row.free_slots.map((s) => (
                  <SelectItem key={s.slot_id} value={s.slot_id}>
                    {formatSlotFull(s.start_at, i18n.language)} · {t("availability.tableLabel")} {s.table_number}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Visitor */}
          <div>
            <label className="mb-1 block text-xs font-medium">{t("availability.book.visitor")}</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={visitorSearch}
                onChange={(e) => setVisitorSearch(e.target.value)}
                placeholder={t("availability.book.visitorSearchPlaceholder")}
                className="pl-8"
              />
            </div>
            <div className="mt-2 max-h-[40vh] space-y-1 overflow-y-auto rounded-md border border-border p-1">
              {loadingRegs ? (
                <Skeleton className="h-24 w-full" />
              ) : visitors.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">{t("availability.book.noVisitors")}</p>
              ) : (
                visitors.map((v) => {
                    const active = selectedProfileId === v.profile_id;
                  return (
                    <button
                      type="button"
                      key={v.profile_id}
                      disabled={!v.profile_id}
                      onClick={() => setSelectedProfileId(v.profile_id)}
                      className={`block w-full rounded-md px-2 py-1.5 text-left text-sm transition ${
                        active ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                      } ${!v.profile_id ? "opacity-50" : ""}`}
                    >
                      <p className="font-medium">{v.full_name ?? "—"}</p>
                      <p className="text-xs opacity-80">
                        {v.company_trade_name ?? "—"}
                        {v.city ? ` · ${v.city}` : ""}
                        {v.country_code ? ` · ${v.country_code}` : ""}
                      </p>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={
              !selectedProfileId ||
              !selectedSlotId ||
              !eventId ||
              mutation.isPending
            }
          >
            {mutation.isPending ? t("common.loading") : t("availability.book.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}