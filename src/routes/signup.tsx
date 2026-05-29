import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Cadastro — Rodada Peru 2026" }] }),
  component: SignupPage,
});

function SignupPage() {
  const { t, i18n } = useTranslation();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/onboarding`,
        data: {
          full_name: fullName,
          preferred_language: i18n.language?.startsWith("es") ? "es" : "pt-BR",
        },
      },
    });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setSent(true);
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-md px-4 py-12">
        <h1 className="text-3xl font-bold">{t("auth.signupTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("auth.signupSubtitle")}</p>
        {sent ? (
          <div className="mt-8 space-y-4 rounded-lg border bg-card p-6">
            <h2 className="text-lg font-semibold">{t("auth.checkEmailTitle")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("auth.checkEmailBody", { email })}
            </p>
            <p className="text-xs text-muted-foreground">{t("auth.checkEmailHint")}</p>
            <Link
              to="/login"
              search={{ reason: "otp_expired" }}
              className="inline-block text-sm font-medium text-primary hover:underline"
            >
              {t("auth.resendConfirmation")}
            </Link>
          </div>
        ) : (
        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <div><Label htmlFor="name">{t("auth.fullName")}</Label><Input id="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} className="mt-1.5" /></div>
          <div><Label htmlFor="email">{t("auth.email")}</Label><Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5" /></div>
          <div><Label htmlFor="password">{t("auth.password")}</Label><Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5" /></div>
          <Button type="submit" className="w-full" size="lg" disabled={loading}>{t("auth.submitSignup")}</Button>
          <p className="text-center text-sm text-muted-foreground"><Link to="/login" className="font-medium text-primary hover:underline">{t("auth.switchToLogin")}</Link></p>
        </form>
        )}
      </div>
    </div>
  );
}