import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type LiveFilter =
  | "all"
  | "present"
  | "inMeeting"
  | "idle"
  | "atRisk"
  | "freeTables";

type Kpis = {
  present: number;
  inMeeting: number;
  idle: number;
  atRisk: number;
  freeTables: number;
};

export function KpiStrip({
  kpis,
  active,
  onSelect,
}: {
  kpis: Kpis;
  active: LiveFilter;
  onSelect: (f: LiveFilter) => void;
}) {
  const { t } = useTranslation();
  const items: Array<{ key: LiveFilter; label: string; value: number; tone: string }> = [
    { key: "present", label: t("admin.checkin.kpi.present"), value: kpis.present, tone: "text-emerald-600" },
    { key: "inMeeting", label: t("admin.checkin.kpi.inMeeting"), value: kpis.inMeeting, tone: "text-blue-600" },
    { key: "idle", label: t("admin.checkin.kpi.idle"), value: kpis.idle, tone: "text-amber-600" },
    { key: "atRisk", label: t("admin.checkin.kpi.atRisk"), value: kpis.atRisk, tone: "text-red-600" },
    { key: "freeTables", label: t("admin.checkin.kpi.freeTables"), value: kpis.freeTables, tone: "text-violet-600" },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {items.map((it) => {
        const isActive = active === it.key;
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onSelect(isActive ? "all" : it.key)}
            className="text-left"
          >
            <Card
              className={cn(
                "p-3 transition-colors hover:bg-muted/60",
                isActive && "ring-2 ring-primary",
              )}
            >
              <div className={cn("text-2xl font-semibold tabular-nums", it.tone)}>
                {it.value}
              </div>
              <div className="text-xs text-muted-foreground">{it.label}</div>
            </Card>
          </button>
        );
      })}
    </div>
  );
}