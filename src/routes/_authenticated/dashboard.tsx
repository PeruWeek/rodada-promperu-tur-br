import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useProfile, hasRole, getPrimaryRole } from "@/hooks/use-profile";
import { useProfileCompletion } from "@/hooks/use-profile-completion";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { t } = useTranslation();
  const { data: profile } = useProfile();
  const { data: completion } = useProfileCompletion();
  const isExhibitor = hasRole(profile?.roles, "exhibitor");
  const primaryRole = getPrimaryRole(profile?.roles);

  const showCompanyAndName = primaryRole === "visitor" || primaryRole === "exhibitor";
  const showCompletion = showCompanyAndName && completion && completion.percent < 100;

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
      {showCompletion && (
        <div className="mt-6 rounded-xl border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-base font-semibold">{t("dashboard.completionTitle")}</h2>
              <p className="text-sm text-muted-foreground">
                {t("dashboard.completionBody", { percent: completion!.percent })}
              </p>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link to="/profile">{t("dashboard.completionCta")}</Link>
            </Button>
          </div>
          <Progress value={completion!.percent} className="mt-4 h-2" />
        </div>
      )}
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
          <p className="mt-2 text-sm text-muted-foreground">{t("dashboard.completeProfile")}</p>
          <Button asChild className="mt-4" size="sm" variant="outline"><Link to={isExhibitor ? "/table-agenda" : "/agenda"}>{t("nav.agenda")}</Link></Button>
        </div>
      </div>
    </div>
  );
}