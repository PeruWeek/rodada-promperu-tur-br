import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
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
  const readyRef = useRef(false);
  const markReady = () => {
    readyRef.current = true;
    setReady(true);
  };

  useEffect(() => {
    let cancelled = false;

    // 1) Listen for Supabase emitting PASSWORD_RECOVERY / SIGNED_IN once it
    //    finishes processing the URL (hash or PKCE code).
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session) || (event === "INITIAL_SESSION" && session)) {
        if (!cancelled) markReady();
      }
    });

    // 2) Explicitly handle the modern flow where the email link redirects to
    //    /reset-password?token_hash=...&type=recovery (verifyOtp) or ?code=...
    //    (PKCE). detectSessionInUrl handles hash tokens automatically.
    const url = new URL(window.location.href);
    const tokenHash = url.searchParams.get("token_hash");
    const typeParam = url.searchParams.get("type");
    const code = url.searchParams.get("code");
    (async () => {
      try {
        if (tokenHash && (typeParam === "recovery" || typeParam === null)) {
          const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
          if (!cancelled) {
            if (error) setInvalid(true);
            else markReady();
          }
          // Clean query so refresh doesn't retry a consumed token
          url.searchParams.delete("token_hash");
          url.searchParams.delete("type");
          window.history.replaceState(null, "", url.pathname + (url.search ? url.search : ""));
          return;
        }
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (!cancelled) {
            if (error) setInvalid(true);
            else markReady();
          }
          url.searchParams.delete("code");
          window.history.replaceState(null, "", url.pathname + (url.search ? url.search : ""));
          return;
        }
      } catch {
        if (!cancelled) setInvalid(true);
      }
    })();

    // 3) Poll getSession() for up to ~5s — covers the hash-flow case where
    //    Supabase auto-creates the session asynchronously and the listener
    //    may have missed the event (subscribed too late).
    let attempts = 0;
    const interval = window.setInterval(async () => {
      if (cancelled || readyRef.current) {
        window.clearInterval(interval);
        return;
      }
      attempts += 1;
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        markReady();
        window.clearInterval(interval);
        return;
      }
      if (attempts >= 25) {
        window.clearInterval(interval);
        if (!readyRef.current && !cancelled) setInvalid(true);
      }
    }, 200);

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
      window.clearInterval(interval);
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