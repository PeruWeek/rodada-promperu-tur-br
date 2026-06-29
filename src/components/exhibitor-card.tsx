import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Table2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TAXONOMY } from "@/lib/taxonomy";

export interface ExhibitorListItem {
  profile_id: string;
  full_name: string;
  trade_name: string;
  country_code: string | null;
  city: string | null;
  table_number: number | null;
  segments: string[];
  services: string[];
  destinations: string[];
}

export function ExhibitorCard({ item }: { item: ExhibitorListItem }) {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language === "es" ? "es" : "pt") as "pt" | "es";

  const segmentChips = item.segments
    .slice(0, 3)
    .map((s) => TAXONOMY.segments.find((x) => x.value === s))
    .filter(Boolean);

  return (
    <Card className="flex flex-col gap-3 p-5 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-bold text-lg">{item.trade_name}</h3>
          <p className="truncate text-xs text-muted-foreground">{item.full_name}</p>
        </div>
        {item.table_number != null && (
          <Badge variant="secondary" className="shrink-0 gap-1">
            <Table2 size={12} /> {t("explore.table")} {item.table_number}
          </Badge>
        )}
      </div>

      {segmentChips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {segmentChips.map((s) => (
            <Badge key={s!.value} variant="outline" className="font-normal">
              {lang === "es" ? s!.es : s!.pt}
            </Badge>
          ))}
          {item.segments.length > 3 && (
            <Badge variant="outline" className="font-normal">+{item.segments.length - 3}</Badge>
          )}
        </div>
      )}

      <div className="mt-auto pt-2">
        <Button asChild size="sm" className="w-full bg-primary text-primary-foreground shadow-sm hover:bg-primary/90">
          <Link to="/exhibitor/$id" params={{ id: item.profile_id }}>
            {t("explore.viewProfileAndSchedule")}
          </Link>
        </Button>
      </div>
    </Card>
  );
}
