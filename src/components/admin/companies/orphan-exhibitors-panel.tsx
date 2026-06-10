import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Link as LinkIcon, Plus, RefreshCw, UserX } from "lucide-react";

import { createCompanyForOrphan, listOrphanExhibitors } from "@/lib/admin.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

import { LinkOrphanDialog } from "./link-orphan-dialog";

type OrphanRow = {
  profile_id: string;
  email: string;
  full_name: string | null;
  is_active: boolean;
  has_exhibitor_request: boolean;
  request_status: string | null;
  table_number: number | null;
  created_at: string;
};

export function OrphanExhibitorsPanel() {
  const { t } = useTranslation();
  const listFn = useServerFn(listOrphanExhibitors);
  const createFn = useServerFn(createCompanyForOrphan);
  const queryClient = useQueryClient();
  const { data, isLoading, error, isFetching, refetch } = useQuery({
    queryKey: ["admin-orphan-exhibitors"],
    queryFn: () => listFn(),
    retry: 1,
  });

  const [linkTarget, setLinkTarget] = useState<OrphanRow | null>(null);
  const [createTarget, setCreateTarget] = useState<OrphanRow | null>(null);
  const [form, setForm] = useState({ trade_name: "", country_code: "BR", city: "", legal_name: "", state_code: "" });
  const [submitting, setSubmitting] = useState(false);

  const invalidateRelated = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-orphan-exhibitors"] });
    queryClient.invalidateQueries({ queryKey: ["admin-unpublished-exhibitors"] });
    queryClient.invalidateQueries({ queryKey: ["admin-companies"] });
  };

  const submitCreate = async () => {
    if (!createTarget) return;
    setSubmitting(true);
    try {
      await createFn({
        data: {
          profileId: createTarget.profile_id,
          trade_name: form.trade_name.trim(),
          country_code: form.country_code.trim().toUpperCase(),
          city: form.city.trim() || undefined,
          legal_name: form.legal_name.trim() || undefined,
          state_code: form.state_code.trim() || undefined,
        },
      });
      toast.success(t("admin.orphans.created"));
      setCreateTarget(null);
      setForm({ trade_name: "", country_code: "BR", city: "", legal_name: "", state_code: "" });
      invalidateRelated();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const rows = (data?.rows ?? []) as OrphanRow[];

  return (
    <Card className="p-5 border-amber-500/40 bg-amber-500/5">
      <div className="mb-3 flex items-center gap-2">
        <UserX size={18} className="text-amber-600 dark:text-amber-400" />
        <h3 className="font-semibold">{t("admin.orphans.title")}</h3>
        <Badge variant="outline" className="ml-auto">{isLoading ? "…" : rows.length}</Badge>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label="refresh"
        >
          <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
        </Button>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">{t("admin.orphans.help")}</p>

      {isLoading && <Skeleton className="h-24 w-full" />}

      {!isLoading && error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-destructive" />
          <div className="flex-1">
            <div className="font-medium text-destructive">
              {t("admin.orphans.loadError", "Erro ao carregar expositores sem empresa")}
            </div>
            <div className="text-xs text-muted-foreground mt-1 break-all">
              [admin_list_orphan_exhibitors] {(error as Error).message}
            </div>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => refetch()}>
              {t("common.retry", "Tentar novamente")}
            </Button>
          </div>
        </div>
      )}

      {!isLoading && !error && rows.length === 0 && (
        <p className="py-4 text-center text-xs text-muted-foreground">
          {t("admin.orphans.empty", "Nenhum expositor sem empresa no momento.")}
        </p>
      )}

      {!isLoading && !error && rows.length > 0 && (
      <div className="space-y-2">
        {rows.map((r) => (
          <div
            key={r.profile_id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background p-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{r.full_name || r.email}</span>
                {!r.is_active && <Badge variant="outline">{t("admin.orphans.inactive")}</Badge>}
                {r.table_number != null && (
                  <Badge variant="secondary">{t("admin.orphans.tableN", { n: r.table_number })}</Badge>
                )}
                {r.request_status && <Badge variant="outline">{r.request_status}</Badge>}
              </div>
              <p className="truncate text-xs text-muted-foreground">{r.email}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setLinkTarget(r)}>
                <LinkIcon size={14} /> {t("admin.orphans.linkAction")}
              </Button>
              <Button size="sm" onClick={() => setCreateTarget(r)}>
                <Plus size={14} /> {t("admin.orphans.createAction")}
              </Button>
            </div>
          </div>
        ))}
      </div>
      )}

      {linkTarget && (
        <LinkOrphanDialog
          open={!!linkTarget}
          profileId={linkTarget.profile_id}
          profileEmail={linkTarget.email}
          onClose={() => setLinkTarget(null)}
          onLinked={() => invalidateRelated()}
        />
      )}

      <Dialog open={!!createTarget} onOpenChange={(v) => !v && setCreateTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.orphans.createTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("admin.orphans.tradeName")} *</Label>
              <Input value={form.trade_name} onChange={(e) => setForm({ ...form, trade_name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>{t("admin.orphans.country")} *</Label>
                <Input value={form.country_code} onChange={(e) => setForm({ ...form, country_code: e.target.value })} maxLength={3} />
              </div>
              <div>
                <Label>{t("admin.orphans.state")}</Label>
                <Input value={form.state_code} onChange={(e) => setForm({ ...form, state_code: e.target.value })} maxLength={8} />
              </div>
            </div>
            <div>
              <Label>{t("admin.orphans.city")}</Label>
              <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </div>
            <div>
              <Label>{t("admin.orphans.legalName")}</Label>
              <Input value={form.legal_name} onChange={(e) => setForm({ ...form, legal_name: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateTarget(null)}>{t("common.cancel")}</Button>
            <Button onClick={submitCreate} disabled={submitting || form.trade_name.trim().length < 2}>
              {t("admin.orphans.createSubmit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}