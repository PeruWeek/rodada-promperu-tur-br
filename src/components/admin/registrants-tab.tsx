import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Download, FileArchive, FileSpreadsheet, FileText, Files, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getParticipantAgenda,
  listEventRegistrants,
  listBulkAgendas,
  type RegistrantRow,
} from "@/lib/staff-exports.functions";
import { downloadBlob, toCsv } from "@/lib/exports/csv";
import { downloadXlsx } from "@/lib/exports/xlsx";
import { buildAgendaPdf } from "@/lib/pdf";
import { buildConsolidatedAgendaPdf, downloadAgendaZip } from "@/lib/exports/bulk-agenda";

type RoleFilter = "all" | "exhibitor" | "visitor";

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch {
    return "";
  }
}

function buildExportArrays(rows: RegistrantRow[], t: (k: string) => string) {
  const headers = [
    t("admin.registrants.cols.company"),
    t("admin.registrants.cols.legalName"),
    t("admin.registrants.cols.taxId"),
    t("admin.registrants.cols.role"),
    t("admin.registrants.cols.contact"),
    t("admin.registrants.cols.jobTitle"),
    t("admin.registrants.cols.email"),
    t("admin.registrants.cols.phone"),
    t("admin.registrants.cols.whatsapp"),
    t("admin.registrants.cols.country"),
    t("admin.registrants.cols.state"),
    t("admin.registrants.cols.city"),
    t("admin.registrants.cols.registrationStatus"),
    t("admin.registrants.cols.scheduledMeetings"),
    t("admin.registrants.cols.createdAt"),
  ];
  const data = rows.map((r) => [
    r.company_trade_name,
    r.company_legal_name ?? "",
    r.company_tax_id ?? "",
    r.role === "exhibitor"
      ? t("admin.companies.roleExhibitor")
      : t("admin.companies.roleVisitor"),
    r.full_name,
    r.job_title ?? "",
    r.email ?? "",
    r.phone ?? "",
    r.whatsapp ?? "",
    r.country_code ?? "",
    r.state_code ?? "",
    r.city ?? "",
    r.registration_status ?? "",
    r.scheduled_meetings_count,
    fmtDate(r.created_at),
  ]);
  return { headers, data };
}

