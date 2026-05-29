import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useProfile, hasRole } from "@/hooks/use-profile";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { t } = useTranslation();
  const { data: profile } = useProfile();
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-bold">{t("dashboard.welcome", { name: profile?.full_name ?? "" })}</h1>
      <div className="mt-2 flex flex-wrap gap-2">
        {profile?.roles.map((r) => (
          <span key={r} className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase text-primary">{t(`roles.${r}`)}</span>
        ))}
      </div>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="text-lg font-bold">{t("dashboard.nextMeetingTitle")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("dashboard.noMeetings")}</p>
          <Button asChild className="mt-4" size="sm"><Link to="/explore">{t("dashboard.exploreCta")}<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
        </div>
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="text-lg font-bold">{hasRole(profile?.roles, "exhibitor") ? t("dashboard.tableAgenda") : t("dashboard.myAgenda")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("dashboard.completeProfile")}</p>
          <Button asChild className="mt-4" size="sm" variant="outline"><Link to={hasRole(profile?.roles, "exhibitor") ? "/table-agenda" : "/agenda"}>{t("nav.agenda")}</Link></Button>
        </div>
      </div>
    </div>
  );
}