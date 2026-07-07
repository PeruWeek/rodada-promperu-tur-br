import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";

import { listAuditLogs } from "@/lib/audit.functions";
import { sendTestTransactionalEmail } from "@/lib/email-admin.functions";
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
  "meeting.cancelled": "Reunião cancelada",
  "registrant.deactivated.meetings_cancelled": "Inscrito inativado — reuniões canceladas",
};

const CANCEL_ORIGIN_LABELS: Record<string, string> = {
  visitor_self: "Visitante",
  admin_manual: "Admin — manual",
  admin_cancel_all_future: "Admin — futuras",
  admin_deactivation: "Admin — inativação",
  system_dedupe: "Sistema — dedupe",
  system_sanitize: "Sistema — sanitize",
  system_other: "Sistema — outro",
};

const FILTER_OPTIONS = [
  { value: "all", label: "Todas as ações" },
  ...Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label })),
];

export function AuditTab() {
  const fetchLogs = useServerFn(listAuditLogs);
  const sendTest = useServerFn(sendTestTransactionalEmail);
  const [filter, setFilter] = useState<string>("all");
  const [testEmail, setTestEmail] = useState<string>("");

  const testMutation = useMutation({
    mutationFn: async (email: string) => sendTest({ data: { recipientEmail: email } }),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("E-mail de teste enviado via SendGrid");
      } else {
        toast.error(`Falha no envio (HTTP ${res.status})`);
        console.warn("[email-test] failed", res);
      }
    },
    onError: (err: Error) => toast.error(err.message || "Erro ao enviar teste"),
  });

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

  const formatSlotStart = (iso: string | null | undefined) => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit",
        timeZone: "America/Sao_Paulo",
      });
    } catch { return iso; }
  };

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

      <div className="mt-4 rounded-md border border-dashed p-3">
        <p className="text-sm font-medium">Enviar e-mail de teste (SendGrid)</p>
        <p className="text-xs text-muted-foreground mb-2">
          Dispara o template <code>meeting-confirmation</code> com dados fictícios para validar a integração.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="email"
            placeholder="destinatario@exemplo.com"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            className="max-w-xs"
          />
          <Button
            size="sm"
            onClick={() => testMutation.mutate(testEmail.trim())}
            disabled={!testEmail.trim() || testMutation.isPending}
          >
            <Send className="h-4 w-4 mr-1" />
            {testMutation.isPending ? "Enviando..." : "Enviar teste"}
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
            const payload = (r.payload ?? {}) as Record<string, unknown>;
            if (r.action === "meeting.cancelled") {
              const origin = String(payload.origin ?? "");
              const originLabel = CANCEL_ORIGIN_LABELS[origin] ?? origin ?? "—";
              const actorType = String(payload.actor_type ?? "—");
              const actorName = String(payload.actor_name ?? actor?.full_name ?? "—");
              const visitorName = String(payload.visitor_name ?? payload.visitor_profile_id ?? "—");
              const visitorCompany = payload.visitor_company ? ` — ${String(payload.visitor_company)}` : "";
              const tableNumber = payload.table_number != null ? `Mesa ${String(payload.table_number)}` : String(payload.table_id ?? "—");
              const exhibitorCompany = payload.exhibitor_company ? ` — ${String(payload.exhibitor_company)}` : "";
              const slotStart = formatSlotStart(payload.slot_start as string | null | undefined);
              const cancelledAt = formatSlotStart((payload.cancelled_at as string | null | undefined) ?? r.created_at);
              const cancelReason = payload.cancel_reason ? String(payload.cancel_reason) : "—";
              return (
                <div key={r.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{label}</Badge>
                      <Badge variant="outline">Origem: {originLabel}</Badge>
                      <Badge variant="outline">Ator: {actorType}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(r.created_at).toLocaleString("pt-BR")}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">{actorName}</span>
                  </div>
                  <div className="mt-2 grid gap-1 text-sm">
                    <div><span className="text-muted-foreground">Visitante:</span> {visitorName}{visitorCompany}</div>
                    <div><span className="text-muted-foreground">Expositor:</span> {tableNumber}{exhibitorCompany}</div>
                    <div><span className="text-muted-foreground">Horário do slot:</span> {slotStart}</div>
                    <div><span className="text-muted-foreground">Cancelado em:</span> {cancelledAt}</div>
                    <div><span className="text-muted-foreground">Motivo:</span> {cancelReason}</div>
                  </div>
                </div>
              );
            }
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