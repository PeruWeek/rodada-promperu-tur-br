import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Search, ShieldAlert } from "lucide-react";

import { linkOrphanToCompany, searchCompaniesForLink } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type Candidate = {
  id: string;
  trade_name: string;
  country_code: string | null;
  state_code: string | null;
  city: string | null;
  role_hint: "exhibitor" | "visitor" | "mixed" | "empty";
};

export function LinkOrphanDialog({
  open,
  profileId,
  profileEmail,
  onClose,
  onLinked,
}: {
  open: boolean;
  profileId: string;
  profileEmail: string;
  onClose: () => void;
  onLinked: () => void;
}) {
  const { t } = useTranslation();
  const searchFn = useServerFn(searchCompaniesForLink);
  const linkFn = useServerFn(linkOrphanToCompany);

  const [q, setQ] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [forceTarget, setForceTarget] = useState<Candidate | null>(null);
  const [forceReason, setForceReason] = useState("");
  const [forceAck, setForceAck] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const doSearch = async () => {
    if (q.trim().length < 1) return;
    setSearching(true);
    try {
      const r = await searchFn({ data: { query: q.trim(), limit: 10 } });
      setResults(r.rows as Candidate[]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const doLink = async (c: Candidate, force = false) => {
    setSubmitting(true);
    try {
      await linkFn({
        data: {
          profileId,
          companyId: c.id,
          force,
          forceReason: force ? forceReason.trim() : undefined,
        },
      });
      toast.success(t("admin.orphans.linked"));
      onLinked();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const close = () => {
    setQ("");
    setResults([]);
    setForceTarget(null);
    setForceReason("");
    setForceAck(false);
    onClose();
  };

  const roleBadge = (hint: Candidate["role_hint"]) => {
    const map = {
      exhibitor: { label: t("admin.orphans.hintExhibitor"), variant: "default" as const },
      visitor: { label: t("admin.orphans.hintVisitor"), variant: "destructive" as const },
      mixed: { label: t("admin.orphans.hintMixed"), variant: "destructive" as const },
      empty: { label: t("admin.orphans.hintEmpty"), variant: "secondary" as const },
    };
    const v = map[hint];
    return <Badge variant={v.variant}>{v.label}</Badge>;
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("admin.orphans.linkTitle")}</DialogTitle>
          <DialogDescription>{profileEmail}</DialogDescription>
        </DialogHeader>

        {!forceTarget && (
          <>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t("admin.orphans.searchPlaceholder")}
                  className="pl-8"
                  onKeyDown={(e) => e.key === "Enter" && doSearch()}
                />
              </div>
              <Button onClick={doSearch} disabled={searching}>{t("admin.orphans.search")}</Button>
            </div>

            <div className="space-y-2 max-h-80 overflow-y-auto">
              {results.length === 0 && !searching && (
                <p className="text-xs text-muted-foreground py-4 text-center">
                  {t("admin.orphans.noResults")}
                </p>
              )}
              {results.map((c) => {
                const blocked = c.role_hint === "visitor" || c.role_hint === "mixed";
                return (
                  <div
                    key={c.id}
                    className="rounded-md border border-border p-3 space-y-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{c.trade_name}</span>
                      {roleBadge(c.role_hint)}
                    </div>
                    <div className="text-xs text-muted-foreground flex flex-wrap gap-2">
                      <span>{[c.city, c.state_code, c.country_code].filter(Boolean).join(" / ") || "—"}</span>
                      <span className="font-mono">#{c.id.slice(0, 8)}</span>
                    </div>
                    {blocked ? (
                      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive flex items-start gap-2">
                        <ShieldAlert size={14} className="mt-0.5 shrink-0" />
                        <div className="flex-1">
                          <div className="font-medium">{t("admin.orphans.blockedTitle")}</div>
                          <button
                            type="button"
                            className="mt-1 underline"
                            onClick={() => setForceTarget(c)}
                          >
                            {t("admin.orphans.forceLink")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <Button size="sm" onClick={() => doLink(c, false)} disabled={submitting}>
                        {t("admin.orphans.linkBtn")}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {forceTarget && (
          <div className="space-y-3">
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm flex gap-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-destructive" />
              <div>
                <div className="font-medium">{t("admin.orphans.forceWarn")}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {forceTarget.trade_name} · #{forceTarget.id.slice(0, 8)}
                </div>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium">{t("admin.orphans.reasonLabel")}</label>
              <Textarea
                value={forceReason}
                onChange={(e) => setForceReason(e.target.value)}
                placeholder={t("admin.orphans.reasonPlaceholder")}
                rows={3}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {forceReason.trim().length} / 10
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={forceAck} onCheckedChange={(v) => setForceAck(!!v)} />
              {t("admin.orphans.confirm")}
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setForceTarget(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="destructive"
                disabled={!forceAck || forceReason.trim().length < 10 || submitting}
                onClick={() => doLink(forceTarget, true)}
              >
                {t("admin.orphans.forceConfirm")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}