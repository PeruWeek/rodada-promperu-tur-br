import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { Badge } from "@/components/ui/badge";
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
  type ClienteOverviewRow,
} from "@/lib/cliente-overview";
import { listEventRegistrants, type RegistrantRow } from "@/lib/staff-exports.functions";
import {
  bucketGroupFromMeetings,
  labelForGroup,
  type SchedulingGroup,
} from "@/lib/scheduling-status";

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
  const { t } = useTranslation();
  const listFn = useServerFn(listEventRegistrants);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("any");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  const { data, isLoading } = useQuery({
    queryKey: ["cliente-overview"],
    queryFn: () => listFn({ data: { role: "all" } }),
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
    const term = search.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (!term) return true;
        return (r.company_trade_name ?? "").toLowerCase().includes(term);
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
        <Kpi label={t("cliente.overview.kpi.meetings")} value={kpis.totalReunioes} />
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
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as StatusFilter)}
            >
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">—</SelectItem>
                <SelectItem value="com_agendamento">
                  {labelForGroup("com_agendamento", t)}
                </SelectItem>
                <SelectItem value="sem_agendamento">
                  {labelForGroup("sem_agendamento", t)}
                </SelectItem>
              </SelectContent>
            </Select>
          )}
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
              {isLoading ? null : filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={hasUpdatedAt ? 6 : 5}
                    className="text-center text-sm text-muted-foreground"
                  >
                    {t("cliente.overview.empty")}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => {
                  const count = r.scheduled_meetings_count ?? 0;
                  const group = bucketGroupFromMeetings(count);
                  const anyRow = r as unknown as Record<string, unknown>;
                  const updatedRaw =
                    (anyRow.updated_at as string | undefined) ??
                    (anyRow.pipeline_updated_at as string | undefined);
                  return (
                    <TableRow key={`${r.company_id}-${r.profile_id}`}>
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