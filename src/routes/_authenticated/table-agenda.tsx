import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Table2, User } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { formatSlotFull } from "@/components/booking-dialog";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/table-agenda")({
  component: TableAgendaPage,
});

function TableAgendaPage() {
  const { t, i18n } = useTranslation();
  const { data: profile } = useProfile();

  const { data, isLoading } = useQuery({
    queryKey: ["table-agenda", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data: tbl } = await supabase
        .from("event_tables")
        .select("id, table_number")
        .eq("exhibitor_profile_id", profile!.id)
        .maybeSingle();
      if (!tbl) return { table: null, meetings: [] };
      const { data: meetings } = await supabase
        .from("meetings")
        .select("id, status, slot_id, visitor_profile_id")
        .eq("table_id", tbl.id)
        .eq("status", "scheduled");
      const slotIds = (meetings ?? []).map((m) => m.slot_id);
      const visIds = (meetings ?? []).map((m) => m.visitor_profile_id);
      const [{ data: slots }, { data: profs }] = await Promise.all([
        slotIds.length
          ? supabase.from("time_slots").select("id, start_at, end_at").in("id", slotIds)
          : Promise.resolve({ data: [] as Array<{ id: string; start_at: string; end_at: string }> }),
        visIds.length
          ? supabase.from("profiles").select("id, full_name, company_id").in("id", visIds)
          : Promise.resolve({ data: [] as Array<{ id: string; full_name: string; company_id: string | null }> }),
      ]);
      const compIds = (profs ?? []).map((p) => p.company_id).filter(Boolean) as string[];
      const { data: comps } = compIds.length
        ? await supabase.from("companies").select("id, trade_name, country_code, city").in("id", compIds)
        : { data: [] as Array<{ id: string; trade_name: string; country_code: string; city: string | null }> };
      const enriched = (meetings ?? []).map((m) => {
        const slot = slots?.find((s) => s.id === m.slot_id);
        const visitor = profs?.find((p) => p.id === m.visitor_profile_id);
        const company = comps?.find((c) => c.id === visitor?.company_id);
        return { ...m, slot, visitor, company };
      });
      enriched.sort((a, b) => (a.slot?.start_at ?? "").localeCompare(b.slot?.start_at ?? ""));
      return { table: tbl, meetings: enriched };
    },
  });

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
        <Badge variant="outline" className="text-sm">
          <Table2 size={14} className="mr-1" /> {t("explore.table")} {data.table.table_number}
        </Badge>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{t("tableAgenda.subtitle")}</p>

      {data.meetings.length === 0 ? (
        <Card className="mt-6 p-6 text-sm text-muted-foreground">{t("tableAgenda.empty")}</Card>
      ) : (
        <div className="mt-6 space-y-2">
          {data.meetings.map((m) => (
            <Card key={m.id} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-primary">
                  {m.slot ? formatSlotFull(m.slot.start_at, i18n.language) : "—"}
                </p>
                <p className="mt-0.5 truncate font-medium">{m.company?.trade_name ?? m.visitor?.full_name ?? "—"}</p>
                <p className="mt-0.5 text-xs text-muted-foreground inline-flex items-center gap-1">
                  <User size={12} />{m.visitor?.full_name}
                  {m.company?.city ? ` · ${m.company.city}` : ""}
                  {m.company?.country_code ? ` · ${m.company.country_code}` : ""}
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}