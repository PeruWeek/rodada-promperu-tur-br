import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { getLiveOperations, suggestFillins } from "@/lib/checkin.functions";
import { bookMeetingForVisitor } from "@/lib/exhibitor-availability.functions";

export function FillinQueue() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const liveFn = useServerFn(getLiveOperations);
  const suggestFn = useServerFn(suggestFillins);
  const bookFn = useServerFn(bookMeetingForVisitor);

  const { data: live } = useQuery({
    queryKey: ["checkin-live"],
    queryFn: () => liveFn({ data: {} }),
    refetchInterval: 30_000,
  });

  const eventId = live?.eventId ?? null;
  const slotId = live?.slotCurrent?.id ?? null;

  const { data, isLoading } = useQuery({
    queryKey: ["checkin-fillins", eventId, slotId],
    enabled: !!eventId && !!slotId,
    queryFn: () => suggestFn({ data: { eventId: eventId!, slotId: slotId! } }),
    refetchInterval: 30_000,
  });

  const bookMut = useMutation({
    mutationFn: async (v: {
      visitorProfileId: string;
      tableId: string;
      slotId: string;
      eventId: string;
    }) => bookFn({ data: v }),
    onSuccess: () => {
      toast.success(t("admin.checkin.fillin.booked"));
      qc.invalidateQueries({ queryKey: ["checkin-live"] });
      qc.invalidateQueries({ queryKey: ["checkin-fillins"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!eventId || !slotId) {
    return (
      <Card className="p-5">
        <p className="text-sm font-medium">{t("admin.checkin.fillin.title")}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("admin.checkin.fillin.noSlot")}
        </p>
      </Card>
    );
  }

  const pairs = data?.pairs ?? [];

  return (
    <Card className="p-5">
      <div className="mb-4 space-y-1">
        <p className="text-sm font-medium">{t("admin.checkin.fillin.title")}</p>
        <p className="text-xs text-muted-foreground">
          {t("admin.checkin.fillin.subtitle")}
        </p>
      </div>
      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : pairs.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">
          {t("admin.checkin.fillin.empty")}
        </p>
      ) : (
        <div className="space-y-1.5">
          {pairs.map((p, i) => (
            <div
              key={`${p.visitorId}-${p.tableId}-${i}`}
              className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {p.visitorName ?? "—"}
                  <span className="text-muted-foreground"> → </span>
                  {p.exhibitorCompany ?? p.exhibitorName ?? "—"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {t("admin.checkin.fillin.table", { n: p.tableNumber ?? "—" })}
                  {p.visitorCompany ? ` · ${p.visitorCompany}` : ""}
                </p>
              </div>
              <Button
                size="sm"
                disabled={bookMut.isPending}
                onClick={() =>
                  bookMut.mutate({
                    visitorProfileId: p.visitorId,
                    tableId: p.tableId,
                    slotId: slotId!,
                    eventId: eventId!,
                  })
                }
              >
                <UserPlus size={14} /> {t("admin.checkin.fillin.book")}
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}