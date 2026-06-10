import { createFileRoute, Link, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { SiteHeader } from "@/components/site-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { supabase } from "@/integrations/supabase/client";

type LoginSearch = { reason?: string };

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Entrar — Rodada de Negócios Promperu 2026" }] }),
  validateSearch: (s: Record<string, unknown>): LoginSearch => ({
    reason: typeof s.reason === "string" ? s.reason : undefined,
  }),
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getUser();
    if (data.user) throw redirect({ to: "/dashboard" });
  },
  component: LoginPage,
});

function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const router = useRouter();
  const { reason } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const linkExpired = reason === "otp_expired";

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setLoading(false);
      toast.error(t("auth.errorInvalid"));
      return;
    }
    // Hide the form immediately and wait for the router to re-evaluate
    // before navigating. This prevents the brief flash where the "Entrar"
    // form remains visible while the header already shows "Sair".
    setRedirecting(true);
    await router.invalidate();
    navigate({ to: "/dashboard", replace: true });
  };

  const onResend = async () => {
    const target = email.trim().toLowerCase();
    if (!target) {
      toast.error(t("auth.resendNeedEmail"));
      return;
    }
    setResending(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: target,
      options: { emailRedirectTo: `${window.location.origin}/onboarding` },
    });
    setResending(false);
    if (error) {
      const msg = error.message?.toLowerCase() ?? "";
      if (msg.includes("rate") || msg.includes("limit") || msg.includes("seconds")) {
        toast.error("Aguarde alguns segundos antes de pedir outro reenvio.");
      } else if (msg.includes("already") || msg.includes("confirmed")) {
        toast.info("Este e-mail já está confirmado. Tente entrar normalmente.");
      } else {
        toast.error("Não foi possível reenviar agora. Tente novamente em instantes.");
      }
      setCooldown(30);
      return;
    }
    toast.success(t("auth.resendSuccess"));
    setCooldown(60);
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-md px-4 py-12">
        {redirecting ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">{t("auth.loginSuccessRedirecting", "Entrando…")}</p>
          </div>
        ) : (
        <>
        <h1 className="text-3xl font-bold">{t("auth.loginTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("auth.loginSubtitle")}</p>
        {linkExpired && (
          <Alert className="mt-6">
            <AlertTitle>{t("auth.linkExpiredTitle")}</AlertTitle>
            <AlertDescription>{t("auth.linkExpiredBody")}</AlertDescription>
          </Alert>
        )}
        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <div>
            <Label htmlFor="email">{t("auth.email")}</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor="password">{t("auth.password")}</Label>
            <PasswordInput id="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5" />
          </div>
          <Button type="submit" className="w-full" size="lg" disabled={loading}>
            {t("auth.submitLogin")}
          </Button>
          {linkExpired && (
            <Button type="button" variant="outline" className="w-full" size="lg" onClick={onResend} disabled={resending || cooldown > 0}>
              {resending ? "…" : cooldown > 0 ? `${t("auth.resendConfirmation")} (${cooldown}s)` : t("auth.resendConfirmation")}
            </Button>
          )}
          <p className="text-center text-sm text-muted-foreground">
            <Link to="/signup" className="font-medium text-primary hover:underline">
              {t("auth.switchToSignup")}
            </Link>
          </p>
          <p className="text-center text-sm text-muted-foreground">
            <Link to="/forgot-password" className="font-medium text-primary hover:underline">
              {t("auth.forgotPassword")}
            </Link>
          </p>
        </form>
        </>
        )}
      </div>
    </div>
  );
}