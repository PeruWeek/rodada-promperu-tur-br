import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";

export const Route = createFileRoute("/auth/callback")({
  ssr: false,
  head: () => ({ meta: [{ title: "Entrando…" }] }),
  component: AuthCallbackPage,
});

type Status = "processing" | "error";

function AuthCallbackPage() {
  const navigate = useNavigate();
  const ran = useRef(false);
  const [status, setStatus] = useState<Status>("processing");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const goOnce = (path: string, search?: Record<string, string>) => {
      // Strip hash + query before navigating so refresh/back never re-runs
      // the callback.
      try {
        const { pathname } = window.location;
        window.history.replaceState(null, "", pathname);
      } catch {
        /* ignore */
      }
      navigate({ to: path as never, search: (search ?? {}) as never, replace: true });
    };

    void (async () => {
      // 1. Hash-level error from GoTrue (expired/used link).
      const hash = window.location.hash ?? "";
      if (hash.includes("error=")) {
        const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
        const errorCode = params.get("error_code");
        const error = params.get("error");
        const description = params.get("error_description")?.replace(/\+/g, " ") ?? "";
        const expired = errorCode === "otp_expired" || error === "access_denied";
        if (expired) {
          toast.error(
            "Seu link de confirmação expirou ou já foi usado. Reenvie abaixo.",
            { id: "auth-otp-expired" },
          );
          goOnce("/login", { reason: "otp_expired" });
          return;
        }
        setStatus("error");
        setMessage(description || "Não foi possível concluir a autenticação.");
        toast.error(description || "Não foi possível concluir a autenticação.", {
          id: "auth-callback-error",
        });
        return;
      }

      // 2. Wait for Supabase to consume tokens from the URL and establish a
      //    session. detectSessionInUrl runs asynchronously after mount, so
      //    poll briefly instead of racing it.
      let session = (await supabase.auth.getSession()).data.session;
      const deadline = Date.now() + 5000;
      while (!session && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 150));
        session = (await supabase.auth.getSession()).data.session;
      }
      if (!session) {
        goOnce("/login");
        return;
      }
      const userId = session.user.id;

      // 3. Resolve profile + roles directly (no React-Query roundtrip) so we
      //    can route once and exit.
      try {
        const [{ data: profile }, { data: rolesData }] = await Promise.all([
          supabase
            .from("profiles")
            .select("id, company_id")
            .eq("auth_user_id", userId)
            .maybeSingle(),
          supabase.from("user_roles").select("role").eq("user_id", userId),
        ]);
        const roles = (rolesData ?? []).map((r) => r.role as string);
        const has = (r: string) => roles.includes(r);

        if (has("admin") || has("staff")) {
          goOnce("/admin");
          return;
        }
        if (has("cliente")) {
          goOnce("/explore");
          return;
        }
        if (!profile) {
          goOnce("/onboarding");
          return;
        }
        if (has("exhibitor")) {
          if (profile.company_id) goOnce("/dashboard");
          else goOnce("/onboarding");
          return;
        }
        if (has("visitor")) {
          if (profile.company_id) goOnce("/agenda");
          else goOnce("/onboarding");
          return;
        }
        // No role yet → onboarding picks it up.
        goOnce("/onboarding");
      } catch (err) {
        console.error("[auth.callback] resolve failed", err);
        // Session exists; let the authenticated layout handle routing.
        goOnce("/onboarding");
      }
    })();
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        {status === "processing" ? (
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">Confirmando seu acesso…</p>
          </div>
        ) : (
          <div className="space-y-3">
            <h1 className="text-xl font-semibold">Não foi possível concluir a autenticação</h1>
            <p className="text-sm text-muted-foreground">{message}</p>
            <a
              href="/login"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Ir para o login
            </a>
          </div>
        )}
      </div>
    </div>
  );
}