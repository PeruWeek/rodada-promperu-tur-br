import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertCircle, Ban, ClipboardCheck, Download, FileArchive, FileSpreadsheet, FileText, Files, Search, UserCog, UserCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getParticipantAgenda,
  listEventRegistrants,
  listBulkAgendas,
  type RegistrantRow,
} from "@/lib/staff-exports.functions";
import {
  adminUpdateUserEmail,
  adminUpdateUserProfile,
} from "@/lib/admin-auth.functions";
import { staffListRegistrationCompletion } from "@/lib/staff-registration.functions";
import { CompleteRegistrationDialog } from "@/components/admin/complete-registration-dialog";
import { hasRole, useProfile } from "@/hooks/use-profile";
import { downloadBlob, toCsv } from "@/lib/exports/csv";
import { downloadXlsx } from "@/lib/exports/xlsx";
import { buildAgendaPdf } from "@/lib/pdf";
import { buildConsolidatedAgendaPdf, downloadAgendaZip } from "@/lib/exports/bulk-agenda";

type RoleFilter = "all" | "exhibitor" | "visitor";

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch {
    return "";
  }
}

function buildExportArrays(rows: RegistrantRow[], t: (k: string) => string) {
  const headers = [
    t("admin.registrants.cols.company"),
    t("admin.registrants.cols.legalName"),
    t("admin.registrants.cols.taxId"),
    t("admin.registrants.cols.role"),
    t("admin.registrants.cols.contact"),
    t("admin.registrants.cols.jobTitle"),
    t("admin.registrants.cols.email"),
    t("admin.registrants.cols.phone"),
    t("admin.registrants.cols.whatsapp"),
    t("admin.registrants.cols.country"),
    t("admin.registrants.cols.state"),
    t("admin.registrants.cols.city"),
    t("admin.registrants.cols.registrationStatus"),
    t("admin.registrants.cols.scheduledMeetings"),
    t("admin.registrants.cols.createdAt"),
  ];
  const data = rows.map((r) => [
    r.company_trade_name,
    r.company_legal_name ?? "",
    r.company_tax_id ?? "",
    r.role === "exhibitor"
      ? t("admin.companies.roleExhibitor")
      : t("admin.companies.roleVisitor"),
    r.full_name,
    r.job_title ?? "",
    r.email ?? "",
    r.phone ?? "",
    r.whatsapp ?? "",
    r.country_code ?? "",
    r.state_code ?? "",
    r.city ?? "",
    r.registration_status ?? "",
    r.scheduled_meetings_count,
    fmtDate(r.created_at),
  ]);
  return { headers, data };
}

