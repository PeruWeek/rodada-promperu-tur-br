import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  listReviewQueue,
  resolveReviewDiscard,
  resolveReviewKeep,
  resolveReviewLink,
  resolveReviewMerge,
  type ReviewRow,
} from "@/lib/review-queue.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

const REASON_LABEL: Record<string, string> = {
  email_duplicado: "admin.review.reason.emailDuplicate",
  cnpj_duplicado: "admin.review.reason.cnpjDuplicate",
  dados_divergentes: "admin.review.reason.divergent",
  dado_critico_ausente: "admin.review.reason.missingCritical",
};

export function ReviewQueueTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(listReviewQueue);
  const keepFn = useServerFn(resolveReviewKeep);
  const discardFn = useServerFn(resolveReviewDiscard);
  const linkFn = useServerFn(resolveReviewLink);
  const mergeFn = useServerFn(resolveReviewMerge);

  const [selected, setSelected] = useState<ReviewRow | null>(null);
  const [note, setNote] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-review-queue"],
    queryFn: () => listFn({ data: {} }),
  });

  const rows = data?.rows ?? [];

  const close = () => {
    setSelected(null);
    setNote("");
  };

  const refetch = () => {
    qc.invalidateQueries({ queryKey: ["admin-review-queue"] });
    close();
  };

  const keep = useMutation({
    mutationFn: (v: { profileId: string }) => keepFn({ data: { ...v, note } }),
    onSuccess: () => {
      toast.success(t("admin.review.actions.keptSeparate"));
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const discard = useMutation({
    mutationFn: (v: { profileId: string }) => discardFn({ data: { ...v, note } }),
    onSuccess: () => {
      toast.success(t("admin.review.actions.discarded"));
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const link = useMutation({
    mutationFn: (v: { profileId: string; candidateProfileId: string }) =>
      linkFn({ data: { ...v, note } }),
    onSuccess: () => {
      toast.success(t("admin.review.actions.linked"));
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const merge = useMutation({
    mutationFn: (v: { profileId: string; candidateProfileId: string }) =>
      mergeFn({ data: { ...v, note } }),
    onSuccess: () => {
      toast.success(t("admin.review.actions.merged"));
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submitted = useMemo(() => {
    const payload = selected?.review_payload as { submitted?: Record<string, unknown> } | null;
    return payload?.submitted ?? null;
  }, [selected]);

  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("admin.review.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("admin.review.subtitle")}</p>
        </div>
        <Badge variant="secondary">{t("admin.review.count", { count: rows.length })}</Badge>
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">{t("admin.review.empty")}</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <button
              key={r.id}
              onClick={() => {
                setSelected(r);
                setNote("");
              }}
              className="w-full rounded-md border border-border p-3 text-left transition hover:bg-muted/40"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{r.full_name}</p>
                  <p className="text-xs text-muted-foreground">{r.email}</p>
                  {r.company_trade_name && (
                    <p className="text-xs text-muted-foreground">
                      {r.company_trade_name}
                      {r.company_tax_id ? ` · ${r.company_tax_id}` : ""}
                      {r.company_country ? ` · ${r.company_country}` : ""}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-1">
                  {r.review_reasons.map((reason) => (
                    <Badge key={reason} variant="destructive">
                      {t(REASON_LABEL[reason] ?? reason, { defaultValue: reason })}
                    </Badge>
                  ))}
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("admin.review.candidatesCount", { count: r.candidates.length })}
                {r.review_created_at && ` · ${new Date(r.review_created_at).toLocaleString()}`}
              </p>
            </button>
          ))}
        </div>
      )}

      <Sheet open={selected != null} onOpenChange={(v) => !v && close()}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>{t("admin.review.detailTitle")}</SheetTitle>
            <SheetDescription>{t("admin.review.detailSubtitle")}</SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="mt-4 space-y-5">
              <section>
                <h3 className="mb-2 text-sm font-semibold">{t("admin.review.reasons")}</h3>
                <div className="flex flex-wrap gap-1">
                  {selected.review_reasons.map((reason) => (
                    <Badge key={reason} variant="destructive">
                      {t(REASON_LABEL[reason] ?? reason, { defaultValue: reason })}
                    </Badge>
                  ))}
                </div>
              </section>

              <section className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border border-border p-3">
                  <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                    {t("admin.review.submitted")}
                  </p>
                  <p className="text-sm font-medium">{selected.full_name}</p>
                  <p className="text-xs text-muted-foreground">{selected.email}</p>
                  {selected.company_trade_name && (
                    <p className="mt-1 text-xs">
                      {selected.company_trade_name}
                      {selected.company_tax_id ? ` · CNPJ ${selected.company_tax_id}` : ""}
                    </p>
                  )}
                  {submitted && (
                    <pre className="mt-2 max-h-48 overflow-auto rounded bg-muted/40 p-2 text-[10px]">
                      {JSON.stringify(submitted, null, 2)}
                    </pre>
                  )}
                </div>
                <div className="rounded-md border border-border p-3">
                  <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                    {t("admin.review.candidates")}
                  </p>
                  {selected.candidates.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{t("admin.review.noCandidates")}</p>
                  ) : (
                    <ul className="space-y-2">
                      {selected.candidates.map((c) => (
                        <li key={c.id} className="rounded-md border border-border p-2">
                          <p className="text-sm font-medium">{c.full_name}</p>
                          <p className="text-xs text-muted-foreground">{c.email}</p>
                          {c.company_trade_name && (
                            <p className="text-xs">
                              {c.company_trade_name}
                              {c.company_tax_id ? ` · CNPJ ${c.company_tax_id}` : ""}
                              {c.company_country ? ` · ${c.company_country}` : ""}
                            </p>
                          )}
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              onClick={() =>
                                link.mutate({ profileId: selected.id, candidateProfileId: c.id })
                              }
                              disabled={link.isPending}
                            >
                              {t("admin.review.actions.link")}
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() =>
                                merge.mutate({ profileId: selected.id, candidateProfileId: c.id })
                              }
                              disabled={merge.isPending}
                            >
                              {t("admin.review.actions.merge")}
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>

              <section>
                <label className="text-xs font-semibold uppercase text-muted-foreground">
                  {t("admin.review.note")}
                </label>
                <Textarea
                  className="mt-1"
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t("admin.review.notePlaceholder")}
                />
              </section>

              <section className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => keep.mutate({ profileId: selected.id })}
                  disabled={keep.isPending}
                >
                  {t("admin.review.actions.keep")}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => discard.mutate({ profileId: selected.id })}
                  disabled={discard.isPending}
                >
                  {t("admin.review.actions.discard")}
                </Button>
              </section>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </Card>
  );
}