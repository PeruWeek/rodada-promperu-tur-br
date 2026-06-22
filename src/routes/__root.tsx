import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { consumeAuthHashError } from "@/lib/auth-hash-error";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "PERU MICE Networking Evento — Peru × Brasil" },
      { name: "description", content: "Plataforma oficial de matchmaking e agendamento da PERU MICE Networking Evento — Peru × Brasil. 08 de julho de 2026." },
      { name: "author", content: "PromPerú" },
      { property: "og:title", content: "PERU MICE Networking Evento — Peru × Brasil" },
      { property: "og:description", content: "Plataforma oficial de matchmaking e agendamento da PERU MICE Networking Evento — Peru × Brasil. 08 de julho de 2026." },
      { property: "og:type", content: "website" },
      { name: "twitter:title", content: "PERU MICE Networking Evento — Peru × Brasil" },
      { name: "twitter:description", content: "Plataforma oficial de matchmaking e agendamento da PERU MICE Networking Evento — Peru × Brasil. 08 de julho de 2026." },
      { property: "og:image", content: "https://rodada.promperu.tur.br/whatsapp-og.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "https://rodada.promperu.tur.br/whatsapp-og.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700;900&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <script
          // Mautic tracking pixel. Initializes `window.mt` used by
          // src/lib/mautic.ts to fire funnel events. Loaded just before
          // <Scripts /> so it's the last thing in <body>.
          dangerouslySetInnerHTML={{
            __html: `(function(w,d,t,u,n,a,m){w['MauticTrackingObject']=n;w[n]=w[n]||function(){(w[n].q=w[n].q||[]).push(arguments)},a=d.createElement(t),m=d.getElementsByTagName(t)[0];a.async=1;a.src=u;m.parentNode.insertBefore(a,m)})(window,document,'script','https://rsvp.kronedesign.com.br/mtc.js','mt');`,
          }}
        />
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    let lastUserId: string | null | undefined;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // Only react to identity transitions. Ignore INITIAL_SESSION and
      // TOKEN_REFRESHED (fires ~hourly + on tab focus) to avoid thrashing
      // the router and the query cache.
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") {
        return;
      }
      // Supabase fires SIGNED_IN on every tab focus/visibility regain once a
      // session exists. Filter to true identity changes so the email
      // confirmation callback doesn't loop router.invalidate +
      // queryClient.invalidateQueries on every focus.
      const nextUserId = session?.user?.id ?? null;
      if (event === "SIGNED_IN" && lastUserId === nextUserId) {
        return;
      }
      lastUserId = nextUserId;
      // Always re-run loaders so route gates re-evaluate.
      router.invalidate();
      // Never refetch protected queries against a cleared session — that
      // produces a 401 storm and "TypeError: Failed to fetch" in console.
      if (event !== "SIGNED_OUT") {
        queryClient.invalidateQueries();
      }
    });
    return () => subscription.unsubscribe();
  }, [queryClient, router]);

  useEffect(() => {
    // /auth/callback owns hash parsing — bail out before consuming, so the
    // callback page sees the original hash.
    if (typeof window !== "undefined" && window.location.pathname === "/auth/callback") return;
    const err = consumeAuthHashError();
    if (!err) return;
    // Recovery-flow errors must be handled on /reset-password itself, not
    // bounced to /login (which mixes recovery with signup confirmation).
    if (window.location.pathname === "/reset-password") return;
    const expired = err.errorCode === "otp_expired" || err.error === "access_denied";
    if (expired) {
      // Stable toast id deduplicates if anything re-triggers this branch.
      toast.error(
        "Seu link de confirmação expirou ou já foi usado. Reenvie abaixo.",
        { id: "auth-otp-expired" },
      );
      // Already on /login → the page renders its own expired-link alert; no
      // navigation needed. Otherwise use the router (no full reload, no
      // onAuthStateChange storm).
      if (window.location.pathname !== "/login") {
        router.navigate({
          to: "/login",
          search: { reason: "otp_expired" },
          replace: true,
        });
      }
    } else if (err.description) {
      toast.error(err.description, { id: "auth-hash-error" });
    }
    // router is stable across renders; effect still runs once because
    // consumeAuthHashError is guarded module-side.
  }, [router]);

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
