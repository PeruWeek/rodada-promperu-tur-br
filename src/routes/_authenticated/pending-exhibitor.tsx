import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Clock, XCircle, CheckCircle2 } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { getMyExhibitorRequest } from "@/lib/exhibitor-requests.functions";

export const Route = createFileRoute("/_authenticated/pending-exhibitor")({
  component: PendingExhibitorPage,
});

function PendingExhibitorPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fetchFn = useServerFn(getMyExhibitorRequest);

  const { data, isLoading } = useQuery({
    queryKey: ["my-exhibitor-request"],
    queryFn: () => fetchFn(),
    refetchInterval: 15000,
  });

  const req = data?.request;

  useEffect(() => {
    if (req?.status === "approved") navigate({ to: "/dashboard" });
  }, [req?.status, navigate]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-md px-4 py-12">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // No request? Send to onboarding.
  if (!req) {
    return (
      <div className="mx-auto max-w-md px-4 py-12">
        <Card className="p-6 text-center">
          <p className="text-sm text-muted-foreground">{t("pendingExhibitor.noRequest")}</p>
          <Button className="mt-4" onClick={() => navigate({ to: "/onboarding" })}>
            {t("pendingExhibitor.goOnboarding")}
          </Button>
        </Card>
      </div>
    );
  }

  const isPending = req.status === "pending";
  const isRejected = req.status === "rejected";

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <Card className="p-6 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          {isPending && <Clock size={28} />}
          {isRejected && <XCircle size={28} className="text-destructive" />}
          {req.status === "approved" && <CheckCircle2 size={28} className="text-emerald-500" />}
        </div>
        <h1 className="mt-4 text-2xl font-bold">
          {isPending && t("pendingExhibitor.pendingTitle")}
          {isRejected && t("pendingExhibitor.rejectedTitle")}
          {req.status === "approved" && t("pendingExhibitor.approvedTitle")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isPending && t("pendingExhibitor.pendingBody")}
          {isRejected && t("pendingExhibitor.rejectedBody")}
          {req.status === "approved" && t("pendingExhibitor.approvedBody")}
        </p>
        {isRejected && req.review_note && (
          <div className="mt-4 rounded-md border border-border bg-muted/40 p-3 text-left text-sm">
            <p className="text-xs font-semibold uppercase text-muted-foreground">
              {t("pendingExhibitor.reviewNote")}
            </p>
            <p className="mt-1">{req.review_note}</p>
          </div>
        )}
        <Button
          className="mt-6 w-full"
          variant="outline"
          onClick={async () => {
            await supabase.auth.signOut();
            navigate({ to: "/" });
          }}
        >
          {t("common.signOut")}
        </Button>
      </Card>
    </div>
  );
}