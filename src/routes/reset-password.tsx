import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { SiteHeader } from "@/components/site-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Nova senha — Rodada de Negócios Promperu 2026" }] }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    // Supabase parses the recovery hash automatically and emits PASSWORD_RECOVERY.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        setReady(true);
      }
    });
    // Fallback: if there is already a session (link was processed before listener mounted), allow.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    // If after a short delay there's no session and no hash, mark invalid.
    const timer = window.setTimeout(() => {
      const hash = window.location.hash || "";
      if (!ready && !hash.includes("access_token") && !hash.includes("type=recovery")) {
        supabase.auth.getSession().then(({ data }) => {
          if (!data.session) setInvalid(true);
        });
      }
    }, 1500);
    return () => {
      sub.subscription.unsubscribe();
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error(t("auth.passwordTooShort"));
      return;
    }
    if (password !== confirm) {
      toast.error(t("auth.passwordsDontMatch"));
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast.error(t("auth.invalidOrExpiredLink"));
      setInvalid(true);
      return;
    }
    toast.success(t("auth.passwordUpdated"));
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-md px-4 py-12">
        <h1 className="text-3xl font-bold">{t("auth.resetPasswordTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("auth.resetPasswordHelp")}</p>

        {invalid ? (
          <Alert className="mt-8">
            <AlertDescription>{t("auth.invalidOrExpiredLink")}</AlertDescription>
          </Alert>
        ) : (
          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            <div>
              <Label htmlFor="password">{t("auth.newPassword")}</Label>
              <PasswordInput
                id="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="confirm">{t("auth.confirmPassword")}</Label>
              <PasswordInput
                id="confirm"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="mt-1.5"
              />
            </div>
            <Button type="submit" className="w-full" size="lg" disabled={loading || !ready}>
              {loading ? "…" : t("auth.savePassword")}
            </Button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link to="/forgot-password" className="font-medium text-primary hover:underline">
            {t("auth.forgotPassword")}
          </Link>
          {" · "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            {t("auth.backToLogin")}
          </Link>
        </p>
      </div>
    </div>
  );
}