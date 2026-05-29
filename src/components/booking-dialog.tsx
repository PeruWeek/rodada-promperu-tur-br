import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Calendar } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { bookMeeting } from "@/lib/booking.functions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

export function BookingDialog({
  exhibitorProfileId,
  exhibitorName,
  trigger,
}: {
  exhibitorProfileId: string;
  exhibitorName?: string | null;
  trigger?: React.ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const qc = useQueryClient();
  const book = useServerFn(bookMeeting);

  const { data, isLoading } = useQuery({
    queryKey: ["booking-slots", exhibitorProfileId],
    enabled: open,
    queryFn: async () => {
      // table for this exhibitor
      const { data: table } = await supabase
        .from("event_tables")
        .select("id, event_id, table_number")
        .eq("exhibitor_profile_id", exhibitorProfileId)
        .maybeSingle();
      if (!table) return { table: null, slots: [], taken: new Set<string>(), myBooked: new Set<string>() };

      const [{ data: slots }, { data: taken }, { data: me }] = await Promise.all([
        supabase
          .from("time_slots")
          .select("id, start_at, end_at")
          .eq("table_id", table.id)
          .eq("is_active", true)
          .order("start_at"),
        supabase
          .from("meetings")
          .select("slot_id")
          .eq("table_id", table.id)
          .eq("status", "scheduled"),
        supabase.auth.getUser(),
      ]);

      let myBooked = new Set<string>();
      if (me?.user) {
        const { data: myMeetings } = await supabase
          .from("meetings")
          .select("slot_id")
          .eq("status", "scheduled");
        myBooked = new Set((myMeetings ?? []).map((m) => m.slot_id));
      }

      return {
        table,
        slots: slots ?? [],
        taken: new Set((taken ?? []).map((m) => m.slot_id)),
        myBooked,
      };
    },
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!selectedSlot || !data?.table) throw new Error("missing");
      return book({
        data: {
          slotId: selectedSlot,
          tableId: data.table.id,
          eventId: data.table.event_id,
        },
      });
    },
    onSuccess: () => {
      toast.success(t("booking.success"));
      qc.invalidateQueries({ queryKey: ["booking-slots", exhibitorProfileId] });
      qc.invalidateQueries({ queryKey: ["my-agenda"] });
      setOpen(false);
      setSelectedSlot(null);
    },
    onError: (err: Error) => {
      const msg = err.message || "";
      if (msg.includes("Conflito") || msg.includes("23505")) {
        toast.error(t("booking.conflict"));
      } else {
        toast.error(t("booking.error"));
      }
    },
  });

  const grouped = useMemo(() => {
    if (!data?.slots) return [];
    type Slot = (typeof data.slots)[number];
    const out: { period: string; items: Slot[] }[] = [];
    const morning: Slot[] = [];
    const afternoon: Slot[] = [];
    for (const s of data.slots) {
      const h = new Date(s.start_at).getUTCHours();
      if (h < 18) morning.push(s);
      else afternoon.push(s);
    }
    if (morning.length) out.push({ period: t("booking.morning"), items: morning });
    if (afternoon.length) out.push({ period: t("booking.afternoon"), items: afternoon });
    return out;
  }, [data, t]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="lg" className="shrink-0">
            <Calendar size={16} /> {t("booking.schedule")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("booking.title")}</DialogTitle>
          <DialogDescription>
            {exhibitorName ? t("booking.subtitle", { name: exhibitorName }) : t("booking.subtitleGeneric")}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
        ) : !data?.table ? (
          <p className="py-6 text-sm text-muted-foreground">{t("booking.noTable")}</p>
        ) : data.slots.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">{t("booking.noSlots")}</p>
        ) : (
          <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
            {grouped.map((g) => (
              <div key={g.period}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.period}</p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {g.items.map((s) => {
                    const isTaken = data.taken.has(s.id);
                    const isMine = data.myBooked.has(s.id);
                    const disabled = isTaken || isMine;
                    const label = formatSlot(s.start_at, i18n.language);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => setSelectedSlot(s.id)}
                        className={`rounded-md border px-2 py-2 text-sm transition ${
                          selectedSlot === s.id
                            ? "border-primary bg-primary text-primary-foreground"
                            : disabled
                              ? "cursor-not-allowed border-border bg-muted text-muted-foreground line-through"
                              : "border-border hover:border-primary hover:bg-accent"
                        }`}
                        title={isMine ? t("booking.alreadyBookedSelf") : isTaken ? t("booking.taken") : undefined}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!selectedSlot || mutation.isPending}
          >
            {mutation.isPending ? t("common.loading") : t("booking.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function formatSlot(iso: string, lang: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString(lang === "es" ? "es" : "pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

export function formatSlotFull(iso: string, lang: string) {
  const d = new Date(iso);
  return d.toLocaleString(lang === "es" ? "es" : "pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}