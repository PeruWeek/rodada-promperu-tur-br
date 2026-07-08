import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Mail, Send, RefreshCw, CheckCircle2, Clock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  listPostEventQAStatus,
  sendPostEventQA,
} from "@/lib/postevent-qa.functions";

function fmt(dt: string | null): string {
  if (!dt) return "—";
  return new Date(dt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function PostEventQATab() {
  const listFn = useServerFn(listPostEventQAStatus);
  const sendFn = useServerFn(sendPostEventQA);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["postevent-qa-status"],
    queryFn: () => listFn({ data: {} }),
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const rows = useMemo(() => data?.rows ?? [], [data]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.profile_id)));
  };

  const sendMutation = useMutation({
    mutationFn: async (profileIds: string[]) =>
      sendFn({ data: { profileIds } }),
    onSuccess: (res) => {
      toast.success(`Enviados: ${res.sent}. Falhas: ${res.failed ?? 0}.`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["postevent-qa-status"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao enviar"),
  });

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Q&amp;A do evento</p>
            <p className="text-xs text-muted-foreground">
              Envia e-mail pós-evento com link individual para cada participante presente
              confirmar com quais empresas realmente se reuniu. As respostas alimentam
              diretamente <code>meeting_checkins</code> e <code>meetings.status</code>.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => qc.invalidateQueries({ queryKey: ["postevent-qa-status"] })}
            >
              <RefreshCw size={14} /> Atualizar
            </Button>
            <Button
              size="sm"
              disabled={selected.size === 0 || sendMutation.isPending}
              onClick={() => sendMutation.mutate(Array.from(selected))}
            >
              <Send size={14} /> Enviar Q&amp;A ({selected.size})
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : rows.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            Nenhum participante presente no evento ainda. O Q&amp;A só é habilitado para
            quem tem check-in geral registrado.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <Checkbox
                      checked={selected.size > 0 && selected.size === rows.length}
                      onCheckedChange={toggleAll}
                    />
                  </TableHead>
                  <TableHead>Participante</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Enviado</TableHead>
                  <TableHead>Abriu</TableHead>
                  <TableHead>Respondeu</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.profile_id}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(r.profile_id)}
                        onCheckedChange={() => toggle(r.profile_id)}
                      />
                    </TableCell>
                    <TableCell className="text-xs font-medium">
                      {r.full_name || "—"}
                    </TableCell>
                    <TableCell className="text-xs">{r.company ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.email ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      {r.sent_at ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600">
                          <Mail size={12} /> {fmt(r.sent_at)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.first_opened_at ? (
                        <span className="inline-flex items-center gap-1 text-blue-600">
                          <Clock size={12} /> {fmt(r.first_opened_at)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.submitted_at ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700">
                          <CheckCircle2 size={12} /> {fmt(r.submitted_at)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Pendente</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}