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
  head: () => ({ meta: [{ title: "Nova senha — PERU MICE Networking Evento" }] }),
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

    // Recovery handling strategy:
    // The Supabase browser client auto-processes the URL on init
    // (`detectSessionInUrl: true`): it consumes `?code=` (PKCE) or
    // `#access_token=...&type=recovery` (implicit) and fires PASSWORD_RECOVERY
    // / SIGNED_IN once the session is ready. We MUST NOT race it with our own
    // exchange/setSession calls — doing so causes "code already used" failures
    // (PKCE) or clobbers tokens that were already consumed (implicit), which
    // is the regression that shows "Link inválido ou expirado".
    //
    // So we only:
    //   1. Subscribe to onAuthStateChange and markReady on a valid event.
    //   2. Check immediately if a session already exists (re-entry / refresh).
    //   3. Surface the recovery-specific error UI ONLY when the hash carries
    //      an explicit `error=`/`error_code=` (e.g. otp_expired) — never on
    //      timeout, because slow auto-detect must not be treated as invalid.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (
        event === "PASSWORD_RECOVERY" ||
        ((event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") && session)
      ) {
        markReady();
      }
    });

    // Explicit-error short-circuit: only an actual auth error in the hash
    // marks the link invalid up-front. We intentionally do NOT clear the
    // hash/query — Supabase's auto-detect still needs to read them.
    const rawHash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    const hashParams = new URLSearchParams(rawHash);
    const hashError = hashParams.get("error_code") ?? hashParams.get("error");
    if (hashError) {
      // Strip the error from the URL so a refresh doesn't keep re-triggering.
      const { pathname, search } = window.location;
      window.history.replaceState(null, "", pathname + search);
      setInvalid(true);
    }

    // Re-entry: if the user already has a session in this tab (e.g. they
    // landed here from a previous successful processing), mark ready.
    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) markReady();
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
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
      // Do NOT mark the link as invalid here — the recovery session is valid
      // (we got here past PASSWORD_RECOVERY / SIGNED_IN). A failure on
      // updateUser is almost always a password-policy rejection (422):
      // "New password should be different from the old password",
      // HIBP/leaked-password, or min-length. Surface the real reason so the
      // user can try a different password instead of asking for a new link.
      const msg = error.message || t("auth.invalidOrExpiredLink");
      toast.error(msg);
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
          <div className="mt-8 space-y-4">
            <Alert>
              <AlertDescription>{t("auth.invalidOrExpiredLink")}</AlertDescription>
            </Alert>
            <Button asChild className="w-full" size="lg">
              <Link to="/forgot-password">{t("auth.sendResetLink")}</Link>
            </Button>
          </div>
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