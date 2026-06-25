import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, Copy, FileArchive, Files, Mail, Pencil, Plus, Power, RefreshCw, Search, Trash2, UserCheck } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useProfile, hasRole, getPrimaryRole, type AppRole } from "@/hooks/use-profile";
import { assignExhibitorToTable, rebuildSlots } from "@/lib/admin.functions";
import { createEventTable, deleteEventTable, updateEventTable } from "@/lib/admin.functions";
import {
  adminConfirmEmail,
  adminCreateConfirmedUser,
  adminDeleteUser,
  adminListUsers,
  adminSendRecoveryEmail,
  adminSetPassword,
  adminSetPrimaryRole,
  adminUpdateUserProfile,
  adminUpdateUserEmail,
  adminUpsertUserCompany,
  findAuthUserByEmail,
  getAuthDiagnostics,
} from "@/lib/admin-auth.functions";
import {
  getMyStaffAgenda,
  listStaffAssignments,
  setStaffTableAssignment,
} from "@/lib/staff.functions";
import { generalCheckIn, listCheckinEligible } from "@/lib/checkin.functions";
import { listExhibitorRequests, reviewExhibitorRequest } from "@/lib/exhibitor-requests.functions";
import { listBulkAgendas } from "@/lib/staff-exports.functions";
import { buildConsolidatedAgendaPdf, downloadAgendaZip } from "@/lib/exports/bulk-agenda";
import { PipelineDashboard } from "@/components/admin/pipeline/pipeline-tabs";
import { AuditTab } from "@/components/admin/audit-tab";
import { EmailTemplatesTab } from "@/components/admin/email-templates-tab";
import { BookingRemindersTab } from "@/components/admin/booking-reminders-tab";
import { CompaniesTab } from "@/components/admin/companies/companies-tab";
import { RegistrantsTab } from "@/components/admin/registrants-tab";
import { ClienteOverview } from "@/components/admin/cliente/cliente-overview";
import { PreRegistrationsTab } from "@/components/admin/pre-registrations-tab";
import { QaSimulationTab } from "@/components/admin/qa-simulation-tab";
import { ReviewQueueTab } from "@/components/admin/review-queue-tab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminPage,
});

