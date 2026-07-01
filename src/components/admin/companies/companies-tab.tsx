import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeftRight, FileSpreadsheet, FileText, Files, Pencil, RotateCcw, Search, Trash2, UserPlus } from "lucide-react";

import {
  adminHardDeleteCompany,
  adminReactivateCompany,
  listAdminCompanies,
  setVisitorLunchParticipation,
} from "@/lib/admin.functions";
import { downloadBlob, toCsv } from "@/lib/exports/csv";
import { downloadXlsx } from "@/lib/exports/xlsx";
import { sortRowsForExport } from "@/lib/exports/sort";
import { dedupeCompanyRows, groupCompaniesByCnpjRoot } from "@/lib/companies-report";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { AddCompanyContactDialog } from "@/components/admin/companies/add-company-contact-dialog";
import { ReassignContactDialog } from "@/components/admin/companies/reassign-contact-dialog";
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
import {
  LIST_PAGINATION_THRESHOLD,
  ListPagination,
  ListSummary,
  type PageSizeOption,
} from "@/components/admin/list-summary";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type RoleFilter = "all" | "visitor" | "exhibitor" | "cliente";
type ConfirmedFilter = "all" | "yes" | "no";
type LunchFilter = "all" | "yes" | "no";
type StatusFilter = "active" | "inactive" | "all";
type ClienteTypeFilter = "all" | "visitor" | "exhibitor";
type SchedulingFilter = "all" | "scheduled" | "not_scheduled";

// Centralized filter used by the table AND every export (XLSX/CSV/PDF) so the
// active type selector always matches the exported dataset. Classification is
// based exclusively on the official `role` field from the payload.
function filterRowsByType<T extends { role?: string | null }>(
  rows: T[],
  typeFilter: ClienteTypeFilter,
): T[] {
  if (typeFilter === "all") return rows;
  return rows.filter((r) => r.role === typeFilter);
}

