import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { getPostEventSummary } from "@/lib/checkin.functions";
import { downloadBlob, toCsv } from "@/lib/exports/csv";

export function PostEventSummary() {
  const { t } = useTranslation();
  const fn = useServerFn(getPostEventSummary);
  const { data, isLoading } = useQuery({
    queryKey: ["checkin-postevent"],
    queryFn: () => fn({ data: {} }),
  });

  const rows = useMemo(() => data?.rows ?? [], [data]);

  const exportCsv = () => {
    const headers = [
      t("admin.checkin.post.columns.company"),
      t("admin.checkin.post.columns.participant"),
      t("admin.checkin.post.columns.profile"),
      t("admin.checkin.post.columns.presence"),
      t("admin.checkin.post.columns.scheduled"),
      t("admin.checkin.post.columns.done"),
      t("admin.checkin.post.columns.noShow"),
      t("admin.checkin.post.columns.avgLate"),
      t("admin.checkin.post.columns.table"),
      t("admin.checkin.post.columns.block"),
    ];
    const body = rows.map((r) => [
      r.company,
      r.participant,
      r.profile,
      r.presence,
      r.scheduled,
      r.done,
      r.no_show,
      r.avg_late_min,
      r.tables,
      r.blocks,
    ]);
    const csv = toCsv(headers, body);
    downloadBlob(
      `pos-evento-${new Date().toISOString().slice(0, 10)}.csv`,
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
  };

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{t("admin.checkin.post.title")}</p>
          <p className="text-xs text-muted-foreground">
            {t("admin.checkin.post.subtitle")}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={exportCsv}
          disabled={rows.length === 0}
        >
          <Download size={14} /> {t("admin.checkin.post.exportCsv")}
        </Button>
      </div>
      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">
          {t("admin.checkin.post.empty")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("admin.checkin.post.columns.company")}</TableHead>
                <TableHead>{t("admin.checkin.post.columns.participant")}</TableHead>
                <TableHead>{t("admin.checkin.post.columns.profile")}</TableHead>
                <TableHead>{t("admin.checkin.post.columns.presence")}</TableHead>
                <TableHead className="text-right">
                  {t("admin.checkin.post.columns.scheduled")}
                </TableHead>
                <TableHead className="text-right">
                  {t("admin.checkin.post.columns.done")}
                </TableHead>
                <TableHead className="text-right">
                  {t("admin.checkin.post.columns.noShow")}
                </TableHead>
                <TableHead className="text-right">
                  {t("admin.checkin.post.columns.avgLate")}
                </TableHead>
                <TableHead>{t("admin.checkin.post.columns.table")}</TableHead>
                <TableHead>{t("admin.checkin.post.columns.block")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={`${r.participant}-${i}`}>
                  <TableCell className="text-xs">{r.company || "—"}</TableCell>
                  <TableCell className="text-xs font-medium">{r.participant}</TableCell>
                  <TableCell className="text-xs">{r.profile}</TableCell>
                  <TableCell className="text-xs">{r.presence}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{r.scheduled}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{r.done}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{r.no_show}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{r.avg_late_min}</TableCell>
                  <TableCell className="text-xs">{r.tables || "—"}</TableCell>
                  <TableCell className="text-xs">{r.blocks || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}