import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileSpreadsheet, Files } from "lucide-react";
import { toast } from "sonner";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  computeClienteKpis,
  computeClienteTypeBreakdown,
  formatLocation,
  dedupeByCompany,
  type ClienteOverviewRow,
} from "@/lib/cliente-overview";
import { listClienteOverviewBase, type RegistrantRow } from "@/lib/staff-exports.functions";
import {
  bucketGroupFromMeetings,
  labelForGroup,
  type SchedulingGroup,
} from "@/lib/scheduling-status";
import { downloadXlsx } from "@/lib/exports/xlsx";
import { sortRowsForExport } from "@/lib/exports/sort";
import {
  LIST_PAGINATION_THRESHOLD,
  ListPagination,
  ListSummary,
  type PageSizeOption,
} from "@/components/admin/list-summary";

type StatusFilter = "any" | SchedulingGroup;
type TypeFilter = "all" | "visitor" | "exhibitor";

/**
 * Read-only overview for the `cliente` profile.
 *
 * - Consumes `listEventRegistrants` with no `onlyWithMeetings` flag — the
 *   server already restricts cliente to rows with
 *   `scheduled_meetings_count > 0` (canonical "com agendamento" bucket).
 * - KPIs and per-row bucketing both derive from `scheduled_meetings_count`
 *   via `bucketGroupFromMeetings` (single source of truth). The text column
 *   `scheduling_status` is intentionally NOT used here.
 * - No mutations, no exports, no per-row actions.
 */
