import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Calendar, Download, MapPin, Table2, X } from "lucide-react";
import { toast } from "sonner";
import { useEffect, useRef } from "react";

import { supabase } from "@/integrations/supabase/client";
import { hasRole, useProfile } from "@/hooks/use-profile";
import { useAuth } from "@/hooks/use-auth";
import { ensureBuyerWelcomeEmail } from "@/lib/buyer-welcome-email";
import { cancelMeeting } from "@/lib/booking.functions";
import { formatSlotFull } from "@/components/booking-dialog";
import { buildAgendaPdf } from "@/lib/pdf";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/agenda")({
  component: AgendaPage,
});

function AgendaPage() {
  const { t, i18n } = useTranslation();
  const { data: profile } = useProfile();
  const { user } = useAuth();
  const qc = useQueryClient();
  const cancelFn = useServerFn(cancelMeeting);
  const welcomeFiredRef = useRef(false);

  // Safety net: any visitor with completed signup but no welcome_email_sent_at
  // gets the welcome email on next /agenda visit. Idempotent client-side
  // (ref + metadata gate) and server-side (idempotencyKey).
  useEffect(() => {
    if (welcomeFiredRef.current) return;
    if (!user || !profile) return;
    if (!profile.company_id) return;
    if (!hasRole(profile.roles, "visitor")) return;
    if (!user.email) return;
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    if (meta.welcome_email_sent_at) return;
    welcomeFiredRef.current = true;
    void ensureBuyerWelcomeEmail({
      userId: user.id,
      email: user.email,
      fullName: profile.full_name,
      alreadySentAt: null,
    });
  }, [user, profile]);

  const { data: meetings, isLoading } = useQuery({
    queryKey: ["my-agenda", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data: m } = await supabase
        .from("meetings")
        .select("id, status, table_id, slot_id, event_id")
        .eq("visitor_profile_id", profile!.id)
        .order("created_at");
      if (!m || m.length === 0) return [];
      const slotIds = m.map((x) => x.slot_id);
      const tableIds = m.map((x) => x.table_id);
      const [{ data: slots }, { data: tables }] = await Promise.all([
        supabase.from("time_slots").select("id, start_at, end_at").in("id", slotIds),
        supabase.from("event_tables").select("id, table_number, exhibitor_profile_id").in("id", tableIds),
      ]);
      const exhProfileIds = (tables ?? []).map((t) => t.exhibitor_profile_id).filter(Boolean) as string[];
      const { data: profs } = exhProfileIds.length
        ? await supabase.rpc("public_profiles", { _ids: exhProfileIds })
        : { data: [] as Array<{ id: string; full_name: string; company_id: string | null }> };
      const companyIds = (profs ?? []).map((p) => p.company_id).filter(Boolean) as string[];
      const { data: comps } = companyIds.length
        ? await supabase.rpc("public_companies", { _ids: companyIds })
        : { data: [] as Array<{ id: string; trade_name: string; country_code: string }> };
      return m.map((mtg) => {
        const slot = slots?.find((s) => s.id === mtg.slot_id);
        const tbl = tables?.find((t) => t.id === mtg.table_id);
        const exh = profs?.find((p) => p.id === tbl?.exhibitor_profile_id);
        const comp = comps?.find((c) => c.id === exh?.company_id);
        return { ...mtg, slot, table: tbl, exhibitor: exh, company: comp };
      });
    },
  });

  const cancelMut = useMutation({
    mutationFn: async (meetingId: string) => cancelFn({ data: { meetingId } }),
    onSuccess: () => {
      toast.success(t("agenda.cancelled"));
      qc.invalidateQueries({ queryKey: ["my-agenda"] });
    },
    onError: () => toast.error(t("agenda.cancelError")),
  });

  const scheduled = (meetings ?? [])
    .filter((m) => m.status === "scheduled")
    .sort((a, b) => (a.slot?.start_at ?? "").localeCompare(b.slot?.start_at ?? ""));
  const others = (meetings ?? []).filter((m) => m.status !== "scheduled");

  const downloadPdf = () => {
    const doc = buildAgendaPdf({
      title: t("agenda.pdfTitle"),
      subtitle: t("common.appName"),
      ownerName: profile?.full_name ?? "",
      generatedLabel: t("agenda.pdfGenerated", { date: new Date().toLocaleString(i18n.language === "es" ? "es" : "pt-BR") }),
      rows: scheduled.map((m) => ({
        time: m.slot ? formatSlotFull(m.slot.start_at, i18n.language) : "—",
        withName: m.company?.trade_name ?? m.exhibitor?.full_name ?? "—",
        table: m.table?.table_number != null ? `#${m.table.table_number}` : "—",
        location: m.company?.country_code ?? "",
      })),
    });
    doc.save(`agenda-${(profile?.full_name ?? "user").replace(/\s+/g, "-").toLowerCase()}.pdf`);
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{t("agenda.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("agenda.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={downloadPdf} disabled={scheduled.length === 0}>
            <Download size={14} /> {t("agenda.downloadPdf")}
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/explore">{t("agenda.exploreCta")}</Link>
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="mt-6 space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : scheduled.length === 0 && others.length === 0 ? (
        <Card className="mt-8 p-8 text-center">
          <Calendar className="mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t("agenda.empty")}</p>
          <Button asChild className="mt-4">
            <Link to="/explore">{t("agenda.exploreCta")}</Link>
          </Button>
        </Card>
      ) : (
        <div className="mt-6 space-y-3">
          {scheduled.map((m) => (
            <Card key={m.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-primary">
                  {m.slot ? formatSlotFull(m.slot.start_at, i18n.language) : "—"}
                </p>
                <p className="mt-0.5 truncate font-medium">{m.company?.trade_name ?? m.exhibitor?.full_name ?? "—"}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {m.table?.table_number != null && (
                    <span className="inline-flex items-center gap-1"><Table2 size={12} />{t("explore.table")} {m.table.table_number}</span>
                  )}
                  {m.company?.country_code && (
                    <span className="inline-flex items-center gap-1"><MapPin size={12} />{m.company.country_code}</span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                {m.exhibitor?.id && (
                  <Button asChild variant="ghost" size="sm">
                    <Link to="/exhibitor/$id" params={{ id: m.exhibitor.id }}>{t("explore.viewDetails")}</Link>
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => cancelMut.mutate(m.id)}
                  disabled={cancelMut.isPending}
                >
                  <X size={14} /> {t("agenda.cancel")}
                </Button>
              </div>
            </Card>
          ))}
          {others.length > 0 && (
            <>
              <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("agenda.history")}</h2>
              {others.map((m) => (
                <Card key={m.id} className="flex items-center justify-between p-3 opacity-70">
                  <div>
                    <p className="text-sm">{m.company?.trade_name ?? m.exhibitor?.full_name ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">{m.slot ? formatSlotFull(m.slot.start_at, i18n.language) : ""}</p>
                  </div>
                  <Badge variant="secondary">{t(`agenda.status.${m.status}`)}</Badge>
                </Card>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}