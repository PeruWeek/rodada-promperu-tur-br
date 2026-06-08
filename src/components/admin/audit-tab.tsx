import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw } from "lucide-react";

import { listAuditLogs } from "@/lib/audit.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ACTION_LABELS: Record<string, string> = {
  "company.created": "Empresa criada",
  "company.deleted": "Empresa excluída",
  "profile.created": "Perfil criado",
  "profile.company_linked": "Perfil vinculado a empresa",
  "role.assigned": "Papel atribuído",
  "role.removed": "Papel removido",
  "role.changed": "Papel alterado",
  "pipeline.created": "Pipeline criado",
  "pipeline.registration_status": "Status cadastro alterado",
  "pipeline.scheduling_status": "Status agendamento alterado",
  "pipeline.owner_changed": "Responsável alterado",
  "exhibitor_request.created": "Solicitação de expositor",
  "exhibitor_request.reviewed": "Solicitação revisada",
};

const FILTER_OPTIONS = [
  { value: "all", label: "Todas as ações" },
  ...Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label })),
];

export function AuditTab() {
  const fetchLogs = useServerFn(listAuditLogs);
  const [filter, setFilter] = useState<string>("all");

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["audit-logs", filter],
    queryFn: () => fetchLogs({ data: { limit: 200, action: filter === "all" ? null : filter } }),
  });

  const rows = data?.rows ?? [];
  const actors = data?.actors ?? {};

  const formatPayload = useMemo(
    () => (p: Record<string, unknown> | null) => {
      if (!p) return "";
      const keys = ["trade_name", "email", "full_name", "role", "old", "new", "old_role", "new_role"];
      const parts: string[] = [];
      for (const k of keys) {
        const v = (p as Record<string, unknown>)[k];
        if (v != null && v !== "") parts.push(`${k}: ${String(v)}`);
      }
      return parts.join(" • ");
    },
    []
  );

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Auditoria</h2>
          <p className="text-sm text-muted-foreground">
            Histórico de cadastros, papéis e ações administrativas.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              {FILTER_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {isLoading ? (
          <>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Nenhum evento registrado.</p>
        ) : (
          rows.map((r) => {
            const actor = r.actor_profile_id ? actors[r.actor_profile_id] : null;
            const label = ACTION_LABELS[r.action] ?? r.action;
            return (
              <div key={r.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{label}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleString("pt-BR")}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {actor ? (actor.full_name || actor.email || "—") : "Sistema"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-foreground/80">
                  {formatPayload(r.payload as Record<string, unknown> | null)}
                </p>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}