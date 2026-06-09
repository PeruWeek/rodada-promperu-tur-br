import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Pencil, Search } from "lucide-react";

import { listAdminCompanies } from "@/lib/admin.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EditCompanyDrawer } from "./edit-company-drawer";

type RoleFilter = "all" | "visitor" | "exhibitor";

export function CompaniesTab({ readOnly = false }: { readOnly?: boolean } = {}) {
  const { t } = useTranslation();
  const listFn = useServerFn(listAdminCompanies);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<RoleFilter>("all");
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-companies", search, role, page],
    queryFn: () => listFn({ data: { search, role, page, pageSize: 25 } }),
  });

  return (
    <Card className="p-5">
      <p className="mb-4 text-xs text-muted-foreground">{t("admin.companies.help")}</p>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
          <Input
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            placeholder={t("admin.companies.searchPlaceholder")}
            className="pl-8"
          />
        </div>
        <Select
          value={role}
          onValueChange={(v) => {
            setPage(1);
            setRole(v as RoleFilter);
          }}
        >
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("admin.companies.roleAll")}</SelectItem>
            <SelectItem value="visitor">{t("admin.companies.roleVisitor")}</SelectItem>
            <SelectItem value="exhibitor">{t("admin.companies.roleExhibitor")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (data?.rows ?? []).length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("admin.companies.empty")}</p>
      ) : (
        <div className="space-y-2">
          {data!.rows.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.trade_name}</span>
                  <Badge variant={c.role === "exhibitor" ? "default" : "secondary"}>
                    {c.role === "exhibitor"
                      ? t("admin.companies.roleExhibitor")
                      : t("admin.companies.roleVisitor")}
                  </Badge>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {[c.city, c.state_code, c.country_code].filter(Boolean).join(" / ")}
                  {c.primary_contact?.full_name ? ` · ${c.primary_contact.full_name}` : ""}
                  {c.primary_contact?.email ? ` · ${c.primary_contact.email}` : ""}
                </p>
              </div>
              {!readOnly && (
                <Button size="sm" variant="outline" onClick={() => setEditingId(c.id)}>
                  <Pencil size={14} /> {t("admin.companies.edit")}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {data && data.total > 25 && (
        <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
          <span>{data.total} empresa(s)</span>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              ‹
            </Button>
            <span className="px-2 py-1">{page}</span>
            <Button
              size="sm"
              variant="ghost"
              disabled={page * 25 >= data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              ›
            </Button>
          </div>
        </div>
      )}

      {editingId && (
        <EditCompanyDrawer
          companyId={editingId}
          onClose={() => setEditingId(null)}
          onSaved={() => {
            setEditingId(null);
            refetch();
          }}
        />
      )}
    </Card>
  );
}