export function ClienteOverview() {
  const { t, i18n } = useTranslation();
  const listFn = useServerFn(listClienteOverviewBase);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("any");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [exporting, setExporting] = useState<null | "xlsx" | "pdf">(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSizeOption>(50);

  const { data, isLoading } = useQuery({
    queryKey: ["cliente-overview-base"],
    queryFn: () => listFn({ data: {} }),
  });

  const rows = (data?.rows ?? []) as RegistrantRow[];

  const kpis = useMemo<ReturnType<typeof computeClienteKpis>>(
    () => computeClienteKpis(rows as ClienteOverviewRow[]),
    [rows],
  );

  const breakdown = useMemo(
    () => computeClienteTypeBreakdown(rows as ClienteOverviewRow[]),
    [rows],
  );

  // Future-proofing: only render the status filter when more than one
  // bucket actually appears in the dataset (today: always one for cliente).
  const bucketsPresent = useMemo(() => {
    const s = new Set<SchedulingGroup>();
    for (const r of rows) {
      s.add(bucketGroupFromMeetings(r.scheduled_meetings_count ?? 0));
      if (s.size > 1) break;
    }
    return s;
  }, [rows]);
  const showStatusFilter = bucketsPresent.size > 1;

  // Detect whether ANY row carries an updated_at-like field. The
  // current `RegistrantRow` payload does not, so this column is omitted.
  const hasUpdatedAt = useMemo(() => {
    return rows.some((r) => {
      const anyRow = r as unknown as Record<string, unknown>;
      return Boolean(anyRow.updated_at ?? anyRow.pipeline_updated_at);
    });
  }, [rows]);

  const filtered = useMemo(() => {
    const normalize = (v: unknown) =>
      (v ?? "")
        .toString()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
    const term = normalize(search);
    return rows
      .filter((r) => {
        if (!term) return true;
        // Unified search: company (trade/legal/tax) + contact (name/email).
        // Mirrors `filterAndRankParticipants` so Visão Geral matches the
        // same fields as Empresas / Inscritos / Agenda on the server.
        return [
          r.company_trade_name,
          r.company_legal_name,
          r.company_tax_id,
          r.full_name,
          r.email,
        ].some((field) => normalize(field).includes(term));
      })
      .filter((r) => {
        if (status === "any") return true;
        return (
          bucketGroupFromMeetings(r.scheduled_meetings_count ?? 0) === status
        );
      })
      .filter((r) => {
        if (typeFilter === "all") return true;
        return r.role === typeFilter;
      })
      .slice()
      .sort((a, b) =>
        (a.company_trade_name ?? "").localeCompare(b.company_trade_name ?? ""),
      );
  }, [rows, search, status, typeFilter]);

  // Per-profile expansion (`filtered`) drives EXPORTS only — XLSX/PDF must
  // list every contact of a company (e.g. COPASTUR has 2 buyers).
  // KPIs, badge counter and the on-screen table all talk about EMPRESAS,
  // so they consume the deduped-by-company view. Single source of truth:
  // `dedupeByCompany` in `src/lib/cliente-overview.ts`.
  const filteredCompanies = useMemo(
    () => dedupeByCompany(filtered as ClienteOverviewRow[]) as typeof filtered,
    [filtered],
  );

  const totalCompanies = filteredCompanies.length;
  const paginate = totalCompanies > LIST_PAGINATION_THRESHOLD;
  const visibleCompanies = paginate
    ? filteredCompanies.slice((page - 1) * pageSize, page * pageSize)
    : filteredCompanies;

  // Reset page when filters/search change.
  useEffect(() => {
    setPage(1);
  }, [search, status, typeFilter, pageSize]);

  const exportHeaders = [
    "Nome Fantasia",
    "Razão social",
    "Tipo",
    "Cidade",
    "UF",
    "País",
    "Status da agenda",
    "Reuniões agendadas",
    "Responsável",
    "E-mail",
    "Telefone",
    "WhatsApp",
    "Almoço de networking",
  ];

  const typeLabel = (role: string) =>
    role === "exhibitor"
      ? t("cliente.overview.type.exhibitor")
      : role === "visitor"
        ? t("cliente.overview.type.visitor")
        : "—";

  // Exports are labelled "Empresas" — must be one row per company_id.
  // Use the deduped view so the PDF/XLSX line count matches the on-screen
  // counter (e.g. Incomum Viagens appears once, not once per contact).
  const buildExportRows = () =>
    sortRowsForExport(filteredCompanies, {
      tradeName: (r) => r.company_trade_name,
      fullName: (r) => r.full_name,
      id: (r) => r.profile_id ?? r.company_id,
    }).map((r) => {
      const count = r.scheduled_meetings_count ?? 0;
      const group = bucketGroupFromMeetings(count);
      return [
        r.company_trade_name ?? "",
        r.company_legal_name ?? "",
        typeLabel(r.role),
        r.city ?? "",
        r.state_code ?? "",
        r.country_code ?? "",
        labelForGroup(group, t),
        count,
        r.full_name ?? "",
        r.email ?? "",
        r.phone ?? "",
        r.whatsapp ?? "",
        r.networking_lunch_participation === true
          ? "Sim"
          : r.networking_lunch_participation === false
            ? "Não"
            : "Não informado",
      ];
    });

  const fileSuffix = () => {
    const parts: string[] = [];
    if (typeFilter === "visitor") parts.push("visitantes");
    else if (typeFilter === "exhibitor") parts.push("expositoras");
    if (status === "com_agendamento") parts.push("com-agendamento");
    else if (status === "sem_agendamento") parts.push("sem-agendamento");
    if (parts.length === 0) parts.push("todas");
    const stamp = new Date().toISOString().slice(0, 10);
    return `${parts.join("-")}-${stamp}`;
  };

  const exportXlsx = () => {
    if (filteredCompanies.length === 0) {
      toast.info(t("cliente.overview.empty"));
      return;
    }
    setExporting("xlsx");
    try {
      downloadXlsx(`empresas-${fileSuffix()}.xlsx`, "Empresas", exportHeaders, buildExportRows());
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(null);
    }
  };

  const exportPdf = () => {
    if (filteredCompanies.length === 0) {
      toast.info(t("cliente.overview.empty"));
      return;
    }
    setExporting("pdf");
    try {
      const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
      const W = doc.internal.pageSize.getWidth();
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text("Empresas — Visão geral", 40, 40);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(110);
      const generated = new Date().toLocaleString(i18n.language === "es" ? "es" : "pt-BR", {
        timeZone: "America/Sao_Paulo",
      });
      doc.text(
        `Gerado em ${generated} · ${filteredCompanies.length} empresa(s)`,
        W - 40,
        40,
        { align: "right" },
      );
      doc.setTextColor(0);
      autoTable(doc, {
        startY: 60,
        head: [exportHeaders],
        body: buildExportRows().map((r) => r.map((v) => String(v ?? ""))),
        styles: { fontSize: 8, cellPadding: 4 },
        headStyles: { fillColor: [30, 30, 30], textColor: 255 },
        alternateRowStyles: { fillColor: [245, 245, 245] },
      });
      doc.save(`empresas-${fileSuffix()}.pdf`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t("cliente.overview.title")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("cliente.overview.subtitle")}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label={t("cliente.overview.kpi.companies")} value={kpis.inscritas} />
        <Kpi label={t("cliente.overview.kpi.scheduled")} value={kpis.comAgendamento} />
        <Kpi label={t("cliente.overview.kpi.meetings")} value={breakdown.visitantesMeetings} />
        <Kpi
          label={t("cliente.overview.kpi.percentScheduled")}
          value={`${kpis.percentComAgendamento}%`}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Kpi
          label={t("cliente.overview.kpi.visitors")}
          value={breakdown.visitantesCount}
          hint={`${breakdown.visitantesMeetings} ${t("cliente.overview.kpi.visitorMeetings")}`}
        />
        <Kpi
          label={t("cliente.overview.kpi.exhibitors")}
          value={breakdown.expositoresCount}
          hint={`${breakdown.expositoresMeetings} ${t("cliente.overview.kpi.exhibitorMeetings")}`}
        />
      </div>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("cliente.overview.search.placeholder")}
            className="max-w-xs"
          />
          <Select
            value={typeFilter}
            onValueChange={(v) => setTypeFilter(v as TypeFilter)}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {t("cliente.overview.filter.all")}
              </SelectItem>
              <SelectItem value="visitor">
                {t("cliente.overview.filter.visitors")}
              </SelectItem>
              <SelectItem value="exhibitor">
                {t("cliente.overview.filter.exhibitors")}
              </SelectItem>
            </SelectContent>
          </Select>
          {showStatusFilter && (
            <>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as StatusFilter)}
              >
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Todas</SelectItem>
                  <SelectItem value="com_agendamento">
                    {labelForGroup("com_agendamento", t)}
                  </SelectItem>
                  <SelectItem value="sem_agendamento">
                    {labelForGroup("sem_agendamento", t)}
                  </SelectItem>
                </SelectContent>
              </Select>
              <Badge variant="secondary" className="h-9 px-3">
                {filteredCompanies.length}{" "}
                {filteredCompanies.length === 1 ? "empresa" : "empresas"}
              </Badge>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={exportXlsx}
            disabled={exporting !== null || filteredCompanies.length === 0}
          >
            <FileSpreadsheet size={14} /> {exporting === "xlsx" ? t("common.loading") : "XLSX"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={exportPdf}
            disabled={exporting !== null || filteredCompanies.length === 0}
          >
            <Files size={14} /> {exporting === "pdf" ? t("common.loading") : "PDF"}
          </Button>
        </div>

        <div className="mb-2">
          <ListSummary
            visible={visibleCompanies.length}
            total={totalCompanies}
            noun="empresa"
            nounPlural="empresas"
          />
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("cliente.overview.table.company")}</TableHead>
                <TableHead>{t("cliente.overview.table.type")}</TableHead>
                <TableHead>{t("cliente.overview.table.location")}</TableHead>
                <TableHead>{t("cliente.overview.table.status")}</TableHead>
                <TableHead className="text-right">
                  {t("cliente.overview.table.meetings")}
                </TableHead>
                {hasUpdatedAt && (
                  <TableHead>{t("cliente.overview.table.updated")}</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? null : visibleCompanies.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={hasUpdatedAt ? 6 : 5}
                    className="text-center text-sm text-muted-foreground"
                  >
                    {t("cliente.overview.empty")}
                  </TableCell>
                </TableRow>
              ) : (
                visibleCompanies.map((r) => {
                  const count = r.scheduled_meetings_count ?? 0;
                  const group = bucketGroupFromMeetings(count);
                  const anyRow = r as unknown as Record<string, unknown>;
                  const updatedRaw =
                    (anyRow.updated_at as string | undefined) ??
                    (anyRow.pipeline_updated_at as string | undefined);
                  return (
                    <TableRow key={r.company_id}>
                      <TableCell className="font-medium">
                        {r.company_trade_name}
                      </TableCell>
                      <TableCell>
                        {r.role === "visitor" || r.role === "exhibitor" ? (
                          <Badge variant="outline">
                            {t(`cliente.overview.type.${r.role}`)}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatLocation({
                          city: r.city,
                          state_code: r.state_code,
                          country_code: r.country_code,
                        })}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            group === "com_agendamento"
                              ? "border-emerald-500 text-emerald-700 dark:text-emerald-400"
                              : "border-muted-foreground/40 text-muted-foreground"
                          }
                        >
                          {labelForGroup(group, t)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {count}
                      </TableCell>
                      {hasUpdatedAt && (
                        <TableCell className="text-muted-foreground">
                          {updatedRaw
                            ? new Date(updatedRaw).toLocaleString()
                            : "—"}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
        {paginate && (
          <ListPagination
            page={page}
            pageSize={pageSize}
            total={totalCompanies}
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPage(1);
            }}
            noun="empresa"
            nounPlural="empresas"
          />
        )}
      </Card>
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint ? (
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      ) : null}
    </Card>
  );
}