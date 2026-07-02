import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

import { formatSlotFull } from "@/components/booking-dialog";
import { BOOKING_INVALIDATE_KEYS } from "@/lib/booking-invalidate-keys";
import {
  bookMeetingForVisitor,
  listExhibitorAvailability,
  type ExhibitorAvailabilityRow,
} from "@/lib/exhibitor-availability.functions";
import type { RegistrantRow } from "@/lib/staff-exports.functions";

/**
 * Manual booking dialog anchored on a visitor registrant.
 *
 * Reuses the canonical server functions used by
 * `ExhibitorAvailabilityTab` (`listExhibitorAvailability` +
 * `bookMeetingForVisitor`), which already reapply all `bookMeeting` guards
 * (visitor time conflict, one-meeting-per-table, notifications and
 * confirmation email) and authorize admin/staff/cliente via
 * `assertOperator` server-side.
 *
 * No local status is derived. On success we invalidate the shared
 * `BOOKING_INVALIDATE_KEYS` set — the `Inscritos` badge then re-renders
 * from `bucketGroupFromMeetings(profile_meetings_count)` returned by the
 * refreshed `listEventRegistrants` query.
 */
export function BookForRegistrantDialog({
  target,
  onClose,
}: {
  target: RegistrantRow | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(listExhibitorAvailability);
  const bookFn = useServerFn(bookMeetingForVisitor);

  const [search, setSearch] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);

  const open = !!target;

  useEffect(() => {
    if (!open) {
      setSearch("");
      setSelectedCompanyId(null);
      setSelectedSlotId(null);
    }
  }, [open]);

  const { data, isLoading } = useQuery({
    queryKey: ["exhibitor-availability", "for-registrant"],
    enabled: open,
    // eventId omitido → servidor resolve com getCurrentEventIdWith.
    queryFn: () => listFn({ data: {} }),
  });

  const exhibitors = useMemo<ExhibitorAvailabilityRow[]>(() => {
    const rows = (data?.rows ?? []) as ExhibitorAvailabilityRow[];
    const eligible = rows.filter(
      (r) => r.status !== "lotada" && (r.free_slots?.length ?? 0) > 0,
    );
    const q = search.trim().toLowerCase();
    if (!q) return eligible;
    return eligible.filter((r) =>
      (r.trade_name ?? "").toLowerCase().includes(q),
    );
  }, [data, search]);

  const selectedExhibitor = useMemo(
    () => exhibitors.find((r) => r.company_id === selectedCompanyId) ?? null,
    [exhibitors, selectedCompanyId],
  );

  const mutation = useMutation({
    mutationFn: async () => {
      const eventId = data?.event_id ?? null;
      if (!target || !selectedExhibitor || !selectedSlotId || !eventId) {
        throw new Error("Seleção incompleta");
      }
      const slot = selectedExhibitor.free_slots.find(
        (s) => s.slot_id === selectedSlotId,
      );
      if (!slot) throw new Error("Slot inválido");
      return bookFn({
        data: {
          visitorProfileId: target.profile_id,
          slotId: slot.slot_id,
          tableId: slot.table_id,
          eventId,
        },
      });
    },
    onSuccess: () => {
      toast.success(t("availability.book.success"));
      for (const key of BOOKING_INVALIDATE_KEYS) {
        qc.invalidateQueries({ queryKey: key });
      }
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!target) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("admin.registrants.book.title")}</DialogTitle>
          <DialogDescription>
            {t("admin.registrants.book.subtitle", {
              name: target.full_name,
              company: target.company_trade_name,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Passo 1: expositor */}
          <div>
            <label className="mb-1 block text-xs font-medium">
              {t("admin.registrants.book.pickExhibitor")}
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("admin.registrants.book.searchPlaceholder")}
                className="pl-8"
              />
            </div>
            <div className="mt-2 max-h-[35vh] space-y-1 overflow-y-auto rounded-md border border-border p-1">
              {isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : exhibitors.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">
                  {t("admin.registrants.book.noExhibitors")}
                </p>
              ) : (
                exhibitors.map((r) => {
                  const active = selectedCompanyId === r.company_id;
                  return (
                    <button
                      type="button"
                      key={r.company_id}
                      onClick={() => {
                        setSelectedCompanyId(r.company_id);
                        setSelectedSlotId(null);
                      }}
                      className={`block w-full rounded-md px-2 py-1.5 text-left text-sm transition ${
                        active ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                      }`}
                    >
                      <p className="font-medium">{r.trade_name}</p>
                      <p className="text-xs opacity-80">
                        {r.free_slots.length} {t("availability.free", { count: r.free_slots.length })}
                        {r.city ? ` · ${r.city}` : ""}
                        {r.country_code ? ` · ${r.country_code}` : ""}
                      </p>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Passo 2: slot */}
          {selectedExhibitor && (
            <div>
              <label className="mb-1 block text-xs font-medium">
                {t("admin.registrants.book.pickSlot")}
              </label>
              <Select
                value={selectedSlotId ?? ""}
                onValueChange={(v) => setSelectedSlotId(v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("admin.registrants.book.pickSlot")} />
                </SelectTrigger>
                <SelectContent>
                  {selectedExhibitor.free_slots.map((s) => (
                    <SelectItem key={s.slot_id} value={s.slot_id}>
                      {formatSlotFull(s.start_at, i18n.language)} ·{" "}
                      {t("availability.tableLabel")} {s.table_number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={
              !selectedCompanyId || !selectedSlotId || mutation.isPending
            }
          >
            {mutation.isPending
              ? t("common.loading")
              : t("admin.registrants.book.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}