export function RegistrantsTab() {
  const { t, i18n } = useTranslation();
  const listFn = useServerFn(listEventRegistrants);
  const agendaFn = useServerFn(getParticipantAgenda);
  const bulkFn = useServerFn(listBulkAgendas);
  const [role, setRole] = useState<RoleFilter>("all");
  const [search, setSearch] = useState("");
  const [agendaLoadingId, setAgendaLoadingId] = useState<string | null>(null);
  const [bulkLoading, setBulkLoading] = useState<null | "pdf" | "zip">(null);

  const { data, isLoading } = useQuery({
    queryKey: ["registrants", role, search],
    queryFn: () => listFn({ data: { role, search } }),
  });

  const rows = useMemo(() => data?.rows ?? [], [data]);

  const exportCsv = () => {
    if (rows.length === 0) return;
    const { headers, data } = buildExportArrays(rows, t);
    const csv = toCsv(headers, data);
    downloadBlob(
      `inscritos-${new Date().toISOString().slice(0, 10)}.csv`,
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
  };

  const exportXlsx = () => {
    if (rows.length === 0) return;
    const { headers, data } = buildExportArrays(rows, t);
    downloadXlsx(
      `inscritos-${new Date().toISOString().slice(0, 10)}.xlsx`,
      t("admin.registrants.sheetName"),
      headers,
      data,
    );
  };

  const downloadAgendaPdf = async (r: RegistrantRow) => {
    setAgendaLoadingId(r.profile_id);
    try {
      const res = await agendaFn({ data: { profileId: r.profile_id } });
      if (!res.rows || res.rows.length === 0) {
        toast.info(t("admin.registrants.noAgenda"));
        return;
      }
      const doc = buildAgendaPdf({
        title: t("agenda.pdfTitle"),
        subtitle: `${t("common.appName")} · ${r.company_trade_name}`,
        ownerName: res.profileName ?? r.full_name,
        rows: res.rows,
        generatedLabel: t("agenda.pdfGenerated", {
          date: new Date().toLocaleString(i18n.language === "es" ? "es" : "pt-BR"),
        }),
      });
      const safe = (s: string) => s.replace(/[^a-z0-9-_]+/gi, "_").slice(0, 80);
      doc.save(`agenda-${safe(r.full_name)}.pdf`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAgendaLoadingId(null);
    }
  };

  const dateLabel = () =>
    t("agenda.pdfGenerated", {
      date: new Date().toLocaleString(i18n.language === "es" ? "es" : "pt-BR"),
    });

  const downloadConsolidatedPdf = async () => {
    if (rows.length === 0) return;
    setBulkLoading("pdf");
    try {
      const res = await bulkFn({ data: { profileIds: rows.map((r) => r.profile_id) } });
      const nonEmpty = res.entries.filter((e) => e.rows.length > 0);
      if (nonEmpty.length === 0) {
        toast.info(t("admin.registrants.bulk.empty"));
        return;
      }
      const doc = buildConsolidatedAgendaPdf({
        title: t("agenda.pdfTitle"),
        subtitle: t("common.appName"),
        generatedLabel: dateLabel(),
        emptyLabel: t("admin.registrants.noAgenda"),
        entries: nonEmpty,
      });
      doc.save(`agendas-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBulkLoading(null);
    }
  };

  const downloadZip = async () => {
    if (rows.length === 0) return;
    setBulkLoading("zip");
    try {
      const res = await bulkFn({ data: { profileIds: rows.map((r) => r.profile_id) } });
      await downloadAgendaZip({
        title: t("agenda.pdfTitle"),
        subtitle: t("common.appName"),
        generatedLabel: dateLabel(),
        entries: res.entries,
        filename: `agendas-${new Date().toISOString().slice(0, 10)}.zip`,
      });
    } catch (e) {
      if ((e as Error).message === "EMPTY") {
        toast.info(t("admin.registrants.bulk.empty"));
      } else {
        toast.error((e as Error).message);
      }
    } finally {
      setBulkLoading(null);
    }
  };

  return (
    <Card className="p-5">
      <p className="mb-4 text-xs text-muted-foreground">{t("admin.registrants.help")}</p>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search
            className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            size={14}
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("admin.registrants.searchPlaceholder")}
            className="pl-8"
          />
        </div>
        <Select value={role} onValueChange={(v) => setRole(v as RoleFilter)}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("admin.companies.roleAll")}</SelectItem>
            <SelectItem value="exhibitor">{t("admin.companies.roleExhibitor")}</SelectItem>
            <SelectItem value="visitor">{t("admin.companies.roleVisitor")}</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={exportXlsx} disabled={rows.length === 0}>
          <FileSpreadsheet size={14} /> XLSX
        </Button>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
          <FileText size={14} /> CSV
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={downloadConsolidatedPdf}
          disabled={rows.length === 0 || bulkLoading !== null}
        >
          <Files size={14} />{" "}
          {bulkLoading === "pdf" ? t("common.loading") : t("admin.registrants.bulk.pdf")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={downloadZip}
          disabled={rows.length === 0 || bulkLoading !== null}
        >
          <FileArchive size={14} />{" "}
          {bulkLoading === "zip" ? t("common.loading") : t("admin.registrants.bulk.zip")}
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {t("admin.registrants.empty")}
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div
              key={r.profile_id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.company_trade_name}</span>
                  <Badge variant={r.role === "exhibitor" ? "default" : "secondary"}>
                    {r.role === "exhibitor"
                      ? t("admin.companies.roleExhibitor")
                      : t("admin.companies.roleVisitor")}
                  </Badge>
                  {r.scheduled_meetings_count > 0 && (
                    <Badge variant="outline">
                      {t("admin.registrants.meetingsCount", {
                        count: r.scheduled_meetings_count,
                      })}
                    </Badge>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {r.full_name}
                  {r.email ? ` · ${r.email}` : ""}
                  {[r.city, r.state_code, r.country_code].filter(Boolean).length > 0
                    ? ` · ${[r.city, r.state_code, r.country_code].filter(Boolean).join(" / ")}`
                    : ""}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={agendaLoadingId === r.profile_id}
                onClick={() => downloadAgendaPdf(r)}
              >
                <Download size={14} />{" "}
                {agendaLoadingId === r.profile_id
                  ? t("common.loading")
                  : t("admin.registrants.downloadAgenda")}
              </Button>
            </div>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {t("admin.registrants.total", { count: rows.length })}
        </p>
      )}
    </Card>
  );
}