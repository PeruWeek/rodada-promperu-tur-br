import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ExternalLink, Globe, Instagram, Linkedin, MapPin, Table2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { COUNTRIES, taxonomyLabel } from "@/lib/taxonomy";
import { BookingDialog } from "@/components/booking-dialog";

export const Route = createFileRoute("/_authenticated/exhibitor/$id")({
  component: ExhibitorDetailPage,
});

function ExhibitorDetailPage() {
  const { id } = Route.useParams();
  const { t, i18n } = useTranslation();
  const lang = (i18n.language === "es" ? "es" : "pt-BR") as "pt-BR" | "es";

  const { data, isLoading, error } = useQuery({
    queryKey: ["exhibitor-detail", id],
    queryFn: async () => {
      const { data: exh, error: exhErr } = await supabase
        .from("exhibitor_profiles")
        .select("*")
        .eq("profile_id", id)
        .maybeSingle();
      if (exhErr) throw exhErr;
      if (!exh) return null;
      const { data: prof } = await supabase
        .from("profiles")
        .select("id, auth_user_id, full_name, company_id, preferred_language, is_active")
        .eq("id", id)
        .maybeSingle();
      const { data: comp } = prof?.company_id
        ? await supabase.from("companies").select("*").eq("id", prof.company_id).maybeSingle()
        : { data: null };
      const { data: table } = await supabase
        .from("event_tables")
        .select("table_number")
        .eq("exhibitor_profile_id", id)
        .maybeSingle();
      return { exh, prof, comp, table };
    },
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 px-4 py-10">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !data || !data.exh) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <p className="text-sm text-muted-foreground">{t("explore.notFound")}</p>
        <Button asChild variant="ghost" className="mt-4">
          <Link to="/explore"><ArrowLeft size={16} /> {t("common.back")}</Link>
        </Button>
      </div>
    );
  }

  const { exh, prof, comp, table } = data;
  const pitch = lang === "es" ? exh.pitch_es : exh.pitch_pt;
  const portfolio = lang === "es" ? exh.portfolio_es : exh.portfolio_pt;
  const country = COUNTRIES.find((c) => c.value === comp?.country_code);
  const countryLabel = country ? (lang === "es" ? country.es : country.pt) : comp?.country_code;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link to="/explore"><ArrowLeft size={16} /> {t("common.back")}</Link>
      </Button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">{comp?.trade_name ?? "—"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{prof?.full_name}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {countryLabel && (
              <span className="inline-flex items-center gap-1"><MapPin size={14} />{[comp?.city, countryLabel].filter(Boolean).join(", ")}</span>
            )}
            {table?.table_number != null && (
              <span className="inline-flex items-center gap-1"><Table2 size={14} />{t("explore.table")} {table.table_number}</span>
            )}
          </div>
        </div>
        <BookingDialog exhibitorProfileId={id} exhibitorName={comp?.trade_name ?? prof?.full_name ?? undefined} />
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {pitch && (
          <Card className="p-5 md:col-span-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("explore.pitch")}</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{pitch}</p>
          </Card>
        )}

        {portfolio && (
          <Card className="p-5 md:col-span-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("explore.portfolio")}</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{portfolio}</p>
          </Card>
        )}

        {(exh.segments?.length ?? 0) > 0 && (
          <TagSection title={t("explore.segments")} items={exh.segments!} taxonomyKey="segments" lang={lang} />
        )}
        {(exh.services?.length ?? 0) > 0 && (
          <TagSection title={t("explore.services")} items={exh.services!} taxonomyKey="services" lang={lang} />
        )}
        {(exh.destinations?.length ?? 0) > 0 && (
          <TagSection title={t("explore.destinations")} items={exh.destinations!} taxonomyKey="destinations" lang={lang} />
        )}
        {(exh.target_buyers?.length ?? 0) > 0 && (
          <TagSection title={t("explore.targetBuyers")} items={exh.target_buyers!} taxonomyKey="buyer_types" lang={lang} />
        )}

        {(exh.materials_links?.length ?? 0) > 0 && (
          <Card className="p-5 md:col-span-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("explore.materials")}</h2>
            <ul className="mt-2 space-y-1.5">
              {exh.materials_links!.map((url) => (
                <li key={url}>
                  <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                    <ExternalLink size={14} /> {url}
                  </a>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {(comp?.website || comp?.linkedin || comp?.instagram) && (
          <Card className="p-5 md:col-span-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("explore.contact")}</h2>
            <div className="mt-2 flex flex-wrap gap-3 text-sm">
              {comp?.website && <a href={comp.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-primary hover:underline"><Globe size={14} />{comp.website}</a>}
              {comp?.linkedin && <a href={comp.linkedin} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-primary hover:underline"><Linkedin size={14} />LinkedIn</a>}
              {comp?.instagram && <a href={comp.instagram} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-primary hover:underline"><Instagram size={14} />Instagram</a>}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function TagSection({ title, items, taxonomyKey, lang }: { title: string; items: string[]; taxonomyKey: "segments" | "services" | "destinations" | "buyer_types"; lang: "pt-BR" | "es" }) {
  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.map((v) => (
          <Badge key={v} variant="secondary" className="font-normal">{taxonomyLabel(taxonomyKey, v, lang)}</Badge>
        ))}
      </div>
    </Card>
  );
}