export function RegistrantsTab({
  readOnly = false,
  onlyWithMeetings = false,
  defaultRole,
}: { readOnly?: boolean; onlyWithMeetings?: boolean; defaultRole?: RoleFilter } = {}) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { data: me } = useProfile();
  const isAdmin = hasRole(me?.roles, "admin") && !readOnly;
  const isStaffOrAdmin = hasRole(me?.roles, "admin", "staff") && !readOnly;
  const listFn = useServerFn(listEventRegistrants);
  const agendaFn = useServerFn(getParticipantAgenda);
  const bulkFn = useServerFn(listBulkAgendas);
  const updateProfileFn = useServerFn(adminUpdateUserProfile);
  const updateEmailFn = useServerFn(adminUpdateUserEmail);
  const completionFn = useServerFn(staffListRegistrationCompletion);
  const isStaffOnly = hasRole(me?.roles, "staff") && !hasRole(me?.roles, "admin");
  const initialRole: RoleFilter = defaultRole ?? (isStaffOnly ? "visitor" : "all");
  const [role, setRole] = useState<RoleFilter>(initialRole);
  const [search, setSearch] = useState("");
  const [agendaLoadingId, setAgendaLoadingId] = useState<string | null>(null);
  const [bulkLoading, setBulkLoading] = useState<null | "pdf" | "zip">(null);
  const [cancelTarget, setCancelTarget] = useState<RegistrantRow | null>(null);
  const [reactivateTarget, setReactivateTarget] = useState<RegistrantRow | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<RegistrantRow | null>(null);
  const [completeTargetId, setCompleteTargetId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["registrants", role, search],
    queryFn: () => listFn({ data: { role, search } }),
  });

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    let filtered = onlyWithMeetings ? all.filter((r) => r.scheduled_meetings_count > 0) : all;
    if (readOnly) {
      const preStatuses = new Set(["nao_iniciado", "em_preenchimento", "aguardando_aprovacao"]);
      filtered = filtered.filter(
        (r) => !!r.auth_user_id && !preStatuses.has(r.registration_status ?? ""),
      );
    }
    return filtered;
  }, [data, onlyWithMeetings, readOnly]);

  const profileIds = useMemo(() => rows.map((r) => r.profile_id), [rows]);

  const completionQ = useQuery({
    queryKey: ["registrants-completion", profileIds],
    queryFn: () => completionFn({ data: { profileIds } }),
    enabled: isStaffOrAdmin && profileIds.length > 0,
  });
  const completionById = completionQ.data?.byId ?? {};

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["registrants"] });
    qc.invalidateQueries({ queryKey: ["admin-users"] });
  };

  const activeMut = useMutation({
    mutationFn: async (v: { userId: string; is_active: boolean }) =>
      updateProfileFn({ data: v }),
    onSuccess: (_r, v) => {
      toast.success(
        v.is_active
          ? t("admin.registrants.toasts.reactivated")
          : t("admin.registrants.toasts.cancelled"),
      );
      setCancelTarget(null);
      setReactivateTarget(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const replaceMut = useMutation({
    mutationFn: async (v: {
      userId: string;
      currentEmail: string | null;
      full_name: string;
      newEmail: string;
    }) => {
      await updateProfileFn({ data: { userId: v.userId, full_name: v.full_name } });
      if (v.newEmail && v.newEmail.toLowerCase() !== (v.currentEmail ?? "").toLowerCase()) {
        await updateEmailFn({ data: { userId: v.userId, newEmail: v.newEmail } });
      }
      return { ok: true };
    },
    onSuccess: () => {
      toast.success(t("admin.registrants.toasts.replaced"));
      setReplaceTarget(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const exportCsv = () => {
    if (rows.length === 0) return;
    const { headers, data } = buildExportArrays(rows, t);
    const csv = toCsv(headers, data);
    downloadBlob(
      `inscritos-${new Date().toISOString().slice(0, 10)}.csv`,
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
  };

  const exportXlsx = () => {
    if (rows.length === 0) return;
    const { headers, data } = buildExportArrays(rows, t);
    downloadXlsx(
      `inscritos-${new Date().toISOString().slice(0, 10)}.xlsx`,
      t("admin.registrants.sheetName"),
      headers,
      data,
    );
  };

  const downloadAgendaPdf = async (r: RegistrantRow) => {
    setAgendaLoadingId(r.profile_id);
    try {
      const res = await agendaFn({ data: { profileId: r.profile_id } });
      if (!res.rows || res.rows.length === 0) {
        toast.info(t("admin.registrants.noAgenda"));
        return;
      }
      const doc = buildAgendaPdf({
        title: t("agenda.pdfTitle"),
        subtitle: `${t("common.appName")} · ${r.company_trade_name}`,
        ownerName: res.profileName ?? r.full_name,
        rows: res.rows,
        generatedLabel: t("agenda.pdfGenerated", {
          date: new Date().toLocaleString(i18n.language === "es" ? "es" : "pt-BR"),
        }),
      });
      const safe = (s: string) => s.replace(/[^a-z0-9-_]+/gi, "_").slice(0, 80);
      doc.save(`agenda-${safe(r.full_name)}.pdf`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAgendaLoadingId(null);
    }
  };

  const dateLabel = () =>
    t("agenda.pdfGenerated", {
      date: new Date().toLocaleString(i18n.language === "es" ? "es" : "pt-BR"),
    });

  const downloadConsolidatedPdf = async () => {
    if (rows.length === 0) return;
    setBulkLoading("pdf");
    try {
      const res = await bulkFn({ data: { profileIds: rows.map((r) => r.profile_id) } });
      const nonEmpty = res.entries.filter((e) => e.rows.length > 0);
      if (nonEmpty.length === 0) {
        toast.info(t("admin.registrants.bulk.empty"));
        return;
      }
      const doc = buildConsolidatedAgendaPdf({
        title: t("agenda.pdfTitle"),
        subtitle: t("common.appName"),
        generatedLabel: dateLabel(),
        emptyLabel: t("admin.registrants.noAgenda"),
        entries: nonEmpty,
      });
      doc.save(`agendas-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBulkLoading(null);
    }
  };

  const downloadZip = async () => {
    if (rows.length === 0) return;
    setBulkLoading("zip");
    try {
      const res = await bulkFn({ data: { profileIds: rows.map((r) => r.profile_id) } });
      await downloadAgendaZip({
        title: t("agenda.pdfTitle"),
        subtitle: t("common.appName"),
        generatedLabel: dateLabel(),
        entries: res.entries,
        filename: `agendas-${new Date().toISOString().slice(0, 10)}.zip`,
      });
    } catch (e) {
      if ((e as Error).message === "EMPTY") {
        toast.info(t("admin.registrants.bulk.empty"));
      } else {
        toast.error((e as Error).message);
      }
    } finally {
      setBulkLoading(null);
    }
  };

  return (
    <Card className="p-5">
      <p className="mb-4 text-xs text-muted-foreground">{t("admin.registrants.help")}</p>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search
            className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            size={14}
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("admin.registrants.searchPlaceholder")}
            className="pl-8"
          />
        </div>
        <Select value={role} onValueChange={(v) => setRole(v as RoleFilter)}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("admin.companies.roleAll")}</SelectItem>
            <SelectItem value="exhibitor">{t("admin.companies.roleExhibitor")}</SelectItem>
            <SelectItem value="visitor">{t("admin.companies.roleVisitor")}</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={exportXlsx} disabled={rows.length === 0}>
          <FileSpreadsheet size={14} /> XLSX
        </Button>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
          <FileText size={14} /> CSV
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={downloadConsolidatedPdf}
          disabled={rows.length === 0 || bulkLoading !== null}
        >
          <Files size={14} />{" "}
          {bulkLoading === "pdf" ? t("common.loading") : t("admin.registrants.bulk.pdf")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={downloadZip}
          disabled={rows.length === 0 || bulkLoading !== null}
        >
          <FileArchive size={14} />{" "}
          {bulkLoading === "zip" ? t("common.loading") : t("admin.registrants.bulk.zip")}
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {t("admin.registrants.empty")}
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div
              key={r.profile_id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.company_trade_name}</span>
                  <Badge variant={r.role === "exhibitor" ? "default" : "secondary"}>
                    {r.role === "exhibitor"
                      ? t("admin.companies.roleExhibitor")
                      : t("admin.companies.roleVisitor")}
                  </Badge>
                  {!r.is_active && (
                    <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">
                      {t("admin.registrants.inactiveBadge")}
                    </Badge>
                  )}
                  {r.scheduled_meetings_count > 0 && (
                    <Badge variant="outline">
                      {t("admin.registrants.meetingsCount", {
                        count: r.scheduled_meetings_count,
                      })}
                    </Badge>
                  )}
                  {isStaffOrAdmin && completionById[r.profile_id] && (
                    completionById[r.profile_id].status === "incompleto" ? (
                      <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">
                        <AlertCircle size={12} className="mr-1" />
                        Cadastro incompleto · {completionById[r.profile_id].missing} pendente(s)
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-emerald-500 text-emerald-700 dark:text-emerald-400">
                        Cadastro completo
                      </Badge>
                    )
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {r.full_name}
                  {r.email ? ` · ${r.email}` : ""}
                  {[r.city, r.state_code, r.country_code].filter(Boolean).length > 0
                    ? ` · ${[r.city, r.state_code, r.country_code].filter(Boolean).join(" / ")}`
                    : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={agendaLoadingId === r.profile_id}
                  onClick={() => downloadAgendaPdf(r)}
                >
                  <Download size={14} />{" "}
                  {agendaLoadingId === r.profile_id
                    ? t("common.loading")
                    : t("admin.registrants.downloadAgenda")}
                </Button>
                {isStaffOrAdmin && r.auth_user_id && (
                  <Button
                    size="sm"
                    variant={
                      completionById[r.profile_id]?.status === "incompleto" ? "default" : "outline"
                    }
                    onClick={() => setCompleteTargetId(r.profile_id)}
                    title="Completar cadastro"
                  >
                    <ClipboardCheck size={14} /> Completar cadastro
                  </Button>
                )}
                {isAdmin && r.auth_user_id && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setReplaceTarget(r)}
                      title={t("admin.registrants.actions.replace")}
                    >
                      <UserCog size={14} /> {t("admin.registrants.actions.replace")}
                    </Button>
                    {r.is_active ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setCancelTarget(r)}
                        title={t("admin.registrants.actions.cancel")}
                      >
                        <Ban size={14} /> {t("admin.registrants.actions.cancel")}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setReactivateTarget(r)}
                        title={t("admin.registrants.actions.reactivate")}
                      >
                        <UserCheck size={14} /> {t("admin.registrants.actions.reactivate")}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {t("admin.registrants.total", { count: rows.length })}
        </p>
      )}

      <AlertDialog open={!!cancelTarget} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.registrants.cancelDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.registrants.cancelDialog.description", {
                name: cancelTarget?.full_name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {cancelTarget?.role === "exhibitor" && (
            <p className="rounded-md border border-amber-500/40 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              {t("admin.registrants.cancelDialog.exhibitorImpact")}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                cancelTarget &&
                activeMut.mutate({ userId: cancelTarget.auth_user_id, is_active: false })
              }
              disabled={activeMut.isPending}
            >
              {t("admin.registrants.cancelDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!reactivateTarget}
        onOpenChange={(o) => !o && setReactivateTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.registrants.reactivateDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.registrants.reactivateDialog.description", {
                name: reactivateTarget?.full_name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                reactivateTarget &&
                activeMut.mutate({ userId: reactivateTarget.auth_user_id, is_active: true })
              }
              disabled={activeMut.isPending}
            >
              {t("admin.registrants.reactivateDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ReplaceContactDialog
        target={replaceTarget}
        onClose={() => setReplaceTarget(null)}
        submitting={replaceMut.isPending}
        onSubmit={(v) =>
          replaceTarget &&
          replaceMut.mutate({
            userId: replaceTarget.auth_user_id,
            currentEmail: replaceTarget.email,
            full_name: v.full_name,
            newEmail: v.email,
          })
        }
      />

      <CompleteRegistrationDialog
        profileId={completeTargetId}
        open={!!completeTargetId}
        onOpenChange={(o) => {
          if (!o) setCompleteTargetId(null);
          qc.invalidateQueries({ queryKey: ["registrants-completion"] });
        }}
      />
    </Card>
  );
}

function ReplaceContactDialog({
  target,
  onClose,
  onSubmit,
  submitting,
}: {
  target: RegistrantRow | null;
  onClose: () => void;
  onSubmit: (v: { full_name: string; email: string }) => void;
  submitting: boolean;
}) {
  const { t } = useTranslation();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (target) {
      setFullName(target.full_name === "—" ? "" : target.full_name);
      setEmail(target.email ?? "");
    }
  }, [target]);

  const valid =
    fullName.trim().length > 0 && email.trim().length > 3 && email.includes("@");

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("admin.registrants.replaceDialog.title")}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {t("admin.registrants.replaceDialog.description")}
        </p>
        {target?.role === "exhibitor" && (
          <p className="rounded-md border border-amber-500/40 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            {t("admin.registrants.replaceDialog.exhibitorImpact")}
          </p>
        )}
        {target && (
          <div className="rounded-md bg-muted/40 p-2 text-xs">
            <span className="font-medium">{target.company_trade_name}</span>
          </div>
        )}
        <div className="grid gap-3">
          <div>
            <Label className="text-xs">{t("admin.registrants.replaceDialog.name")}</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">{t("admin.registrants.replaceDialog.email")}</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
              {t("admin.registrants.replaceDialog.emailHint")}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!valid || submitting}
            onClick={() =>
              onSubmit({ full_name: fullName.trim(), email: email.trim().toLowerCase() })
            }
          >
            {submitting
              ? t("common.loading")
              : t("admin.registrants.replaceDialog.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}