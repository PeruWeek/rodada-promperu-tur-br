import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { SiteHeader } from "@/components/site-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Recuperar senha — PERU MICE Networking Evento" }] }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [technicalError, setTechnicalError] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = email.trim().toLowerCase();
    if (!target) return;
    setLoading(true);
    setTechnicalError(false);
    const { error } = await supabase.auth.resetPasswordForEmail(target, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) {
      const status = (error as { status?: number }).status;
      const message = error.message ?? "";
      // Keep anti-enumeration: do NOT show user-existence info. But
      // differentiate REAL technical failures from the (silent) success.
      // Supabase returns 200 for unknown emails; if we got here it is a
      // genuine failure (rate-limit, network, 5xx, config error).
      console.error("[forgot-password] resetPasswordForEmail failed", {
        email: target,
        status,
        code: (error as { code?: string }).code,
        message,
      });
      const isRate =
        status === 429 ||
        /rate|limit|seconds/i.test(message);
      if (isRate) {
        setCooldown(45);
        toast.error(t("auth.forgotRateLimited", "Aguarde alguns segundos e tente novamente."));
      } else {
        setTechnicalError(true);
        toast.error(
          t(
            "auth.forgotTechnicalError",
            "Não foi possível processar agora. Tente novamente em instantes.",
          ),
        );
      }
      return;
    }
    setSent(true);
    toast.success(t("auth.resetEmailSent"));
  };

  // Cooldown countdown for rate-limit retries.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-md px-4 py-12">
        <h1 className="text-3xl font-bold">{t("auth.forgotPasswordTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("auth.forgotPasswordHelp")}</p>

        {sent ? (
          <Alert className="mt-8">
            <AlertDescription>{t("auth.resetEmailSent")}</AlertDescription>
          </Alert>
        ) : (
          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            {technicalError && (
              <Alert variant="destructive">
                <AlertDescription>
                  {t(
                    "auth.forgotTechnicalError",
                    "Não foi possível processar agora. Tente novamente em instantes.",
                  )}
                </AlertDescription>
              </Alert>
            )}
            <div>
              <Label htmlFor="email">{t("auth.email")}</Label>
              <Input
                id="email"
                type="email"
                required
                maxLength={255}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1.5"
              />
            </div>
            <Button type="submit" className="w-full" size="lg" disabled={loading || cooldown > 0}>
              {loading
                ? "…"
                : cooldown > 0
                  ? `${t("auth.sendResetLink")} (${cooldown}s)`
                  : t("auth.sendResetLink")}
            </Button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link to="/login" className="font-medium text-primary hover:underline">
            {t("auth.backToLogin")}
          </Link>
        </p>
      </div>
    </div>
  );
}