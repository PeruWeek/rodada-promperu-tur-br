import { createFileRoute, Outlet, redirect, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";
import { useProfile, hasRole, getPrimaryRole } from "@/hooks/use-profile";
import { getMyExhibitorRequest } from "@/lib/exhibitor-requests.functions";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: profile, isLoading: profileLoading } = useProfile();
  const fetchReq = useServerFn(getMyExhibitorRequest);

  const isAdminStaff = hasRole(profile?.roles, "admin", "staff", "cliente");
  const primaryRole = getPrimaryRole(profile?.roles);

  const { data: reqData, isLoading: reqLoading } = useQuery({
    queryKey: ["my-exhibitor-request"],
    queryFn: () => fetchReq(),
    enabled: !!profile && !isAdminStaff && primaryRole === "exhibitor",
  });

  useEffect(() => {
    if (profileLoading || reqLoading || !profile) return;

    // While the buyer success screen is showing on /onboarding, do not let
    // any gating decision pull the user away before the 8s redirect runs.
    const buyerSuccessPending =
      typeof window !== "undefined" &&
      window.sessionStorage.getItem("buyer_success_pending") === "1";
    if (buyerSuccessPending && pathname === "/onboarding") return;

    // Route gating by primary role
    const adminStaffForbidden = ["/explore", "/agenda", "/table-agenda", "/dashboard", "/onboarding", "/pending-exhibitor"];
    // Cliente has read-only access to /explore and /exhibitor/* — keep the rest blocked.
    const clienteForbidden = ["/agenda", "/table-agenda", "/dashboard", "/onboarding", "/pending-exhibitor"];
    if (primaryRole === "admin" || primaryRole === "staff" || primaryRole === "cliente") {
      const forbidden = primaryRole === "cliente" ? clienteForbidden : adminStaffForbidden;
      const fallback = primaryRole === "cliente" ? "/explore" : "/admin";
      if (forbidden.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
        navigate({ to: fallback });
        return;
      }
      if ((primaryRole === "staff" || primaryRole === "cliente") && (pathname === "/profile" || pathname.startsWith("/profile/"))) {
        navigate({ to: fallback });
        return;
      }
    } else if (primaryRole === "visitor") {
      if (pathname.startsWith("/admin") || pathname === "/table-agenda") {
        navigate({ to: "/dashboard" });
        return;
      }
    } else if (primaryRole === "exhibitor") {
      if (pathname.startsWith("/admin") || pathname === "/agenda" || pathname === "/explore" || pathname.startsWith("/explore/") || pathname.startsWith("/exhibitor/")) {
        navigate({ to: "/dashboard" });
        return;
      }
    }

    if (isAdminStaff) return;

    const req = reqData?.request;
    const onPending = pathname === "/pending-exhibitor";
    const onProfile = pathname === "/profile";

    // Exhibitors: gate by request status only; never send to onboarding.
    if (primaryRole === "exhibitor") {
      if (req && (req.status === "pending" || req.status === "rejected") && !onPending && !onProfile) {
        navigate({ to: "/pending-exhibitor" });
      }
      return;
    }

    // Visitors: only send to onboarding if they truly have no company yet
    // (legacy users created before the buyer-signup form). Anyone with a
    // company_id already completed signup and should never see the picker.
    if (primaryRole === "visitor") {
      if (!profile.company_id && pathname !== "/onboarding" && !onProfile) {
        navigate({ to: "/onboarding" });
      }
      return;
    }

    // Fallback: no role at all yet → onboarding.
    if (!primaryRole && pathname !== "/onboarding" && !onProfile) {
      navigate({ to: "/onboarding" });
    }
  }, [profile, profileLoading, reqData, reqLoading, isAdminStaff, primaryRole, pathname, navigate]);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <Outlet />
    </div>
  );
}