import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useProfile, hasRole, getPrimaryRole } from "@/hooks/use-profile";
import { useVisitorReady } from "@/hooks/use-visitor-ready";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { t } = useTranslation();
  const { data: profile } = useProfile();
  const isExhibitor = hasRole(profile?.roles, "exhibitor");
  const primaryRole = getPrimaryRole(profile?.roles);
  const { data: visitorReady } = useVisitorReady();
  const ready = !!visitorReady?.ready;

  const showCompanyAndName = primaryRole === "visitor" || primaryRole === "exhibitor";

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="space-y-1">
        <p className="text-sm font-medium uppercase tracking-wide text-primary">
          {primaryRole ? t(`roles.${primaryRole}`) : ""}
        </p>
        {showCompanyAndName && (
          <>
            <p className="text-sm text-muted-foreground">
              {t("profile.companyLabel", { defaultValue: "Empresa:" })} {profile?.company_name ?? "—"}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("profile.nameLabel", { defaultValue: "Nome:" })} {profile?.full_name ?? "—"}
            </p>
          </>
        )}
      </div>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="text-lg font-bold">{t("dashboard.nextMeetingTitle")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("dashboard.noMeetings")}</p>
          {!isExhibitor && (
            <Button asChild className="mt-4" size="sm"><Link to="/explore">{t("dashboard.exploreCta")}<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
          )}
        </div>
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="text-lg font-bold">{isExhibitor ? t("dashboard.tableAgenda") : t("dashboard.myAgenda")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {isExhibitor || ready
              ? t("dashboard.agendaReady", { defaultValue: "Sua agenda está pronta. Veja seus horários e compromissos." })
              : t("dashboard.completeProfile")}
          </p>
          <Button asChild className="mt-4" size="sm" variant="outline"><Link to={isExhibitor ? "/table-agenda" : "/agenda"}>{t("nav.agenda")}</Link></Button>
        </div>
      </div>
    </div>
  );
}