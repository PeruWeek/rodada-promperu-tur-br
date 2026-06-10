import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Link as LinkIcon, Plus, UserX } from "lucide-react";

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
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-orphan-exhibitors"],
    queryFn: () => listFn(),
  });

  const [linkTarget, setLinkTarget] = useState<OrphanRow | null>(null);
  const [createTarget, setCreateTarget] = useState<OrphanRow | null>(null);
  const [form, setForm] = useState({ trade_name: "", country_code: "BR", city: "", legal_name: "", state_code: "" });
  const [submitting, setSubmitting] = useState(false);

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
      refetch();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const rows = (data?.rows ?? []) as OrphanRow[];

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (rows.length === 0) return null;

  return (
    <Card className="p-5 border-amber-500/40 bg-amber-500/5">
      <div className="mb-3 flex items-center gap-2">
        <UserX size={18} className="text-amber-600 dark:text-amber-400" />
        <h3 className="font-semibold">{t("admin.orphans.title")}</h3>
        <Badge variant="outline" className="ml-auto">{rows.length}</Badge>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">{t("admin.orphans.help")}</p>
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

      {linkTarget && (
        <LinkOrphanDialog
          open={!!linkTarget}
          profileId={linkTarget.profile_id}
          profileEmail={linkTarget.email}
          onClose={() => setLinkTarget(null)}
          onLinked={() => refetch()}
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