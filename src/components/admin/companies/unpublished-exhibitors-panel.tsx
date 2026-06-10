import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { AlertTriangle, EyeOff, RefreshCw } from "lucide-react";

import { listUnpublishedExhibitors } from "@/lib/admin.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type Row = {
  profile_id: string;
  email: string;
  full_name: string | null;
  trade_name: string | null;
  reason: string;
  created_at: string;
};

export function UnpublishedExhibitorsPanel() {
  const { t } = useTranslation();
  const listFn = useServerFn(listUnpublishedExhibitors);
  const { data, isLoading, error, isFetching, refetch } = useQuery({
    queryKey: ["admin-unpublished-exhibitors"],
    queryFn: () => listFn(),
    retry: 1,
  });

  const rows = (data?.rows ?? []) as Row[];
  const noEvent = rows.some((r) => r.reason === "no_active_event");

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <EyeOff size={18} className="text-muted-foreground" />
        <h3 className="font-semibold">{t("admin.unpublished.title")}</h3>
        <Badge variant="outline" className="ml-auto">{isLoading ? "…" : rows.length}</Badge>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label="refresh"
        >
          <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
        </Button>
      </div>
      {noEvent && (
        <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
          {t("admin.unpublished.noActiveEvent")}
        </div>
      )}
      <p className="mb-3 text-xs text-muted-foreground">{t("admin.unpublished.help")}</p>

      {isLoading && <Skeleton className="h-24 w-full" />}

      {!isLoading && error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-destructive" />
          <div className="flex-1">
            <div className="font-medium text-destructive">
              {t("admin.unpublished.loadError", "Erro ao carregar expositores não publicados")}
            </div>
            <div className="text-xs text-muted-foreground mt-1 break-all">
              [admin_list_unpublished_exhibitors] {(error as Error).message}
            </div>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => refetch()}>
              {t("common.retry", "Tentar novamente")}
            </Button>
          </div>
        </div>
      )}

      {!isLoading && !error && rows.length === 0 && (
        <p className="py-4 text-center text-xs text-muted-foreground">
          {t("admin.unpublished.empty", "Todos os expositores com empresa estão publicados.")}
        </p>
      )}

      {!isLoading && !error && rows.length > 0 && (
      <div className="space-y-2">
        {rows.map((r) => (
          <div
            key={r.profile_id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{r.full_name || r.email}</span>
                {r.trade_name && <span className="text-xs text-muted-foreground">· {r.trade_name}</span>}
              </div>
              <p className="truncate text-xs text-muted-foreground">{r.email}</p>
            </div>
            <Badge variant="destructive">{t(`admin.unpublished.reason.${r.reason}`, r.reason)}</Badge>
          </div>
        ))}
      </div>
      )}
    </Card>
  );
}