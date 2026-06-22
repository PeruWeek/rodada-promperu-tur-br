import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FileSpreadsheet, FileText, Files, Pencil, Search } from "lucide-react";

import { listAdminCompanies } from "@/lib/admin.functions";
import { downloadBlob, toCsv } from "@/lib/exports/csv";
import { downloadXlsx } from "@/lib/exports/xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
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
import { EditCompanyDrawer } from "./edit-company-drawer";
import { OrphanExhibitorsPanel } from "./orphan-exhibitors-panel";
import { UnpublishedExhibitorsPanel } from "./unpublished-exhibitors-panel";

type RoleFilter = "all" | "visitor" | "exhibitor";
type ConfirmedFilter = "all" | "yes" | "no";
type LunchFilter = "all" | "yes" | "no";

export function CompaniesTab({ readOnly = false }: { readOnly?: boolean } = {}) {
  const { t, i18n } = useTranslation();
  const listFn = useServerFn(listAdminCompanies);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<RoleFilter>(readOnly ? "visitor" : "all");
  const [confirmed, setConfirmed] = useState<ConfirmedFilter>(readOnly ? "yes" : "all");
  const [lunch, setLunch] = useState<LunchFilter>("all");
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<null | "xlsx" | "csv" | "pdf">(null);

  const effectiveRole: RoleFilter = readOnly ? "visitor" : role;
  const effectiveConfirmed: ConfirmedFilter = readOnly ? "yes" : confirmed;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-companies", search, effectiveRole, effectiveConfirmed, lunch, page, readOnly],
    queryFn: () =>
      listFn({
        data: {
          search,
          role: effectiveRole,
          confirmed: effectiveConfirmed,
          lunch,
          page,
          pageSize: 25,
          activeOnly: readOnly,
        },
      }),
  });

  const headers = [
    "Empresa",
    "Razão social",
    "Tipo",
    "Status",
    "Cidade",
    "UF",
    "País",
    "Contato",
    "E-mail",
    "WhatsApp",
    "Almoço de networking",
  ];

  const fetchAll = async () => {
    const res = await listFn({
      data: {
        search,
        role: effectiveRole,
        confirmed: effectiveConfirmed,
        lunch,
        page: 1,
        pageSize: 5000,
        activeOnly: readOnly,
      },
    });
    return res.rows;
  };

  const buildRows = (rows: Awaited<ReturnType<typeof fetchAll>>) =>
    rows.map((c) => [
      c.trade_name,
      c.legal_name ?? "",
      c.role === "exhibitor"
        ? t("admin.companies.roleExhibitor")
        : t("admin.companies.roleVisitor"),
      c.confirmed ? "Confirmado" : "Pré-cadastro",
      c.city ?? "",
      c.state_code ?? "",
      c.country_code ?? "",
      c.primary_contact?.full_name ?? "",
      c.primary_contact?.email ?? "",
      c.primary_contact?.whatsapp ?? c.whatsapp ?? "",
      c.networking_lunch_participation === true
        ? "Sim"
        : c.networking_lunch_participation === false
          ? "Não"
          : "Não informado",
    ]);

  const stamp = () => new Date().toISOString().slice(0, 10);

  const exportXlsx = async () => {
    setExporting("xlsx");
    try {
      const rows = await fetchAll();
      if (rows.length === 0) {
        toast.info(t("admin.companies.empty"));
        return;
      }
      downloadXlsx(`empresas-${stamp()}.xlsx`, "Empresas", headers, buildRows(rows));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(null);
    }
  };

  const exportCsv = async () => {
    setExporting("csv");
    try {
      const rows = await fetchAll();
      if (rows.length === 0) {
        toast.info(t("admin.companies.empty"));
        return;
      }
      const csv = toCsv(headers, buildRows(rows));
      downloadBlob(
        `empresas-${stamp()}.csv`,
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(null);
    }
  };

  const exportPdf = async () => {
    setExporting("pdf");
    try {
      const rows = await fetchAll();
      if (rows.length === 0) {
        toast.info(t("admin.companies.empty"));
        return;
      }
      const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
      const W = doc.internal.pageSize.getWidth();
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text("Empresas", 40, 40);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(110);
      const generated = new Date().toLocaleString(i18n.language === "es" ? "es" : "pt-BR", {
        timeZone: "America/Sao_Paulo",
      });
      doc.text(`Gerado em ${generated} · ${rows.length} empresa(s)`, W - 40, 40, { align: "right" });
      doc.setTextColor(0);
      autoTable(doc, {
        startY: 60,
        head: [headers],
        body: buildRows(rows).map((r) => r.map((v) => String(v ?? ""))),
        styles: { fontSize: 8, cellPadding: 4 },
        headStyles: { fillColor: [30, 30, 30], textColor: 255 },
        alternateRowStyles: { fillColor: [245, 245, 245] },
      });
      doc.save(`empresas-${stamp()}.pdf`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-4">
      {!readOnly && <OrphanExhibitorsPanel />}
      {!readOnly && <UnpublishedExhibitorsPanel />}
      <Card className="p-5">
      <p className="mb-4 text-xs text-muted-foreground">{t("admin.companies.help")}</p>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
          <Input
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            placeholder={t("admin.companies.searchPlaceholder")}
            className="pl-8"
          />
        </div>
        {!readOnly && <Select
          value={role}
          onValueChange={(v) => {
            setPage(1);
            setRole(v as RoleFilter);
          }}
        >
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("admin.companies.roleAll")}</SelectItem>
            <SelectItem value="visitor">{t("admin.companies.roleVisitor")}</SelectItem>
            <SelectItem value="exhibitor">{t("admin.companies.roleExhibitor")}</SelectItem>
          </SelectContent>
        </Select>}
        {!readOnly && (
        <Select
          value={confirmed}
          onValueChange={(v) => {
            setPage(1);
            setConfirmed(v as ConfirmedFilter);
          }}
        >
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="yes">Confirmados</SelectItem>
            <SelectItem value="no">Pré-cadastro</SelectItem>
          </SelectContent>
        </Select>
        )}
        <Select
          value={lunch}
          onValueChange={(v) => {
            setPage(1);
            setLunch(v as LunchFilter);
          }}
        >
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Almoço: todos</SelectItem>
            <SelectItem value="yes">Participará do almoço</SelectItem>
            <SelectItem value="no">Não participará do almoço</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={exportXlsx} disabled={exporting !== null}>
          <FileSpreadsheet size={14} /> {exporting === "xlsx" ? t("common.loading") : "XLSX"}
        </Button>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting !== null}>
          <FileText size={14} /> {exporting === "csv" ? t("common.loading") : "CSV"}
        </Button>
        <Button variant="outline" size="sm" onClick={exportPdf} disabled={exporting !== null}>
          <Files size={14} /> {exporting === "pdf" ? t("common.loading") : "PDF"}
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (data?.rows ?? []).length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("admin.companies.empty")}</p>
      ) : (
        <div className="space-y-2">
          {data!.rows.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.trade_name}</span>
                  <Badge variant={c.role === "exhibitor" ? "default" : "secondary"}>
                    {c.role === "exhibitor"
                      ? t("admin.companies.roleExhibitor")
                      : t("admin.companies.roleVisitor")}
                  </Badge>
                  {!c.confirmed && (
                    <Badge variant="outline" className="text-muted-foreground">
                      Pré-cadastro
                    </Badge>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {[c.city, c.state_code, c.country_code].filter(Boolean).join(" / ")}
                  {c.primary_contact?.full_name ? ` · ${c.primary_contact.full_name}` : ""}
                  {c.primary_contact?.email ? ` · ${c.primary_contact.email}` : ""}
                  {c.primary_contact?.whatsapp || c.whatsapp
                    ? ` · WhatsApp: ${c.primary_contact?.whatsapp ?? c.whatsapp}`
                    : ""}
                  {c.role === "visitor"
                    ? ` · Almoço de networking: ${c.networking_lunch_participation === true ? "Sim" : c.networking_lunch_participation === false ? "Não" : "Não informado"}`
                    : ""}
                </p>
              </div>
              {!readOnly && (
                <Button size="sm" variant="outline" onClick={() => setEditingId(c.id)}>
                  <Pencil size={14} /> {t("admin.companies.edit")}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {data && data.total > 25 && (
        <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
          <span>{data.total} empresa(s)</span>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              ‹
            </Button>
            <span className="px-2 py-1">{page}</span>
            <Button
              size="sm"
              variant="ghost"
              disabled={page * 25 >= data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              ›
            </Button>
          </div>
        </div>
      )}

      {editingId && (
        <EditCompanyDrawer
          companyId={editingId}
          onClose={() => setEditingId(null)}
          onSaved={() => {
            setEditingId(null);
            refetch();
          }}
        />
      )}
      </Card>
    </div>
  );
}