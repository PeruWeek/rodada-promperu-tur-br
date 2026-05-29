import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, Calendar, FileText, Users2, Briefcase } from "lucide-react";

import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Rodada Peru 2026 — Matchmaking MICE Peru × Brasil" },
      { name: "description", content: "Plataforma oficial de matchmaking e agendamento da Rodada de Negócios MICE Peru × Brasil. 08 de julho de 2026." },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  const { t } = useTranslation();

  const steps = [
    { icon: Users2, title: t("landing.step1Title"), body: t("landing.step1Body") },
    { icon: Briefcase, title: t("landing.step2Title"), body: t("landing.step2Body") },
    { icon: Calendar, title: t("landing.step3Title"), body: t("landing.step3Body") },
    { icon: FileText, title: t("landing.step4Title"), body: t("landing.step4Body") },
  ];

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-gradient-to-br from-primary/5 via-background to-background"
        />
        <div
          aria-hidden
          className="absolute -top-24 -right-24 -z-10 h-72 w-72 rounded-full bg-primary/10 blur-3xl"
        />
        <div className="mx-auto max-w-6xl px-4 py-16 md:py-24">
          <p className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">
            {t("landing.heroEyebrow")}
          </p>
          <h1 className="mt-6 max-w-3xl text-4xl font-black leading-tight text-foreground sm:text-5xl md:text-6xl">
            {t("landing.heroTitle")}
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
            {t("landing.heroSubtitle")}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg" className="text-base">
              <Link to="/signup">
                {t("landing.ctaSignup")}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="text-base">
              <Link to="/login">{t("landing.ctaLogin")}</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-border bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-16 md:py-20">
          <h2 className="text-2xl font-bold sm:text-3xl">{t("landing.howTitle")}</h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s, i) => (
              <div
                key={s.title}
                className="rounded-xl border border-border bg-card p-6 transition-shadow hover:shadow-md"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <s.icon size={20} />
                </div>
                <div className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {String(i + 1).padStart(2, "0")}
                </div>
                <h3 className="mt-1 text-lg font-bold">{s.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-muted-foreground">
          © 2026 PromPerú · {t("common.tagline")}
        </div>
      </footer>
    </div>
  );
}