function AdminPage() {
  const { t } = useTranslation();
  const { data: me, isLoading } = useProfile();

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-3 px-4 py-10">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!hasRole(me?.roles, "admin", "staff", "cliente")) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10">
        <Card className="p-6 text-sm text-muted-foreground">{t("admin.forbidden")}</Card>
      </div>
    );
  }

  const primary = getPrimaryRole(me?.roles);
  const isStaffOnly = primary === "staff";
  const isAdmin = hasRole(me?.roles, "admin");
  const isClienteOnly = primary === "cliente";

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <h1 className="text-3xl font-bold">{t("admin.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("admin.subtitle")}</p>

      {isClienteOnly ? (
        <Tabs defaultValue="overview" className="mt-6">
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="overview">{t("cliente.overview.title")}</TabsTrigger>
            <TabsTrigger value="companies">{t("admin.tabs.companies")}</TabsTrigger>
            <TabsTrigger value="meetings">{t("admin.tabs.meetings", { defaultValue: "Agendamentos" })}</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="mt-4"><ClienteOverview /></TabsContent>
          <TabsContent value="companies" className="mt-4"><CompaniesTab readOnly /></TabsContent>
          <TabsContent value="meetings" className="mt-4"><RegistrantsTab readOnly onlyWithMeetings /></TabsContent>
        </Tabs>
      ) : isStaffOnly ? (
        <Tabs defaultValue="dashboard" className="mt-6">
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="tables">{t("admin.tabs.tables")}</TabsTrigger>
            <TabsTrigger value="staffAgenda">{t("admin.tabs.staffAgenda")}</TabsTrigger>
            <TabsTrigger value="checkin">{t("admin.tabs.checkin")}</TabsTrigger>
            <TabsTrigger value="companies">{t("admin.tabs.companies")}</TabsTrigger>
            <TabsTrigger value="registrants">{t("admin.tabs.registrants")}</TabsTrigger>
          </TabsList>
          <TabsContent value="dashboard" className="mt-4"><PipelineDashboard isAdmin={false} /></TabsContent>
          <TabsContent value="tables" className="mt-4"><TablesTab readOnly /></TabsContent>
          <TabsContent value="staffAgenda" className="mt-4"><StaffAgendaTab isAdmin={false} /></TabsContent>
          <TabsContent value="checkin" className="mt-4"><CheckinTab /></TabsContent>
          <TabsContent value="companies" className="mt-4"><CompaniesTab readOnly /></TabsContent>
          <TabsContent value="registrants" className="mt-4"><RegistrantsTab defaultRole="visitor" /></TabsContent>
        </Tabs>
      ) : (
        <Tabs defaultValue="dashboard" className="mt-6">
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="tables">{t("admin.tabs.tables")}</TabsTrigger>
            <TabsTrigger value="staffAgenda">{t("admin.tabs.staffAgenda")}</TabsTrigger>
            <TabsTrigger value="checkin">{t("admin.tabs.checkin")}</TabsTrigger>
            <TabsTrigger value="staff">{t("admin.tabs.staff")}</TabsTrigger>
            <TabsTrigger value="users">{t("admin.tabs.users")}</TabsTrigger>
            <TabsTrigger value="companies">{t("admin.tabs.companies")}</TabsTrigger>
            <TabsTrigger value="registrants">{t("admin.tabs.registrants")}</TabsTrigger>
            <TabsTrigger value="requests">{t("admin.tabs.requests")}</TabsTrigger>
            <TabsTrigger value="review">{t("admin.tabs.review")}</TabsTrigger>
            <TabsTrigger value="preRegistration">{t("admin.tabs.preRegistration")}</TabsTrigger>
            <TabsTrigger value="emails">{t("admin.tabs.emails")}</TabsTrigger>
            <TabsTrigger value="emailTemplates">{t("admin.tabs.emailTemplates")}</TabsTrigger>
            <TabsTrigger value="bookingReminders">Lembretes</TabsTrigger>
            <TabsTrigger value="audit">Auditoria</TabsTrigger>
            <TabsTrigger value="qaSim">QA Sim</TabsTrigger>
          </TabsList>
          <TabsContent value="dashboard" className="mt-4"><PipelineDashboard isAdmin /></TabsContent>
          <TabsContent value="tables" className="mt-4"><TablesTab /></TabsContent>
          <TabsContent value="staffAgenda" className="mt-4"><StaffAgendaTab isAdmin /></TabsContent>
          <TabsContent value="checkin" className="mt-4"><CheckinTab /></TabsContent>
          <TabsContent value="staff" className="mt-4"><StaffAssignmentsTab /></TabsContent>
          <TabsContent value="users" className="mt-4"><UsersTab currentAuthUserId={me?.auth_user_id ?? null} canDelete={isAdmin} /></TabsContent>
          <TabsContent value="companies" className="mt-4"><CompaniesTab /></TabsContent>
          <TabsContent value="registrants" className="mt-4"><RegistrantsTab defaultRole="all" /></TabsContent>
          <TabsContent value="requests" className="mt-4"><RequestsTab /></TabsContent>
          <TabsContent value="review" className="mt-4"><ReviewQueueTab /></TabsContent>
          <TabsContent value="preRegistration" className="mt-4"><PreRegistrationsTab /></TabsContent>
          <TabsContent value="emails" className="mt-4"><EmailsTab /></TabsContent>
          <TabsContent value="emailTemplates" className="mt-4"><EmailTemplatesTab /></TabsContent>
          <TabsContent value="bookingReminders" className="mt-4"><BookingRemindersTab /></TabsContent>
          <TabsContent value="audit" className="mt-4"><AuditTab /></TabsContent>
          <TabsContent value="qaSim" className="mt-4"><QaSimulationTab /></TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function RequestsTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(listExhibitorRequests);
  const reviewFn = useServerFn(reviewExhibitorRequest);
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [noteById, setNoteById] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["admin-exh-requests", filter],
    queryFn: () => listFn({ data: { status: filter } }),
  });

  const mut = useMutation({
    mutationFn: async (v: { id: string; action: "approve" | "reject"; note?: string }) =>
      reviewFn({ data: v }),
    onSuccess: () => {
      toast.success(t("admin.requests.reviewed"));
      qc.invalidateQueries({ queryKey: ["admin-exh-requests"] });
      // Approve changes the user's primary role: refresh any cache that
      // surfaces role-derived data so admin lists and the user's own UI
      // reflect the promotion without a relogin.
      qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["admin-companies"] });
      qc.invalidateQueries({ queryKey: ["pipeline-list"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-5">
      <div className="mb-3">
        <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">{t("admin.requests.filter.pending")}</SelectItem>
            <SelectItem value="approved">{t("admin.requests.filter.approved")}</SelectItem>
            <SelectItem value="rejected">{t("admin.requests.filter.rejected")}</SelectItem>
            <SelectItem value="all">{t("admin.requests.filter.all")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (data?.requests ?? []).length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">{t("admin.requests.empty")}</p>
      ) : (
        <div className="space-y-3">
          {data!.requests.map((r) => (
            <div key={r.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{r.full_name}</p>
                  <p className="text-xs text-muted-foreground">{r.email}</p>
                  {r.company && (
                    <p className="text-xs text-muted-foreground">
                      {r.company.trade_name}
                      {r.company.city ? ` · ${r.company.city}` : ""} · {r.company.country_code}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                  </p>
                </div>
                <Badge
                  variant={r.status === "pending" ? "secondary" : r.status === "approved" ? "default" : "destructive"}
                  className="shrink-0"
                >
                  {t(`admin.requests.status.${r.status}`)}
                </Badge>
              </div>
              {r.status === "pending" && (
                <div className="mt-3 space-y-2">
                  <Textarea
                    placeholder={t("admin.requests.notePlaceholder")}
                    value={noteById[r.id] ?? ""}
                    onChange={(e) => setNoteById((s) => ({ ...s, [r.id]: e.target.value }))}
                    rows={2}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => mut.mutate({ id: r.id, action: "approve", note: noteById[r.id] })}
                      disabled={mut.isPending}
                    >
                      {t("admin.requests.approve")}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => mut.mutate({ id: r.id, action: "reject", note: noteById[r.id] })}
                      disabled={mut.isPending}
                    >
                      {t("admin.requests.reject")}
                    </Button>
                  </div>
                </div>
              )}
              {r.status !== "pending" && r.review_note && (
                <p className="mt-2 rounded-md bg-muted/40 p-2 text-xs">{r.review_note}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function TablesTab({ readOnly = false }: { readOnly?: boolean } = {}) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const assignFn = useServerFn(assignExhibitorToTable);
  const rebuildFn = useServerFn(rebuildSlots);
  const createFn = useServerFn(createEventTable);
  const updateTblFn = useServerFn(updateEventTable);
  const deleteFn = useServerFn(deleteEventTable);
  const bulkFn = useServerFn(listBulkAgendas);
  const [renumberId, setRenumberId] = useState<string | null>(null);
  const [renumberValue, setRenumberValue] = useState<string>("");
  const [deleteId, setDeleteId] = useState<{ id: string; n: number } | null>(null);
  const [bulkLoading, setBulkLoading] = useState<null | "pdf" | "zip">(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-tables"],
    queryFn: async () => {
      const [{ data: event }, { data: tables }, { data: exhProfiles }] = await Promise.all([
        supabase.from("events").select("id, name").order("created_at").limit(1).maybeSingle(),
        supabase.from("event_tables").select("id, table_number, exhibitor_profile_id, event_id").order("table_number"),
        supabase
          .from("exhibitor_profiles")
          .select("profile_id"),
      ]);
      const profIds = (exhProfiles ?? []).map((e) => e.profile_id);
      const { data: profs } = profIds.length
        ? await supabase.from("profiles").select("id, full_name, company_id").in("id", profIds)
        : { data: [] as Array<{ id: string; full_name: string; company_id: string | null }> };
      const compIds = (profs ?? []).map((p) => p.company_id).filter(Boolean) as string[];
      const { data: comps } = compIds.length
        ? await supabase.from("companies").select("id, trade_name").in("id", compIds)
        : { data: [] as Array<{ id: string; trade_name: string }> };
      const options = (profs ?? []).map((p) => ({
        id: p.id,
        label: comps?.find((c) => c.id === p.company_id)?.trade_name ?? p.full_name,
      }));
      return { event, tables: tables ?? [], options };
    },
  });

  const assignMut = useMutation({
    mutationFn: async ({ tableId, exhibitorProfileId }: { tableId: string; exhibitorProfileId: string | null }) =>
      assignFn({ data: { tableId, exhibitorProfileId } }),
    onSuccess: () => {
      toast.success(t("admin.tables.saved"));
      qc.invalidateQueries({ queryKey: ["admin-tables"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rebuildMut = useMutation({
    mutationFn: async (eventId: string) => rebuildFn({ data: { eventId } }),
    onSuccess: () => toast.success(t("admin.tables.slotsRebuilt")),
    onError: (e: Error) => toast.error(e.message),
  });

  const createMut = useMutation({
    mutationFn: async (eventId: string) => createFn({ data: { eventId } }),
    onSuccess: () => {
      toast.success(t("admin.tables.created"));
      qc.invalidateQueries({ queryKey: ["admin-tables"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const renumberMut = useMutation({
    mutationFn: async (vars: { tableId: string; tableNumber: number }) =>
      updateTblFn({ data: vars }),
    onSuccess: () => {
      toast.success(t("admin.tables.renumbered"));
      setRenumberId(null);
      qc.invalidateQueries({ queryKey: ["admin-tables"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: async (tableId: string) => deleteFn({ data: { tableId } }),
    onSuccess: () => {
      toast.success(t("admin.tables.deleted"));
      setDeleteId(null);
      qc.invalidateQueries({ queryKey: ["admin-tables"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const exhibitorProfileIds = (data?.tables ?? [])
    .map((t) => t.exhibitor_profile_id)
    .filter(Boolean) as string[];

  const dateLabel = () =>
    t("agenda.pdfGenerated", {
      date: new Date().toLocaleString(i18n.language === "es" ? "es" : "pt-BR"),
    });

  const exportTablesPdf = async () => {
    if (exhibitorProfileIds.length === 0) return;
    setBulkLoading("pdf");
    try {
      const res = await bulkFn({ data: { profileIds: exhibitorProfileIds } });
      const nonEmpty = res.entries.filter((e) => e.rows.length > 0);
      if (nonEmpty.length === 0) {
        toast.info(t("admin.tables.bulkEmpty"));
        return;
      }
      const doc = buildConsolidatedAgendaPdf({
        title: t("tableAgenda.pdfTitle", { number: "" }).trim(),
        subtitle: t("common.appName"),
        generatedLabel: dateLabel(),
        emptyLabel: t("admin.registrants.noAgenda"),
        entries: nonEmpty,
      });
      doc.save(`agendas-mesas-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBulkLoading(null);
    }
  };

  const exportTablesZip = async () => {
    if (exhibitorProfileIds.length === 0) return;
    setBulkLoading("zip");
    try {
      const res = await bulkFn({ data: { profileIds: exhibitorProfileIds } });
      await downloadAgendaZip({
        title: t("tableAgenda.pdfTitle", { number: "" }).trim(),
        subtitle: t("common.appName"),
        generatedLabel: dateLabel(),
        entries: res.entries,
        filename: `agendas-mesas-${new Date().toISOString().slice(0, 10)}.zip`,
      });
    } catch (e) {
      if ((e as Error).message === "EMPTY") {
        toast.info(t("admin.tables.bulkEmpty"));
      } else {
        toast.error((e as Error).message);
      }
    } finally {
      setBulkLoading(null);
    }
  };

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{data?.event?.name ?? "—"}</p>
          <p className="text-xs text-muted-foreground">{t("admin.tables.help")}</p>
          <p className="text-xs text-muted-foreground">{t("admin.tables.rebuildAfterCreate")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={exportTablesPdf}
            disabled={exhibitorProfileIds.length === 0 || bulkLoading !== null}
          >
            <Files size={14} />{" "}
            {bulkLoading === "pdf" ? t("common.loading") : t("admin.tables.bulkPdf")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={exportTablesZip}
            disabled={exhibitorProfileIds.length === 0 || bulkLoading !== null}
          >
            <FileArchive size={14} />{" "}
            {bulkLoading === "zip" ? t("common.loading") : t("admin.tables.bulkZip")}
          </Button>
          {data?.event && !readOnly && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => createMut.mutate(data.event!.id)}
                disabled={createMut.isPending}
              >
                <Plus size={14} /> {t("admin.tables.create")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => rebuildMut.mutate(data.event!.id)}
                disabled={rebuildMut.isPending}
              >
                <RefreshCw size={14} /> {t("admin.tables.rebuildSlots")}
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="space-y-2">
        {(data?.tables ?? []).map((tbl) => (
          <div key={tbl.id} className="flex items-center gap-3 rounded-md border border-border p-3">
            <Badge variant="outline" className="shrink-0">#{tbl.table_number}</Badge>
            <Select
              value={tbl.exhibitor_profile_id ?? "__none"}
              onValueChange={(v) =>
                assignMut.mutate({ tableId: tbl.id, exhibitorProfileId: v === "__none" ? null : v })
              }
              disabled={readOnly}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("admin.tables.unassigned")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">{t("admin.tables.unassigned")}</SelectItem>
                {(data?.options ?? []).map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!readOnly && <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                setRenumberId(tbl.id);
                setRenumberValue(String(tbl.table_number));
              }}
              title={t("admin.tables.renumber")}
            >
              <Pencil size={14} />
            </Button>}
            {!readOnly && <Button
              size="icon"
              variant="ghost"
              onClick={() => setDeleteId({ id: tbl.id, n: tbl.table_number })}
              title={t("admin.tables.delete")}
            >
              <Trash2 size={14} />
            </Button>}
          </div>
        ))}
      </div>

      <Dialog open={renumberId !== null} onOpenChange={(o) => !o && setRenumberId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.tables.renumber")}</DialogTitle>
          </DialogHeader>
          <div>
            <Label>{t("admin.tables.numberLabel")}</Label>
            <Input
              type="number"
              min={1}
              value={renumberValue}
              onChange={(e) => setRenumberValue(e.target.value)}
              className="mt-1.5"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenumberId(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                const n = parseInt(renumberValue, 10);
                if (!Number.isFinite(n) || n < 1) return;
                renumberMut.mutate({ tableId: renumberId!, tableNumber: n });
              }}
              disabled={renumberMut.isPending}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.tables.delete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.tables.deleteConfirm", { n: deleteId?.n ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (deleteId) deleteMut.mutate(deleteId.id);
              }}
            >
              {t("admin.tables.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function CheckinTab() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const checkInFn = useServerFn(generalCheckIn);
  const listEligibleFn = useServerFn(listCheckinEligible);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-checkin", q],
    queryFn: async () => {
      const { data: event } = await supabase
        .from("events").select("id, name").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!event) return { event: null, profiles: [], checks: new Map<string, { at: string; byName: string | null }>() };
      const [{ profiles: profs }, { data: checks }] = await Promise.all([
        listEligibleFn({ data: { eventId: event.id, q } }),
        supabase
          .from("general_checkins")
          .select("profile_id, checkin_at, checked_in_by_profile_id")
          .eq("event_id", event.id),
      ]);
      const byIds = Array.from(
        new Set((checks ?? []).map((c) => c.checked_in_by_profile_id).filter(Boolean) as string[]),
      );
      const { data: byProfs } = byIds.length
        ? await supabase.from("profiles").select("id, full_name").in("id", byIds)
        : { data: [] as Array<{ id: string; full_name: string }> };
      const checkMap = new Map<string, { at: string; byName: string | null }>();
      for (const c of checks ?? []) {
        checkMap.set(c.profile_id, {
          at: c.checkin_at,
          byName:
            (byProfs ?? []).find((p) => p.id === c.checked_in_by_profile_id)?.full_name ?? null,
        });
      }
      return {
        event,
        profiles: profs ?? [],
        checks: checkMap,
      };
    },
  });

  const mut = useMutation({
    mutationFn: async ({ eventId, profileId }: { eventId: string; profileId: string }) =>
      checkInFn({ data: { eventId, profileId, method: "manual" } }),
    onSuccess: (r) => {
      toast.success(r.alreadyCheckedIn ? t("admin.checkin.already") : t("admin.checkin.done"));
      qc.invalidateQueries({ queryKey: ["admin-checkin"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const fmtDateTime = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language === "es" ? "es" : "pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <Card className="p-5">
      <div className="mb-4 space-y-1">
        <p className="text-sm font-medium">{t("admin.checkin.help")}</p>
        <p className="text-xs text-muted-foreground">{t("admin.checkin.helpSecondary")}</p>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("admin.checkin.searchPlaceholder")}
          className="pl-9"
        />
      </div>
      <div className="mt-3 space-y-1.5">
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (data?.profiles ?? []).length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">{t("admin.checkin.noResults")}</p>
        ) : (
          data!.profiles.map((p) => {
            const info = data!.checks.get(p.id);
            return (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.full_name}</p>
                  <p className="truncate text-xs text-muted-foreground">{[p.company, p.email].filter(Boolean).join(" · ")}</p>
                  {info && (
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {t("admin.checkin.checkedAt", { date: fmtDateTime(info.at) })}
                      {info.byName ? ` · ${t("admin.checkin.checkedBy", { name: info.byName })}` : ""}
                    </p>
                  )}
                </div>
                {info ? (
                  <Badge className="shrink-0 bg-emerald-600 text-white hover:bg-emerald-600">
                    <Check size={12} className="mr-1" />{t("admin.checkin.checked")}
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => data?.event && mut.mutate({ eventId: data.event.id, profileId: p.id })}
                    disabled={mut.isPending}
                  >
                    <UserCheck size={14} /> {t("admin.checkin.check")}
                  </Button>
                )}
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

const ROLE_OPTIONS: AppRole[] = ["admin", "staff", "cliente", "exhibitor", "visitor"];
// Categorias editáveis pelo fluxo administrativo (admin é gerenciado fora deste fluxo).
const EDITABLE_ROLE_OPTIONS: AppRole[] = ["staff", "cliente", "exhibitor", "visitor"];

type AdminUser = {
  id: string;
  auth_user_id: string | null;
  full_name: string;
  email: string | null;
  is_active: boolean;
  preferred_language: "pt-BR" | "es";
  company_id: string | null;
  company: { id: string; trade_name: string; country_code: string; city: string | null } | null;
  roles: AppRole[];
};

function UsersTab({ currentAuthUserId, canDelete }: { currentAuthUserId: string | null; canDelete: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | AppRole>("all");
  const listFn = useServerFn(adminListUsers);
  const createFn = useServerFn(adminCreateConfirmedUser);
  const updateFn = useServerFn(adminUpdateUserProfile);
  const deleteFn = useServerFn(adminDeleteUser);
  const setRoleFn = useServerFn(adminSetPrimaryRole);
  const upsertCompanyFn = useServerFn(adminUpsertUserCompany);

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-users", q],
    queryFn: () => listFn({ data: { q } }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-users"] });
    qc.invalidateQueries({ queryKey: ["registrants"] });
    qc.invalidateQueries({ queryKey: ["admin-companies"] });
    qc.invalidateQueries({ queryKey: ["companies"] });
    qc.invalidateQueries({ queryKey: ["pipeline"] });
    qc.invalidateQueries({ queryKey: ["profile"] });
  };

  const createMut = useMutation({
    mutationFn: async (v: {
      email: string;
      password: string;
      full_name: string;
      preferred_language: "pt-BR" | "es";
      role: AppRole;
    }) => createFn({ data: v }),
    onSuccess: () => {
      toast.success(t("admin.users.created"));
      setCreateOpen(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: async (v: {
      userId: string;
      full_name?: string;
      preferred_language?: "pt-BR" | "es";
      is_active?: boolean;
      company?: { trade_name: string; country_code: string; city?: string } | null;
    }) => {
      const { company, ...profilePatch } = v;
      await updateFn({ data: profilePatch });
      if (company && company.trade_name.trim().length > 0) {
        await upsertCompanyFn({
          data: {
            userId: v.userId,
            trade_name: company.trade_name,
            country_code: company.country_code || "BR",
            city: company.city,
          },
        });
      }
      return { ok: true };
    },
    onSuccess: () => {
      toast.success(t("admin.users.saved"));
      invalidate();
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const roleMut = useMutation({
    mutationFn: async (v: { userId: string; role: AppRole }) => setRoleFn({ data: v }),
    onSuccess: () => {
      toast.success(t("admin.users.saved"));
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (userId: string) => deleteFn({ data: { userId } }),
    onSuccess: () => {
      toast.success(t("admin.users.deleted"));
      setDeleting(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const list = useMemo(() => (data?.users ?? []) as AdminUser[], [data]);
  const filteredList = useMemo(
    () =>
      roleFilter === "all"
        ? list
        : list.filter((u) => getPrimaryRole(u.roles) === roleFilter),
    [list, roleFilter],
  );

  return (
    <Card className="p-5">
      <p className="mb-3 text-xs text-muted-foreground">{t("admin.users.help")}</p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("admin.users.searchPlaceholder")}
            className="pl-9"
          />
        </div>
        <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as "all" | AppRole)}>
          <SelectTrigger className="w-full sm:w-44" aria-label={t("admin.users.filterRole")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("admin.users.roleAll")}</SelectItem>
            {ROLE_OPTIONS.map((r) => (
              <SelectItem key={r} value={r}>{t(`roles.${r}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={14} /> {t("admin.users.create.button")}
        </Button>
      </div>

      <div className="mt-3 space-y-2">
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : filteredList.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">{t("admin.users.empty")}</p>
        ) : (
          filteredList.map((u) => {
            const primary = getPrimaryRole(u.roles);
            const isSelf = !!currentAuthUserId && u.auth_user_id === currentAuthUserId;
            const isAdminUser = u.roles.includes("admin");
            return (
              <div key={u.id} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {u.full_name}
                      {!u.is_active && (
                        <Badge variant="secondary" className="ml-2">{t("admin.users.inactive")}</Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={isAdminUser ? "admin" : (primary ?? "visitor")}
                      onValueChange={(v) =>
                        u.auth_user_id &&
                        roleMut.mutate({ userId: u.auth_user_id, role: v as AppRole })
                      }
                      disabled={roleMut.isPending || !u.auth_user_id || isAdminUser}
                    >
                      <SelectTrigger className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {isAdminUser && (
                          <SelectItem value="admin" disabled>{t("roles.admin")}</SelectItem>
                        )}
                        {EDITABLE_ROLE_OPTIONS.map((r) => (
                          <SelectItem key={r} value={r}>{t(`roles.${r}`)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing(u)}
                      title={t("common.save")}
                      aria-label={t("admin.users.edit.title")}
                    >
                      <Pencil size={14} />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        u.auth_user_id &&
                        updateMut.mutate({ userId: u.auth_user_id, is_active: !u.is_active })
                      }
                      disabled={updateMut.isPending || isSelf || !u.auth_user_id}
                      title={u.is_active ? t("admin.users.deactivate") : t("admin.users.activate")}
                      aria-label={u.is_active ? t("admin.users.deactivate") : t("admin.users.activate")}
                    >
                      <Power size={14} className={u.is_active ? "text-emerald-600" : "text-muted-foreground"} />
                    </Button>
                    {canDelete && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setDeleting(u)}
                        disabled={isSelf}
                        title={isSelf ? t("admin.users.cannotDeleteSelf") : t("admin.users.delete.action")}
                        aria-label={t("admin.users.delete.action")}
                      >
                        <Trash2 size={14} />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={(v) => createMut.mutate(v)}
        submitting={createMut.isPending}
      />

      <EditUserDialog
        user={editing}
        currentAuthUserId={currentAuthUserId}
        onClose={() => setEditing(null)}
        onSubmit={(patch) => {
          if (!editing?.auth_user_id) return;
          updateMut.mutate({ userId: editing.auth_user_id, ...patch });
        }}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.users.delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.users.delete.confirm", { name: deleting?.full_name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting?.auth_user_id && deleteMut.mutate(deleting.auth_user_id)}
            >
              {t("admin.users.delete.action")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function CreateUserDialog({
  open,
  onOpenChange,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (v: {
    email: string;
    password: string;
    full_name: string;
    preferred_language: "pt-BR" | "es";
    role: AppRole;
  }) => void;
  submitting: boolean;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [lang, setLang] = useState<"pt-BR" | "es">("pt-BR");
  const [role, setRole] = useState<AppRole>("visitor");

  useEffect(() => {
    if (!open) {
      setEmail(""); setPassword(""); setFullName(""); setLang("pt-BR"); setRole("visitor");
    }
  }, [open]);

  const valid = email.trim().length > 3 && password.length >= 8 && fullName.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("admin.users.create.title")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label className="text-xs">{t("admin.users.create.email")}</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">{t("admin.users.create.password")}</Label>
            <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("admin.users.create.passwordHint")} />
          </div>
          <div>
            <Label className="text-xs">{t("admin.users.create.fullName")}</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t("admin.users.create.language")}</Label>
              <Select value={lang} onValueChange={(v) => setLang(v as "pt-BR" | "es")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pt-BR">Português (BR)</SelectItem>
                  <SelectItem value="es">Español</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t("admin.users.primaryRole")}</Label>
              <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r} value={r}>{t(`roles.${r}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                {t("admin.users.create.roleHint")}
              </p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button
            disabled={!valid || submitting}
            onClick={() => onSubmit({ email: email.trim().toLowerCase(), password, full_name: fullName.trim(), preferred_language: lang, role })}
          >
            {t("admin.users.create.button")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({
  user,
  currentAuthUserId,
  onClose,
  onSubmit,
}: {
  user: AdminUser | null;
  currentAuthUserId: string | null;
  onClose: () => void;
  onSubmit: (patch: {
    full_name?: string;
    preferred_language?: "pt-BR" | "es";
    is_active?: boolean;
    company?: { trade_name: string; country_code: string; city?: string } | null;
  }) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const updateEmailFn = useServerFn(adminUpdateUserEmail);
  const [fullName, setFullName] = useState("");
  const [lang, setLang] = useState<"pt-BR" | "es">("pt-BR");
  const [isActive, setIsActive] = useState(true);
  const [companyName, setCompanyName] = useState("");
  const [country, setCountry] = useState("BR");
  const [city, setCity] = useState("");
  const [emailEditOpen, setEmailEditOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");

  useEffect(() => {
    if (user) {
      setFullName(user.full_name);
      setLang(user.preferred_language);
      setIsActive(user.is_active);
      setCompanyName(user.company?.trade_name ?? "");
      setCountry(user.company?.country_code ?? "BR");
      setCity(user.company?.city ?? "");
      setEmailEditOpen(false);
      setNewEmail("");
    }
  }, [user]);

  const isSelf = !!user?.auth_user_id && user.auth_user_id === currentAuthUserId;
  const emailMut = useMutation({
    mutationFn: async (v: { userId: string; newEmail: string }) =>
      updateEmailFn({ data: v }),
    onSuccess: (res) => {
      toast.success(t("admin.users.email.success", { email: res.email }));
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      setEmailEditOpen(false);
      setNewEmail("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("admin.users.edit.title")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label className="text-xs">{t("admin.users.email.label")}</Label>
            <div className="flex items-center gap-2">
              <Input value={user?.email ?? ""} readOnly className="flex-1" />
              {!isSelf && user?.auth_user_id && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEmailEditOpen((v) => !v);
                    setNewEmail("");
                  }}
                >
                  {emailEditOpen ? t("common.cancel") : t("admin.users.email.change")}
                </Button>
              )}
            </div>
            {emailEditOpen && user?.auth_user_id && (
              <div className="mt-2 rounded-md border border-border p-3">
                <p className="mb-2 text-xs text-muted-foreground">
                  {t("admin.users.email.warning")}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder={t("admin.users.email.newPlaceholder")}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={
                      emailMut.isPending ||
                      newEmail.trim().length < 3 ||
                      !newEmail.includes("@")
                    }
                    onClick={() =>
                      user.auth_user_id &&
                      emailMut.mutate({
                        userId: user.auth_user_id,
                        newEmail: newEmail.trim().toLowerCase(),
                      })
                    }
                  >
                    {emailMut.isPending ? t("common.loading") : t("admin.users.email.confirm")}
                  </Button>
                </div>
              </div>
            )}
          </div>
          <div>
            <Label className="text-xs">{t("admin.users.create.fullName")}</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">{t("admin.users.create.language")}</Label>
            <Select value={lang} onValueChange={(v) => setLang(v as "pt-BR" | "es")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pt-BR">Português (BR)</SelectItem>
                <SelectItem value="es">Español</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Empresa</Label>
            <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Nome da empresa" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">País</Label>
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="BR">Brasil</SelectItem>
                  <SelectItem value="PE">Perú</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Cidade</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <Label htmlFor="user-active">{t("admin.users.active")}</Label>
            <Switch id="user-active" checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            onClick={() =>
              onSubmit({
                full_name: fullName.trim(),
                preferred_language: lang,
                is_active: isActive,
                company: companyName.trim()
                  ? { trade_name: companyName.trim(), country_code: country || "BR", city: city.trim() || undefined }
                  : null,
              })
            }
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StaffAssignmentsTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(listStaffAssignments);
  const saveFn = useServerFn(setStaffTableAssignment);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-staff-assignments"],
    queryFn: () => listFn({ data: {} }),
  });

  const mut = useMutation({
    mutationFn: async (v: {
      eventId: string;
      tableId: string;
      staffProfileId: string;
      assigned: boolean;
    }) => saveFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-staff-assignments"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!data?.eventId) {
    return <Card className="p-5 text-sm text-muted-foreground">{t("admin.staff.noEvent")}</Card>;
  }
  if (data.staffOptions.length === 0) {
    return <Card className="p-5 text-sm text-muted-foreground">{t("admin.staff.noStaff")}</Card>;
  }

  return (
    <Card className="p-5">
      <p className="mb-3 text-sm text-muted-foreground">{t("admin.staff.help")}</p>
      <div className="space-y-3">
        {data.tables.map((tbl) => (
          <div key={tbl.id} className="rounded-md border border-border p-3">
            <p className="mb-2 text-sm font-semibold">
              {t("admin.staff.tableLabel", { n: tbl.table_number })}
            </p>
            <div className="flex flex-wrap gap-2">
              {data.staffOptions.map((s) => {
                const assigned = data.assignments.some(
                  (a) => a.table_id === tbl.id && a.staff_profile_id === s.id,
                );
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={mut.isPending}
                    onClick={() =>
                      mut.mutate({
                        eventId: data.eventId!,
                        tableId: tbl.id,
                        staffProfileId: s.id,
                        assigned: !assigned,
                      })
                    }
                    className={`rounded-full border px-3 py-1 text-xs transition ${
                      assigned
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:border-primary"
                    }`}
                  >
                    {s.full_name}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function StaffAgendaTab({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useTranslation();
  const agendaFn = useServerFn(getMyStaffAgenda);
  const listAssignFn = useServerFn(listStaffAssignments);
  const [staffFilter, setStaffFilter] = useState<string>("__me");

  const { data: assignData } = useQuery({
    queryKey: ["admin-staff-assignments"],
    queryFn: () => listAssignFn({ data: {} }),
    enabled: isAdmin,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["staff-agenda", isAdmin ? staffFilter : "self"],
    queryFn: () =>
      agendaFn({
        data: isAdmin && staffFilter !== "__me" ? { staffProfileId: staffFilter } : {},
      }),
  });

  return (
    <Card className="p-5">
      {isAdmin && (
        <div className="mb-4 max-w-sm">
          <Label className="text-xs">{t("admin.staffAgenda.filterStaff")}</Label>
          <Select value={staffFilter} onValueChange={setStaffFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__me">{t("admin.staffAgenda.allForMe")}</SelectItem>
              {(assignData?.staffOptions ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (data?.meetings ?? []).length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">{t("admin.staffAgenda.empty")}</p>
      ) : (
        <div className="space-y-2">
          {data!.meetings.map((m) => (
            <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {m.start_at ? new Date(m.start_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : "—"}
                  {" · "}
                  {t("admin.staff.tableLabel", { n: m.table_number ?? "?" })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {m.visitor_name ?? "—"}
                  {m.visitor_company ? ` · ${m.visitor_company}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("admin.staffAgenda.exhibitor")}: {m.exhibitor_company ?? m.exhibitor_name ?? "—"}
                </p>
              </div>
              <Badge variant={m.checkin_status ? "default" : "secondary"} className="shrink-0">
                {m.checkin_status ? t("admin.staffAgenda.checked") : t("admin.staffAgenda.notChecked")}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function EmailsTab() {
  const { t } = useTranslation();
  const findFn = useServerFn(findAuthUserByEmail);
  const confirmFn = useServerFn(adminConfirmEmail);
  const createFn = useServerFn(adminCreateConfirmedUser);
  const setPwdFn = useServerFn(adminSetPassword);
  const diagnosticsFn = useServerFn(getAuthDiagnostics);
  const sendRecoveryFn = useServerFn(adminSendRecoveryEmail);

  const [email, setEmail] = useState("");
  const [result, setResult] = useState<
    | { user: { id: string; email: string; email_confirmed_at: string | null; created_at: string }; hasProfile: boolean }
    | { user: null; hasProfile: false }
    | null
  >(null);

  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [lang, setLang] = useState<"pt-BR" | "es">("pt-BR");
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);
  const [resetPwd, setResetPwd] = useState("");

  const normalizedEmail = email.trim().toLowerCase();

  const searchMut = useMutation({
    mutationFn: async () => findFn({ data: { email: normalizedEmail } }),
    onSuccess: (r) => {
      setResult(r);
      setCreatedPassword(null);
      if (r?.user) diagnosticsMut.mutate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const diagnosticsMut = useMutation({
    mutationFn: async () => diagnosticsFn({ data: { email: normalizedEmail } }),
    onError: (e: Error) => toast.error(e.message),
  });

  const recoveryMut = useMutation({
    mutationFn: async () =>
      sendRecoveryFn({
        data: {
          email: normalizedEmail,
          redirectTo: `${window.location.origin}/reset-password`,
        },
      }),
    onSuccess: () => {
      toast.success(t("admin.emails.recoverySent", "Link de recuperação enviado."));
      diagnosticsMut.mutate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const confirmMut = useMutation({
    mutationFn: async (userId: string) => confirmFn({ data: { userId } }),
    onSuccess: () => {
      toast.success(t("admin.emails.confirmed"));
      searchMut.mutate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createMut = useMutation({
    mutationFn: async () =>
      createFn({
        data: {
          email: normalizedEmail,
          full_name: fullName,
          password,
          preferred_language: lang,
        },
      }),
    onSuccess: () => {
      toast.success(t("admin.emails.created"));
      setCreatedPassword(password);
      setPassword("");
      setFullName("");
      searchMut.mutate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetMut = useMutation({
    mutationFn: async (userId: string) => setPwdFn({ data: { userId, password: resetPwd } }),
    onSuccess: () => {
      toast.success(t("admin.emails.passwordSet"));
      setResetPwd("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("admin.emails.copied"));
    } catch {
      toast.error(t("admin.emails.copyFailed"));
    }
  };

  const notFound = result !== null && result.user === null;

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <p className="mb-3 text-sm text-muted-foreground">{t("admin.emails.searchHelp")}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Mail
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              size={16}
            />
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("admin.emails.emailPlaceholder")}
              className="pl-9"
              onKeyDown={(e) => {
                if (e.key === "Enter" && normalizedEmail) searchMut.mutate();
              }}
            />
          </div>
          <Button
            onClick={() => searchMut.mutate()}
            disabled={!normalizedEmail || searchMut.isPending}
          >
            <Search size={14} /> {t("admin.emails.search")}
          </Button>
        </div>

        {result?.user && (
          <div className="mt-4 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{result.user.email}</p>
                <p className="text-xs text-muted-foreground">
                  {t("admin.emails.createdAt")}: {new Date(result.user.created_at).toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("admin.emails.profile")}: {result.hasProfile ? t("admin.emails.yes") : t("admin.emails.no")}
                </p>
              </div>
              {result.user.email_confirmed_at ? (
                <Badge className="shrink-0" variant="default">
                  <Check size={12} className="mr-1" />
                  {t("admin.emails.confirmedBadge")}
                </Badge>
              ) : (
                <Badge className="shrink-0" variant="secondary">
                  {t("admin.emails.pendingBadge")}
                </Badge>
              )}
            </div>

            {!result.user.email_confirmed_at && (
              <Button
                size="sm"
                className="mt-3"
                onClick={() => confirmMut.mutate(result.user!.id)}
                disabled={confirmMut.isPending}
              >
                {t("admin.emails.confirmNow")}
              </Button>
            )}

            <div className="mt-4 border-t border-border pt-3">
              <p className="mb-2 text-xs font-medium">{t("admin.emails.resetPasswordTitle")}</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  type="text"
                  value={resetPwd}
                  onChange={(e) => setResetPwd(e.target.value)}
                  placeholder={t("admin.emails.newPasswordPlaceholder")}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => resetMut.mutate(result.user!.id)}
                  disabled={resetPwd.length < 8 || resetMut.isPending}
                >
                  {t("admin.emails.setPassword")}
                </Button>
              </div>
            </div>

            <div className="mt-4 border-t border-border pt-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-medium">{t("admin.emails.diagnosticsTitle", "Diagnóstico de envio")}</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => diagnosticsMut.mutate()}
                    disabled={diagnosticsMut.isPending}
                  >
                    <RefreshCw size={12} /> {t("admin.emails.refresh", "Atualizar")}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => recoveryMut.mutate()}
                    disabled={recoveryMut.isPending}
                  >
                    {t("admin.emails.sendRecovery", "Enviar link de recuperação")}
                  </Button>
                </div>
              </div>
              {diagnosticsMut.data?.suppression && diagnosticsMut.data.suppression.length > 0 && (
                <div className="mb-2 rounded border border-destructive/40 bg-destructive/5 p-2 text-xs">
                  <p className="font-medium text-destructive">
                    {t("admin.emails.suppressed", "E-mail suprimido")}
                  </p>
                  {diagnosticsMut.data.suppression.map((s) => (
                    <p key={s.id} className="text-muted-foreground">
                      {s.reason} — {new Date(s.created_at).toLocaleString()}
                    </p>
                  ))}
                </div>
              )}
              {diagnosticsMut.data?.sendLog && diagnosticsMut.data.sendLog.length > 0 ? (
                <div className="space-y-1 text-xs">
                  {diagnosticsMut.data.sendLog.slice(0, 10).map((log) => (
                    <div key={log.id} className="flex items-start justify-between gap-2 border-b border-border/40 pb-1">
                      <div className="min-w-0">
                        <p className="truncate font-mono">{log.template_name}</p>
                        {log.error_message && (
                          <p className="truncate text-destructive">{log.error_message}</p>
                        )}
                        <p className="text-muted-foreground">{new Date(log.created_at).toLocaleString()}</p>
                      </div>
                      <Badge
                        variant={
                          log.status === "sent"
                            ? "default"
                            : log.status === "pending"
                              ? "secondary"
                              : "destructive"
                        }
                        className="shrink-0"
                      >
                        {log.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {diagnosticsMut.isPending
                    ? "…"
                    : t("admin.emails.noLogs", "Nenhum envio registrado para este e-mail.")}
                </p>
              )}
            </div>
          </div>
        )}

        {notFound && (
          <p className="mt-4 text-sm text-muted-foreground">{t("admin.emails.notFound")}</p>
        )}
      </Card>

      {notFound && (
        <Card className="p-5">
          <p className="mb-3 text-sm font-semibold">{t("admin.emails.createTitle")}</p>
          <p className="mb-3 text-xs text-muted-foreground">{t("admin.emails.createHelp")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium">{t("admin.emails.emailLabel")}</label>
              <Input value={normalizedEmail} readOnly disabled />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">{t("admin.emails.fullNameLabel")}</label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">{t("admin.emails.passwordLabel")}</label>
              <Input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("admin.emails.passwordHint")}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">{t("admin.emails.languageLabel")}</label>
              <Select value={lang} onValueChange={(v) => setLang(v as "pt-BR" | "es")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pt-BR">Português (Brasil)</SelectItem>
                  <SelectItem value="es">Español</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            className="mt-4"
            onClick={() => createMut.mutate()}
            disabled={
              createMut.isPending ||
              !normalizedEmail ||
              fullName.trim().length === 0 ||
              password.length < 8
            }
          >
            {t("admin.emails.createAndConfirm")}
          </Button>

          {createdPassword && (
            <div className="mt-4 rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
              <p className="font-medium">{t("admin.emails.createdNotice")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("admin.emails.passwordCopyHint")}</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 rounded bg-background px-2 py-1 font-mono text-xs">
                  {createdPassword}
                </code>
                <Button size="sm" variant="outline" onClick={() => copy(createdPassword)}>
                  <Copy size={14} /> {t("admin.emails.copy")}
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}