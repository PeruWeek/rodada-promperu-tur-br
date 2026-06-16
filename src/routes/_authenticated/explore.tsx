import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Search, SlidersHorizontal, X } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ExhibitorCard, type ExhibitorListItem } from "@/components/exhibitor-card";
import { MultiSelectChips } from "@/components/multi-select-chips";

export const Route = createFileRoute("/_authenticated/explore")({
  component: ExplorePage,
});

function ExplorePage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [segments, setSegments] = useState<string[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [destinations, setDestinations] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["exhibitors-list"],
    queryFn: async (): Promise<ExhibitorListItem[]> => {
      const { data: rows, error: rpcErr } = await supabase.rpc("public_exhibitor_catalog");
      if (rpcErr) throw rpcErr;
      return (rows ?? []).map((r) => ({
        profile_id: r.profile_id,
        full_name: r.full_name ?? "",
        trade_name: r.trade_name ?? "—",
        country_code: r.country_code ?? null,
        city: r.city ?? null,
        table_number: r.table_number ?? null,
        segments: r.segments ?? [],
        services: r.services ?? [],
        destinations: r.destinations ?? [],
      }));
    },
    retry: false,
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    const result = data.filter((item) => {
      if (q && !item.trade_name.toLowerCase().includes(q) && !item.full_name.toLowerCase().includes(q)) return false;
      if (segments.length && !segments.some((s) => item.segments.includes(s))) return false;
      if (services.length && !services.some((s) => item.services.includes(s))) return false;
      if (destinations.length && !destinations.some((s) => item.destinations.includes(s))) return false;
      return true;
    });
    return result.sort((a, b) => {
      const an = a.table_number ?? Number.POSITIVE_INFINITY;
      const bn = b.table_number ?? Number.POSITIVE_INFINITY;
      if (an !== bn) return an - bn;
      return a.trade_name.localeCompare(b.trade_name);
    });
  }, [data, search, segments, services, destinations]);

  const activeFilterCount = segments.length + services.length + destinations.length;
  const clearFilters = () => { setSegments([]); setServices([]); setDestinations([]); };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{t("explore.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("explore.subtitle")}</p>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("explore.searchPlaceholder")}
            className="pl-9"
          />
        </div>
        <Button variant="outline" onClick={() => setFiltersOpen((v) => !v)}>
          <SlidersHorizontal size={16} />
          {t("explore.filters")}
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="ml-1">{activeFilterCount}</Badge>
          )}
        </Button>
      </div>

      {filtersOpen && (
        <div className="mt-4 space-y-5 rounded-xl border border-border bg-card p-5">
          <div>
            <div className="mb-2 text-sm font-semibold">{t("explore.segments")}</div>
            <MultiSelectChips taxonomyKey="segments" value={segments} onChange={setSegments} />
          </div>
          <div>
            <div className="mb-2 text-sm font-semibold">{t("explore.services")}</div>
            <MultiSelectChips taxonomyKey="services" value={services} onChange={setServices} />
          </div>
          <div>
            <div className="mb-2 text-sm font-semibold">{t("explore.destinations")}</div>
            <MultiSelectChips taxonomyKey="destinations" value={destinations} onChange={setDestinations} />
          </div>
          {activeFilterCount > 0 && (
            <Button size="sm" variant="ghost" onClick={clearFilters}>
              <X size={14} /> {t("explore.clearFilters")}
            </Button>
          )}
        </div>
      )}

      <div className="mt-6">
        {isLoading && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-48 rounded-xl" />
            ))}
          </div>
        )}

        {error && (
          (error as Error).message.includes("no_active_event") ? (
            <div className="rounded-xl border border-amber-400/40 bg-amber-500/5 p-6 text-sm text-amber-700 dark:text-amber-300">
              {t("explore.noActiveEvent")}
            </div>
          ) : (
            <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
              {(error as Error).message}
            </div>
          )
        )}

        {!isLoading && !error && filtered.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-12 text-center">
            <p className="text-sm text-muted-foreground">{t("explore.empty")}</p>
          </div>
        )}

        {!isLoading && filtered.length > 0 && (
          <>
            <p className="mb-3 text-xs text-muted-foreground">
              {t("explore.results", { count: filtered.length })}
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((item) => (
                <ExhibitorCard key={item.profile_id} item={item} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