export function CompaniesTab({ readOnly = false }: { readOnly?: boolean } = {}) {
  const { t, i18n } = useTranslation();
  const listFn = useServerFn(listAdminCompanies);
  const setLunchFn = useServerFn(setVisitorLunchParticipation);
  const reactivateFn = useServerFn(adminReactivateCompany);
  const hardDeleteFn = useServerFn(adminHardDeleteCompany);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<RoleFilter>(readOnly ? "visitor" : "all");
  const [confirmed, setConfirmed] = useState<ConfirmedFilter>(readOnly ? "yes" : "all");
  const [lunch, setLunch] = useState<LunchFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSizeOption>(50);
  const [clienteTypeFilter, setClienteTypeFilter] = useState<ClienteTypeFilter>("all");
  const [schedulingFilter, setSchedulingFilter] = useState<SchedulingFilter>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<null | "xlsx" | "csv" | "pdf">(null);
  const [savingLunchId, setSavingLunchId] = useState<string | null>(null);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [contactDialogCompany, setContactDialogCompany] = useState<
    | null
    | {
        id: string;
        trade_name: string;
        legal_name: string | null;
        tax_id: string | null;
        city: string | null;
        state_code: string | null;
      }
  >(null);
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [reassignDialogOpen, setReassignDialogOpen] = useState(false);

  // For the cliente read-only view we fetch all roles in a single page so we
  // can compute Visitantes/Expositoras counts and filter client-side. The
  // server already restricts the universe of visible companies for cliente.
  const effectiveRole: RoleFilter = readOnly ? "all" : role;
  const effectiveConfirmed: ConfirmedFilter = readOnly ? "yes" : confirmed;
  const effectiveStatus: StatusFilter = readOnly ? "active" : status;

  // SINGLE SOURCE OF TRUTH for the Empresas tab.
  //
  // We assemble `fullRows` by paging through the server with a bounded
  // per-call size until we've collected `total` rows. This makes the
  // tab (list, badge, summary, XLSX, CSV, PDF) independent of any
  // single silent `pageSize` constant: even if the universe grows past
  // a former ad-hoc cap, we keep fetching subsequent pages until the
  // whole filtered set is in memory. Pagination on screen is purely
  // visual (see `displayRows` below) and never touches the exports.
  //
  // Belt-and-suspenders: the server also reports `baseTruncated` when
  // its underlying companies query hit its hard cap. We surface that
  // as an explicit `console.warn` instead of silently degrading.
  const CLIENT_PAGE_SIZE = 1000;
  const CLIENT_MAX_PAGES = 100; // 100k rows safety ceiling
  const { data, isLoading, refetch } = useQuery({
    queryKey: [
      "admin-companies",
      search,
      effectiveRole,
      effectiveConfirmed,
      lunch,
      effectiveStatus,
      readOnly,
      schedulingFilter,
    ],
    queryFn: async () => {
      const baseInput = {
        search,
        role: effectiveRole,
        confirmed: effectiveConfirmed,
        lunch,
        activeOnly: readOnly,
        status: effectiveStatus,
        excludeCliente: readOnly,
        scheduling: schedulingFilter,
      };
      const first = await listFn({
        data: { ...baseInput, page: 1, pageSize: CLIENT_PAGE_SIZE },
      });
      const total = first.total ?? 0;
      const acc: typeof first.rows = [...first.rows];
      let pagesFetched = 1;
      while (
        acc.length < total &&
        first.rows.length > 0 &&
        pagesFetched < CLIENT_MAX_PAGES
      ) {
        pagesFetched += 1;
        const next = await listFn({
          data: { ...baseInput, page: pagesFetched, pageSize: CLIENT_PAGE_SIZE },
        });
        if (!next.rows.length) break;
        acc.push(...next.rows);
      }
      const clientTruncated =
        acc.length < total && pagesFetched >= CLIENT_MAX_PAGES;
      const baseTruncated = Boolean(
        (first as { baseTruncated?: boolean }).baseTruncated,
      );
      if (baseTruncated) {
        // The server-side base companies query hit its hard cap. The
        // `total` reported by the server is itself truncated, so every
        // downstream artifact would silently under-report otherwise.
        console.warn(
          "[companies-tab] server base dataset truncated by companies hard limit",
          { total, fetched: acc.length, pageSize: CLIENT_PAGE_SIZE },
        );
      }
      if (clientTruncated) {
        console.warn(
          "[companies-tab] dataset may be truncated by client safety ceiling",
          {
            total,
            fetched: acc.length,
            pageSize: CLIENT_PAGE_SIZE,
            maxPages: CLIENT_MAX_PAGES,
          },
        );
      }
      return { rows: acc, total, baseTruncated, clientTruncated };
    },
  });

  // Defensive dedupe + CNPJ-root grouping. The server already applies both
  // rules; re-applying on the client is idempotent and guarantees the same
  // visual unit even against a stale/older server response.
  const universeRows = groupCompaniesByCnpjRoot(dedupeCompanyRows(data?.rows ?? []));

  // Cliente KPI cards use the FULL universe (no type filter applied).
  const clienteSummary = readOnly
    ? {
        total: universeRows.length,
        visitors: universeRows.filter((r) => r.role === "visitor").length,
        exhibitors: universeRows.filter((r) => r.role === "exhibitor").length,
      }
    : null;

  // The unified collection — used by list, badge, summary AND all exports.
  const unifiedRows = readOnly
    ? filterRowsByType(universeRows, clienteTypeFilter)
    : universeRows;
  const displayTotal = unifiedRows.length;

  // Pagination is purely visual. When total ≤ threshold (50) we render the
  // whole set in a single page. Exports NEVER see the paged slice.
  const shouldPaginate = displayTotal > LIST_PAGINATION_THRESHOLD;
  const displayRows = shouldPaginate
    ? unifiedRows.slice((page - 1) * pageSize, page * pageSize)
    : unifiedRows;

  const headers = [
    "Nome Fantasia",
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

  // Exports read the exact same in-memory collection the badge/list use.
  // No refetch, no alternate filter path, no way to diverge.
  const fetchAll = async () => unifiedRows;

  // Exports emit EXACTLY ONE ROW PER company_id — this is the "Empresas"
  // report, so it must match the on-screen badge/counter (which is also
  // per-company). Expanding by eligible contact previously caused
  // companies with 2+ buyers (e.g. Incomum Viagens) to appear twice in
  // the PDF while the badge said one. The per-contact expansion belongs
  // to the consolidated agenda exports, not here.
  const buildRows = (rows: Awaited<ReturnType<typeof fetchAll>>) => {
    const unique = groupCompaniesByCnpjRoot(dedupeCompanyRows(rows));
    return sortRowsForExport(unique, {
      tradeName: (c) => c.trade_name,
      fullName: (c) => c.primary_contact?.full_name ?? "",
      id: (c) => c.id,
    }).map((c) => {
      const roleLabel =
        c.role === "exhibitor"
          ? t("admin.companies.roleExhibitor")
          : c.role === "cliente"
            ? t("admin.companies.roleCliente")
            : t("admin.companies.roleVisitor");
      const statusLabel = c.confirmed ? "Confirmado" : "Pré-cadastro";
      const contact = {
        full_name: c.primary_contact?.full_name ?? "",
        email: c.primary_contact?.email ?? "",
        whatsapp: c.primary_contact?.whatsapp ?? c.whatsapp ?? null,
      };
      return [
        c.trade_name,
        c.legal_name ?? "",
        roleLabel,
        statusLabel,
        c.city ?? "",
        c.state_code ?? "",
        c.country_code ?? "",
        contact.full_name,
        contact.email,
        contact.whatsapp ?? "",
        c.networking_lunch_participation === true
          ? "Sim"
          : c.networking_lunch_participation === false
            ? "Não"
            : "Não informado",
      ];
    });
  };

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
      const body = buildRows(rows);
      const companyIds = rows.map((r) => r.id);
      // Telemetry to make the export dataset auditable (see report below).
      // eslint-disable-next-line no-console
      console.info("[empresas-pdf] dataset", {
        unifiedRows: rows.length,
        bodyRows: body.length,
        badgeTotal: displayTotal,
        companyIds,
      });
      if (body.length !== displayTotal) {
        // eslint-disable-next-line no-console
        console.warn("[empresas-pdf] PDF count != badge", {
          bodyRows: body.length,
          badgeTotal: displayTotal,
        });
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
      doc.text(`Gerado em ${generated} · ${body.length} empresa(s)`, W - 40, 40, { align: "right" });
      doc.setTextColor(0);
      autoTable(doc, {
        startY: 60,
        head: [headers],
        body: body.map((r) => r.map((v) => String(v ?? ""))),
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
      {readOnly && clienteSummary && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-border bg-card p-3">
            <p className="text-xs text-muted-foreground">
              {t("cliente.companies.summary.total")}
            </p>
            <p className="text-2xl font-semibold tabular-nums">{clienteSummary.total}</p>
          </div>
          <div className="rounded-md border border-border bg-card p-3">
            <p className="text-xs text-muted-foreground">
              {t("cliente.companies.summary.visitors")}
            </p>
            <p className="text-2xl font-semibold tabular-nums">{clienteSummary.visitors}</p>
          </div>
          <div className="rounded-md border border-border bg-card p-3">
            <p className="text-xs text-muted-foreground">
              {t("cliente.companies.summary.exhibitors")}
            </p>
            <p className="text-2xl font-semibold tabular-nums">{clienteSummary.exhibitors}</p>
          </div>
        </div>
      )}
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
        {readOnly && (
          <Select
            value={clienteTypeFilter}
            onValueChange={(v) => {
              setPage(1);
              setClienteTypeFilter(v as ClienteTypeFilter);
            }}
          >
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("cliente.companies.filter.all")}</SelectItem>
              <SelectItem value="visitor">{t("cliente.companies.filter.visitors")}</SelectItem>
              <SelectItem value="exhibitor">{t("cliente.companies.filter.exhibitors")}</SelectItem>
            </SelectContent>
          </Select>
        )}
        <Select
          value={schedulingFilter}
          onValueChange={(v) => {
            setPage(1);
            setSchedulingFilter(v as SchedulingFilter);
          }}
        >
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="scheduled">Com agendamento</SelectItem>
            <SelectItem value="not_scheduled">Sem agendamento</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="h-9 px-3">
          {displayTotal} {displayTotal === 1 ? "empresa" : "empresas"}
        </Badge>
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
            <SelectItem value="cliente">{t("admin.companies.roleCliente")}</SelectItem>
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
        {!readOnly && (
          <Select
            value={status}
            onValueChange={(v) => {
              setPage(1);
              setStatus(v as StatusFilter);
            }}
          >
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">{t("admin.companies.statusActive")}</SelectItem>
              <SelectItem value="inactive">{t("admin.companies.statusInactive")}</SelectItem>
              <SelectItem value="all">{t("admin.companies.statusAll")}</SelectItem>
            </SelectContent>
          </Select>
        )}
        <Button variant="outline" size="sm" onClick={exportXlsx} disabled={exporting !== null}>
          <FileSpreadsheet size={14} /> {exporting === "xlsx" ? t("common.loading") : "XLSX"}
        </Button>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting !== null}>
          <FileText size={14} /> {exporting === "csv" ? t("common.loading") : "CSV"}
        </Button>
        <Button variant="outline" size="sm" onClick={exportPdf} disabled={exporting !== null}>
          <Files size={14} /> {exporting === "pdf" ? t("common.loading") : "PDF"}
        </Button>
        {!readOnly && (
          <Button
            variant="default"
            size="sm"
            onClick={() => {
              setContactDialogCompany(null);
              setContactDialogOpen(true);
            }}
          >
            <UserPlus size={14} /> {t("admin.companies.addContact", { defaultValue: "Adicionar contato" })}
          </Button>
        )}
        {!readOnly && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setReassignDialogOpen(true)}
          >
            <ArrowLeftRight size={14} /> Reatribuir contato ativo
          </Button>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : displayRows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("admin.companies.empty")}</p>
      ) : (
        <>
        <div className="mb-2">
          <ListSummary
            visible={displayRows.length}
            total={displayTotal}
            noun="empresa"
            nounPlural="empresas"
          />
        </div>
        <div className="space-y-2">
          {displayRows.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.trade_name}</span>
                  <Badge variant={c.role === "exhibitor" ? "default" : c.role === "cliente" ? "outline" : "secondary"}>
                    {c.role === "exhibitor"
                      ? readOnly
                        ? t("cliente.companies.type.exhibitor")
                        : t("admin.companies.roleExhibitor")
                      : c.role === "cliente"
                        ? t("admin.companies.roleCliente")
                        : readOnly
                          ? t("cliente.companies.type.visitor")
                          : t("admin.companies.roleVisitor")}
                  </Badge>
                  {!c.confirmed && (
                    <Badge variant="outline" className="text-muted-foreground">
                      Pré-cadastro
                    </Badge>
                  )}
                  {c.is_active === false && (
                    <Badge variant="destructive" title={c.inactivated_at ?? undefined}>
                      {t("admin.companies.orphanBadge")}
                    </Badge>
                  )}
                  {(() => {
                    const count = (c as { scheduled_meetings_count?: number })
                      .scheduled_meetings_count ?? 0;
                    if (count > 0) {
                      return (
                        <Badge variant="default" title={`${count} reunião(ões)`}>
                          Agendado
                        </Badge>
                      );
                    }
                    return (
                      <Badge variant="outline" className="text-muted-foreground">
                        Sem agendamento
                      </Badge>
                    );
                  })()}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {[c.city, c.state_code, c.country_code].filter(Boolean).join(" / ")}
                  {c.primary_contact?.full_name ? ` · ${c.primary_contact.full_name}` : ""}
                  {c.primary_contact?.email ? ` · ${c.primary_contact.email}` : ""}
                  {c.primary_contact?.whatsapp || c.whatsapp
                    ? ` · WhatsApp: ${c.primary_contact?.whatsapp ?? c.whatsapp}`
                    : ""}
                </p>
                {!readOnly && c.role === "visitor" && c.primary_contact?.id && (
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Almoço de networking:</span>
                    <Select
                      value={
                        c.networking_lunch_participation === true
                          ? "yes"
                          : c.networking_lunch_participation === false
                            ? "no"
                            : "unset"
                      }
                      disabled={savingLunchId === c.primary_contact.id}
                      onValueChange={async (v) => {
                        if (v === "unset" || !c.primary_contact?.id) return;
                        setSavingLunchId(c.primary_contact.id);
                        try {
                          await setLunchFn({
                            data: {
                              profileId: c.primary_contact.id,
                              value: v === "yes",
                            },
                          });
                          toast.success("Participação no almoço atualizada");
                          await refetch();
                        } catch (e) {
                          toast.error((e as Error).message);
                        } finally {
                          setSavingLunchId(null);
                        }
                      }}
                    >
                      <SelectTrigger className="h-7 w-40 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unset" disabled>
                          Não informado
                        </SelectItem>
                        <SelectItem value="yes">Sim</SelectItem>
                        <SelectItem value="no">Não</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              {!readOnly && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditingId(c.id)}>
                    <Pencil size={14} /> {t("admin.companies.edit")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setContactDialogCompany({
                        id: c.id,
                        trade_name: c.trade_name,
                        legal_name: (c as { legal_name?: string | null }).legal_name ?? null,
                        tax_id: (c as { tax_id?: string | null }).tax_id ?? null,
                        city: (c as { city?: string | null }).city ?? null,
                        state_code: (c as { state_code?: string | null }).state_code ?? null,
                      });
                      setContactDialogOpen(true);
                    }}
                  >
                    <UserPlus size={14} /> {t("admin.companies.addContact", { defaultValue: "Adicionar contato" })}
                  </Button>
                  {c.is_active === false && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={reactivatingId === c.id}
                        onClick={async () => {
                          setReactivatingId(c.id);
                          try {
                            await reactivateFn({ data: { companyId: c.id, confirm: true } });
                            toast.success(t("admin.companies.reactivateSuccess"));
                            await refetch();
                          } catch (e) {
                            toast.error((e as Error).message);
                          } finally {
                            setReactivatingId(null);
                          }
                        }}
                      >
                        <RotateCcw size={14} /> {t("admin.companies.reactivate")}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          setDeleteTarget({ id: c.id, name: c.trade_name });
                          setDeleteConfirmText("");
                        }}
                      >
                        <Trash2 size={14} /> {t("admin.companies.hardDelete")}
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        </>
      )}

      {displayTotal > LIST_PAGINATION_THRESHOLD && (
        <ListPagination
          page={page}
          pageSize={pageSize}
          total={displayTotal}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
          noun="empresa"
          nounPlural="empresas"
        />
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
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => {
          if (!o) {
            setDeleteTarget(null);
            setDeleteConfirmText("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.companies.hardDeleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.companies.hardDeleteConfirmBody", { name: deleteTarget?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {t("admin.companies.hardDeleteTypeName", { name: deleteTarget?.name ?? "" })}
            </p>
            <Input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={deleteTarget?.name ?? ""}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                deleting ||
                !deleteTarget ||
                deleteConfirmText.trim() !== deleteTarget.name.trim()
              }
              onClick={async () => {
                if (!deleteTarget) return;
                setDeleting(true);
                try {
                  await hardDeleteFn({
                    data: { companyId: deleteTarget.id, confirm: true },
                  });
                  toast.success(t("admin.companies.hardDeleteSuccess"));
                  setDeleteTarget(null);
                  setDeleteConfirmText("");
                  await refetch();
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setDeleting(false);
                }
              }}
            >
              {t("admin.companies.hardDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </Card>
      <AddCompanyContactDialog
        open={contactDialogOpen}
        initialCompany={contactDialogCompany}
        onClose={() => {
          setContactDialogOpen(false);
          setContactDialogCompany(null);
        }}
        onSuccess={() => {
          void refetch();
        }}
      />
      <ReassignContactDialog
        open={reassignDialogOpen}
        onClose={() => setReassignDialogOpen(false)}
        onSuccess={() => {
          void refetch();
        }}
      />
    </div>
  );
}