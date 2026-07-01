import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Check, Download, Table2, User, X } from "lucide-react";
import { toast } from "sonner";

import { formatSlotFull } from "@/components/booking-dialog";
import { meetingCheckIn } from "@/lib/checkin.functions";
import { getMyTableAgenda } from "@/lib/table-agenda.functions";
import { buildAgendaPdf } from "@/lib/pdf";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useProfile } from "@/hooks/use-profile";

export const Route = createFileRoute("/_authenticated/table-agenda")({
  component: TableAgendaPage,
});

function TableAgendaPage() {
  const { t, i18n } = useTranslation();
  const { data: profile } = useProfile();
  const qc = useQueryClient();
  const checkInFn = useServerFn(meetingCheckIn);
  const agendaFn = useServerFn(getMyTableAgenda);

  const { data, isLoading } = useQuery({
    queryKey: ["table-agenda", profile?.id],
    enabled: !!profile,
    queryFn: () => agendaFn({ data: undefined as never }),
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
    if (!data?.rows) return;
    const doc = buildAgendaPdf({
      title: t("tableAgenda.pdfTitle", { number: data.table?.table_number ?? "" }),
      subtitle: t("common.appName"),
      ownerName: profile?.full_name ?? "",
      generatedLabel: t("agenda.pdfGenerated", { date: new Date().toLocaleString(i18n.language === "es" ? "es" : "pt-BR") }),
      rows: data.rows.map((m) => ({
        time: m.start_at ? formatSlotFull(m.start_at, i18n.language) : "—",
        withName: m.company_name ?? m.visitor_name ?? "—",
        table: m.visitor_name ?? "",
        location: [m.city, m.country_code].filter(Boolean).join(" · "),
        website: m.company_website ?? null,
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
          <Button variant="outline" size="sm" onClick={downloadPdf} disabled={data.rows.length === 0}>
            <Download size={14} /> {t("agenda.downloadPdf")}
          </Button>
        </div>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{t("tableAgenda.subtitle")}</p>

      {data.rows.length === 0 ? (
        <Card className="mt-6 p-6 text-sm text-muted-foreground">{t("tableAgenda.empty")}</Card>
      ) : (
        <div className="mt-6 space-y-2">
          {data.rows.map((m) => (
            <Card key={m.meeting_id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-primary">
                  {m.start_at ? formatSlotFull(m.start_at, i18n.language) : "—"}
                </p>
                <p className="mt-0.5 truncate font-medium">{m.company_name ?? m.visitor_name ?? "—"}</p>
                {m.company_website ? (
                  <a
                    href={/^https?:\/\//i.test(m.company_website) ? m.company_website : `https://${m.company_website}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 block truncate text-xs text-muted-foreground/80 hover:text-primary hover:underline"
                  >
                    {m.company_website}
                  </a>
                ) : null}
                <p className="mt-0.5 text-xs text-muted-foreground inline-flex items-center gap-1">
                  <User size={12} />{m.visitor_name}
                  {m.city ? ` · ${m.city}` : ""}
                  {m.country_code ? ` · ${m.country_code}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                {m.checkin_status ? (
                  <Badge variant={m.checkin_status === "no_show" ? "destructive" : "secondary"}>
                    {t(`tableAgenda.status.${m.checkin_status}`)}
                  </Badge>
                ) : m.status === "scheduled" ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => mut.mutate({ meetingId: m.meeting_id, status: "no_show" })}
                      disabled={mut.isPending}
                    >
                      <X size={14} /> {t("tableAgenda.noShow")}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => mut.mutate({ meetingId: m.meeting_id, status: "present" })}
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