import { createFileRoute, Outlet, redirect, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";
import { useProfile, hasRole } from "@/hooks/use-profile";
import { getMyExhibitorRequest } from "@/lib/exhibitor-requests.functions";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/login" });
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: profile, isLoading: profileLoading } = useProfile();
  const fetchReq = useServerFn(getMyExhibitorRequest);

  const isAdminStaff = hasRole(profile?.roles, "admin", "staff");

  const { data: reqData, isLoading: reqLoading } = useQuery({
    queryKey: ["my-exhibitor-request"],
    queryFn: () => fetchReq(),
    enabled: !!profile && !isAdminStaff,
  });

  useEffect(() => {
    if (profileLoading || reqLoading || !profile) return;
    if (isAdminStaff) return;

    const req = reqData?.request;
    const needsOnboarding = !profile.company_id && !req;
    const onPending = pathname === "/pending-exhibitor";
    const onProfile = pathname === "/profile";

    if (needsOnboarding && pathname !== "/onboarding") {
      navigate({ to: "/onboarding" });
      return;
    }
    if (req && (req.status === "pending" || req.status === "rejected") && !onPending && !onProfile) {
      navigate({ to: "/pending-exhibitor" });
    }
  }, [profile, profileLoading, reqData, reqLoading, isAdminStaff, pathname, navigate]);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <Outlet />
    </div>
  );
}