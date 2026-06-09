import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { SiteHeader } from "@/components/site-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Recuperar senha — Rodada de Negócios Promperu 2026" }] }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = email.trim().toLowerCase();
    if (!target) return;
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(target, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) {
      // Do not leak whether the email exists — show same success state.
      // eslint-disable-next-line no-console
      console.warn("resetPasswordForEmail error", error.message);
    }
    setSent(true);
    toast.success(t("auth.resetEmailSent"));
  };

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
            <Button type="submit" className="w-full" size="lg" disabled={loading}>
              {loading ? "…" : t("auth.sendResetLink")}
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