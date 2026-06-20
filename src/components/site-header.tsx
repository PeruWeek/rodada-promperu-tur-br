import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Menu, X } from "lucide-react";

import { LanguageSwitcher } from "./language-switcher";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useProfile, getPrimaryRole } from "@/hooks/use-profile";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import promperuLogo from "@/assets/promperu-logo.png";

export function SiteHeader() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const { data: profile, isLoading: profileLoading } = useProfile();
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const signOut = async () => {
    // Sign-Out Hygiene: cancel in-flight queries → clear cache → sign out →
    // replace history. Skipping any of these produces 401 / "Failed to fetch"
    // bursts and lets the Back button restore a stale protected shell.
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    router.invalidate();
    navigate({ to: "/", replace: true });
  };

  const primaryRole = getPrimaryRole(profile?.roles);
  const navItems = (() => {
    if (!user) return [] as Array<{ to: string; label: string }>;
    // Wait for profile to resolve before deciding role-based nav, otherwise
    // admins/exhibitors briefly see the visitor default nav (Explorar / Mi Agenda).
    if (profileLoading || !profile) return [] as Array<{ to: string; label: string }>;
    if (primaryRole === "admin") {
      return [
        { to: "/admin", label: t("nav.admin") },
        { to: "/profile", label: t("nav.profile") },
      ];
    }
    if (primaryRole === "staff") {
      return [
        { to: "/admin", label: t("nav.admin") },
      ];
    }
    if (primaryRole === "cliente") {
      return [
        { to: "/admin", label: t("nav.admin") },
        { to: "/explore", label: t("nav.explore") },
      ];
    }
    if (primaryRole === "exhibitor") {
      return [
        { to: "/dashboard", label: t("nav.dashboard") },
        { to: "/table-agenda", label: t("nav.tableAgenda") },
        { to: "/profile", label: t("nav.profile") },
      ];
    }
    // visitor (default)
    return [
      { to: "/dashboard", label: t("nav.dashboard") },
      { to: "/explore", label: t("nav.explore") },
      { to: "/agenda", label: t("nav.agenda") },
      { to: "/profile", label: t("nav.profile") },
    ];
  })();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2 font-bold text-foreground">
          <img src={promperuLogo} alt="PromPerú" className="h-8 w-8 rounded-sm object-contain" />
          <span className="text-sm sm:text-base">{t("common.appName")}</span>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
              activeProps={{ className: "text-foreground" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          {!loading && !user && (
            <div className="hidden sm:flex items-center gap-2">
              <Button asChild size="sm" variant="ghost">
                <Link to="/login">{t("nav.login")}</Link>
              </Button>
              <Button asChild size="sm">
                <Link to="/signup">{t("nav.signup")}</Link>
              </Button>
            </div>
          )}
          {!loading && user && (
            <Button onClick={signOut} size="sm" variant="ghost" className="hidden sm:inline-flex">
              {t("common.signOut")}
            </Button>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-md border border-border"
            aria-label="Menu"
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {open && (
        <div className={cn("md:hidden border-t border-border bg-background")}> 
          <div className="mx-auto max-w-6xl px-4 py-3 flex flex-col gap-1">
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
            {!user && (
              <div className="flex gap-2 pt-2">
                <Button asChild size="sm" variant="outline" className="flex-1">
                  <Link to="/login" onClick={() => setOpen(false)}>{t("nav.login")}</Link>
                </Button>
                <Button asChild size="sm" className="flex-1">
                  <Link to="/signup" onClick={() => setOpen(false)}>{t("nav.signup")}</Link>
                </Button>
              </div>
            )}
            {user && (
              <Button onClick={signOut} size="sm" variant="outline" className="mt-2">
                {t("common.signOut")}
              </Button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}