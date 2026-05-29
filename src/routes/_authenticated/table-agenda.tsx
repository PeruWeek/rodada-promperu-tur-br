import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Check, Download, Table2, User, X } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { formatSlotFull } from "@/components/booking-dialog";
import { meetingCheckIn } from "@/lib/checkin.functions";
import { buildAgendaPdf } from "@/lib/pdf";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/table-agenda")({
  component: TableAgendaPage,
});

function TableAgendaPage() {
  const { t, i18n } = useTranslation();
  const { data: profile } = useProfile();
  const qc = useQueryClient();
  const checkInFn = useServerFn(meetingCheckIn);

  const { data, isLoading } = useQuery({
    queryKey: ["table-agenda", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data: tbl } = await supabase
        .from("event_tables")
        .select("id, table_number")
        .eq("exhibitor_profile_id", profile!.id)
        .maybeSingle();
      if (!tbl) return { table: null, meetings: [] };
      const { data: meetings } = await supabase
        .from("meetings")
        .select("id, status, slot_id, visitor_profile_id")
        .eq("table_id", tbl.id)
        .in("status", ["scheduled", "done", "no_show"]);
      const slotIds = (meetings ?? []).map((m) => m.slot_id);
      const visIds = (meetings ?? []).map((m) => m.visitor_profile_id);
      const [{ data: slots }, { data: profs }] = await Promise.all([
        slotIds.length
          ? supabase.from("time_slots").select("id, start_at, end_at").in("id", slotIds)
          : Promise.resolve({ data: [] as Array<{ id: string; start_at: string; end_at: string }> }),
        visIds.length
          ? supabase.from("profiles").select("id, full_name, company_id").in("id", visIds)
          : Promise.resolve({ data: [] as Array<{ id: string; full_name: string; company_id: string | null }> }),
      ]);
      const compIds = (profs ?? []).map((p) => p.company_id).filter(Boolean) as string[];
      const { data: comps } = compIds.length
        ? await supabase.from("companies").select("id, trade_name, country_code, city").in("id", compIds)
        : { data: [] as Array<{ id: string; trade_name: string; country_code: string; city: string | null }> };
      const { data: checkins } = (meetings ?? []).length
        ? await supabase.from("meeting_checkins").select("meeting_id, status").in("meeting_id", (meetings ?? []).map((m) => m.id))
        : { data: [] as Array<{ meeting_id: string; status: string }> };
      const enriched = (meetings ?? []).map((m) => {
        const slot = slots?.find((s) => s.id === m.slot_id);
        const visitor = profs?.find((p) => p.id === m.visitor_profile_id);
        const company = comps?.find((c) => c.id === visitor?.company_id);
        const checkin = checkins?.find((c) => c.meeting_id === m.id) ?? null;
        return { ...m, slot, visitor, company, checkin };
      });
      enriched.sort((a, b) => (a.slot?.start_at ?? "").localeCompare(b.slot?.start_at ?? ""));
      return { table: tbl, meetings: enriched };
    },
  });

  const mut = useMutation({
    mutationFn: async (v: { meetingId: string; status: "present" | "no_show" }) =>
      checkInFn({ data: { meetingId: v.meetingId, status: v.status } }),
    onSuccess: () => {
      toast.success(t("tableAgenda.checkinSaved"));
      qc.invalidateQueries({ queryKey: ["table-agenda"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const downloadPdf = () => {
    if (!data?.meetings) return;
    const doc = buildAgendaPdf({
      title: t("tableAgenda.pdfTitle", { number: data.table?.table_number ?? "" }),
      subtitle: t("common.appName"),
      ownerName: profile?.full_name ?? "",
      generatedLabel: t("agenda.pdfGenerated", { date: new Date().toLocaleString(i18n.language === "es" ? "es" : "pt-BR") }),
      rows: data.meetings.map((m) => ({
        time: m.slot ? formatSlotFull(m.slot.start_at, i18n.language) : "—",
        withName: m.company?.trade_name ?? m.visitor?.full_name ?? "—",
        table: m.visitor?.full_name ?? "",
        location: [m.company?.city, m.company?.country_code].filter(Boolean).join(" · "),
      })),
    });
    doc.save(`agenda-mesa-${data.table?.table_number ?? "x"}.pdf`);
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-3 px-4 py-10">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!data?.table) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-3xl font-bold">{t("tableAgenda.title")}</h1>
        <Card className="mt-6 p-6 text-sm text-muted-foreground">{t("tableAgenda.noTable")}</Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-3xl font-bold">{t("tableAgenda.title")}</h1>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-sm">
            <Table2 size={14} className="mr-1" /> {t("explore.table")} {data.table.table_number}
          </Badge>
          <Button variant="outline" size="sm" onClick={downloadPdf} disabled={data.meetings.length === 0}>
            <Download size={14} /> {t("agenda.downloadPdf")}
          </Button>
        </div>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{t("tableAgenda.subtitle")}</p>

      {data.meetings.length === 0 ? (
        <Card className="mt-6 p-6 text-sm text-muted-foreground">{t("tableAgenda.empty")}</Card>
      ) : (
        <div className="mt-6 space-y-2">
          {data.meetings.map((m) => (
            <Card key={m.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-primary">
                  {m.slot ? formatSlotFull(m.slot.start_at, i18n.language) : "—"}
                </p>
                <p className="mt-0.5 truncate font-medium">{m.company?.trade_name ?? m.visitor?.full_name ?? "—"}</p>
                <p className="mt-0.5 text-xs text-muted-foreground inline-flex items-center gap-1">
                  <User size={12} />{m.visitor?.full_name}
                  {m.company?.city ? ` · ${m.company.city}` : ""}
                  {m.company?.country_code ? ` · ${m.company.country_code}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                {m.checkin ? (
                  <Badge variant={m.checkin.status === "no_show" ? "destructive" : "secondary"}>
                    {t(`tableAgenda.status.${m.checkin.status}`)}
                  </Badge>
                ) : m.status === "scheduled" ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => mut.mutate({ meetingId: m.id, status: "no_show" })}
                      disabled={mut.isPending}
                    >
                      <X size={14} /> {t("tableAgenda.noShow")}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => mut.mutate({ meetingId: m.id, status: "present" })}
                      disabled={mut.isPending}
                    >
                      <Check size={14} /> {t("tableAgenda.checkin")}
                    </Button>
                  </>
                ) : (
                  <Badge variant="secondary">{t(`agenda.status.${m.status}`)}</Badge>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}