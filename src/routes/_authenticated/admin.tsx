import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, RefreshCw, Search, UserCheck } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useProfile, hasRole, type AppRole } from "@/hooks/use-profile";
import { assignExhibitorToTable, rebuildSlots, setUserRole } from "@/lib/admin.functions";
import { generalCheckIn } from "@/lib/checkin.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

  if (!hasRole(me?.roles, "admin", "staff")) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10">
        <Card className="p-6 text-sm text-muted-foreground">{t("admin.forbidden")}</Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <h1 className="text-3xl font-bold">{t("admin.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("admin.subtitle")}</p>

      <Tabs defaultValue="tables" className="mt-6">
        <TabsList>
          <TabsTrigger value="tables">{t("admin.tabs.tables")}</TabsTrigger>
          <TabsTrigger value="checkin">{t("admin.tabs.checkin")}</TabsTrigger>
          <TabsTrigger value="users">{t("admin.tabs.users")}</TabsTrigger>
        </TabsList>
        <TabsContent value="tables" className="mt-4"><TablesTab /></TabsContent>
        <TabsContent value="checkin" className="mt-4"><CheckinTab /></TabsContent>
        <TabsContent value="users" className="mt-4"><UsersTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function TablesTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const assignFn = useServerFn(assignExhibitorToTable);
  const rebuildFn = useServerFn(rebuildSlots);

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

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{data?.event?.name ?? "—"}</p>
          <p className="text-xs text-muted-foreground">{t("admin.tables.help")}</p>
        </div>
        {data?.event && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => rebuildMut.mutate(data.event!.id)}
            disabled={rebuildMut.isPending}
          >
            <RefreshCw size={14} /> {t("admin.tables.rebuildSlots")}
          </Button>
        )}
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
          </div>
        ))}
      </div>
    </Card>
  );
}

function CheckinTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const checkInFn = useServerFn(generalCheckIn);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-checkin", q],
    queryFn: async () => {
      const { data: event } = await supabase
        .from("events").select("id, name").order("created_at").limit(1).maybeSingle();
      if (!event) return { event: null, profiles: [], checkedIds: new Set<string>() };
      let pq = supabase
        .from("profiles")
        .select("id, full_name, email, company_id")
        .eq("is_active", true)
        .order("full_name")
        .limit(50);
      if (q.trim()) pq = pq.ilike("full_name", `%${q.trim()}%`);
      const [{ data: profs }, { data: checks }] = await Promise.all([
        pq,
        supabase.from("general_checkins").select("profile_id").eq("event_id", event.id),
      ]);
      const compIds = (profs ?? []).map((p) => p.company_id).filter(Boolean) as string[];
      const { data: comps } = compIds.length
        ? await supabase.from("companies").select("id, trade_name").in("id", compIds)
        : { data: [] as Array<{ id: string; trade_name: string }> };
      return {
        event,
        profiles: (profs ?? []).map((p) => ({
          ...p,
          company: comps?.find((c) => c.id === p.company_id)?.trade_name ?? null,
        })),
        checkedIds: new Set((checks ?? []).map((c) => c.profile_id)),
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

  return (
    <Card className="p-5">
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
            const checked = data!.checkedIds.has(p.id);
            return (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.full_name}</p>
                  <p className="truncate text-xs text-muted-foreground">{[p.company, p.email].filter(Boolean).join(" · ")}</p>
                </div>
                {checked ? (
                  <Badge className="shrink-0" variant="secondary"><Check size={12} className="mr-1" />{t("admin.checkin.checked")}</Badge>
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

const ROLE_OPTIONS: AppRole[] = ["admin", "staff", "exhibitor", "visitor"];

function UsersTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const setRoleFn = useServerFn(setUserRole);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-users", q],
    queryFn: async () => {
      let pq = supabase
        .from("profiles")
        .select("id, auth_user_id, full_name, email")
        .not("auth_user_id", "is", null)
        .order("full_name")
        .limit(50);
      if (q.trim()) pq = pq.ilike("full_name", `%${q.trim()}%`);
      const { data: profs } = await pq;
      const ids = (profs ?? []).map((p) => p.auth_user_id).filter(Boolean) as string[];
      const { data: roles } = ids.length
        ? await supabase.from("user_roles").select("user_id, role").in("user_id", ids)
        : { data: [] as Array<{ user_id: string; role: AppRole }> };
      return (profs ?? []).map((p) => ({
        ...p,
        roles: (roles ?? []).filter((r) => r.user_id === p.auth_user_id).map((r) => r.role as AppRole),
      }));
    },
  });

  const mut = useMutation({
    mutationFn: async (v: { userId: string; role: AppRole; action: "add" | "remove" }) =>
      setRoleFn({ data: v }),
    onSuccess: () => {
      toast.success(t("admin.users.saved"));
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const list = useMemo(() => data ?? [], [data]);

  return (
    <Card className="p-5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("admin.users.searchPlaceholder")}
          className="pl-9"
        />
      </div>
      <div className="mt-3 space-y-2">
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : list.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">{t("admin.users.empty")}</p>
        ) : (
          list.map((u) => (
            <div key={u.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{u.full_name}</p>
                  <p className="text-xs text-muted-foreground">{u.email}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {ROLE_OPTIONS.map((r) => {
                    const active = u.roles.includes(r);
                    return (
                      <button
                        key={r}
                        type="button"
                        disabled={mut.isPending || !u.auth_user_id}
                        onClick={() =>
                          mut.mutate({
                            userId: u.auth_user_id!,
                            role: r,
                            action: active ? "remove" : "add",
                          })
                        }
                        className={`rounded-full border px-3 py-1 text-xs transition ${
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border text-muted-foreground hover:border-primary"
                        }`}
                      >
                        {t(`roles.${r}`)}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}