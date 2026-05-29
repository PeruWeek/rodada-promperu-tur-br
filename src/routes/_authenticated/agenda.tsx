import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Calendar, MapPin, Table2, X } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { cancelMeeting } from "@/lib/booking.functions";
import { formatSlotFull } from "@/components/booking-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/agenda")({
  component: AgendaPage,
});

function AgendaPage() {
  const { t, i18n } = useTranslation();
  const { data: profile } = useProfile();
  const qc = useQueryClient();
  const cancelFn = useServerFn(cancelMeeting);

  const { data: meetings, isLoading } = useQuery({
    queryKey: ["my-agenda", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data: m } = await supabase
        .from("meetings")
        .select("id, status, table_id, slot_id, event_id")
        .eq("visitor_profile_id", profile!.id)
        .order("created_at");
      if (!m || m.length === 0) return [];
      const slotIds = m.map((x) => x.slot_id);
      const tableIds = m.map((x) => x.table_id);
      const [{ data: slots }, { data: tables }] = await Promise.all([
        supabase.from("time_slots").select("id, start_at, end_at").in("id", slotIds),
        supabase.from("event_tables").select("id, table_number, exhibitor_profile_id").in("id", tableIds),
      ]);
      const exhProfileIds = (tables ?? []).map((t) => t.exhibitor_profile_id).filter(Boolean) as string[];
      const { data: profs } = exhProfileIds.length
        ? await supabase.from("profiles").select("id, full_name, company_id").in("id", exhProfileIds)
        : { data: [] as Array<{ id: string; full_name: string; company_id: string | null }> };
      const companyIds = (profs ?? []).map((p) => p.company_id).filter(Boolean) as string[];
      const { data: comps } = companyIds.length
        ? await supabase.from("companies").select("id, trade_name, country_code").in("id", companyIds)
        : { data: [] as Array<{ id: string; trade_name: string; country_code: string }> };
      return m.map((mtg) => {
        const slot = slots?.find((s) => s.id === mtg.slot_id);
        const tbl = tables?.find((t) => t.id === mtg.table_id);
        const exh = profs?.find((p) => p.id === tbl?.exhibitor_profile_id);
        const comp = comps?.find((c) => c.id === exh?.company_id);
        return { ...mtg, slot, table: tbl, exhibitor: exh, company: comp };
      });
    },
  });

  const cancelMut = useMutation({
    mutationFn: async (meetingId: string) => cancelFn({ data: { meetingId } }),
    onSuccess: () => {
      toast.success(t("agenda.cancelled"));
      qc.invalidateQueries({ queryKey: ["my-agenda"] });
    },
    onError: () => toast.error(t("agenda.cancelError")),
  });

  const scheduled = (meetings ?? [])
    .filter((m) => m.status === "scheduled")
    .sort((a, b) => (a.slot?.start_at ?? "").localeCompare(b.slot?.start_at ?? ""));
  const others = (meetings ?? []).filter((m) => m.status !== "scheduled");

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{t("agenda.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("agenda.subtitle")}</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/explore">{t("agenda.exploreCta")}</Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="mt-6 space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : scheduled.length === 0 && others.length === 0 ? (
        <Card className="mt-8 p-8 text-center">
          <Calendar className="mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t("agenda.empty")}</p>
          <Button asChild className="mt-4">
            <Link to="/explore">{t("agenda.exploreCta")}</Link>
          </Button>
        </Card>
      ) : (
        <div className="mt-6 space-y-3">
          {scheduled.map((m) => (
            <Card key={m.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-primary">
                  {m.slot ? formatSlotFull(m.slot.start_at, i18n.language) : "—"}
                </p>
                <p className="mt-0.5 truncate font-medium">{m.company?.trade_name ?? m.exhibitor?.full_name ?? "—"}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {m.table?.table_number != null && (
                    <span className="inline-flex items-center gap-1"><Table2 size={12} />{t("explore.table")} {m.table.table_number}</span>
                  )}
                  {m.company?.country_code && (
                    <span className="inline-flex items-center gap-1"><MapPin size={12} />{m.company.country_code}</span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                {m.exhibitor?.id && (
                  <Button asChild variant="ghost" size="sm">
                    <Link to="/exhibitor/$id" params={{ id: m.exhibitor.id }}>{t("explore.viewDetails")}</Link>
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => cancelMut.mutate(m.id)}
                  disabled={cancelMut.isPending}
                >
                  <X size={14} /> {t("agenda.cancel")}
                </Button>
              </div>
            </Card>
          ))}
          {others.length > 0 && (
            <>
              <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("agenda.history")}</h2>
              {others.map((m) => (
                <Card key={m.id} className="flex items-center justify-between p-3 opacity-70">
                  <div>
                    <p className="text-sm">{m.company?.trade_name ?? m.exhibitor?.full_name ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">{m.slot ? formatSlotFull(m.slot.start_at, i18n.language) : ""}</p>
                  </div>
                  <Badge variant="secondary">{t(`agenda.status.${m.status}`)}</Badge>
                </Card>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}