import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ShieldAlert } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  getVisitorCancellationBlock,
  updateVisitorCancellationBlock,
} from "@/lib/visitor-cancellation.functions";

export function VisitorCancellationTab() {
  const qc = useQueryClient();
  const getFn = useServerFn(getVisitorCancellationBlock);
  const updateFn = useServerFn(updateVisitorCancellationBlock);

  const { data, isLoading } = useQuery({
    queryKey: ["visitor-cancellation-block"],
    queryFn: () => getFn(),
  });

  const mut = useMutation({
    mutationFn: (enabled: boolean) => updateFn({ data: { enabled } }),
    onSuccess: (updated) => {
      qc.setQueryData(["visitor-cancellation-block"], updated);
      qc.invalidateQueries({ queryKey: ["visitor-cancellation-block"] });
      toast.success(
        updated.enabled
          ? "Cancelamento pelo visitante bloqueado"
          : "Cancelamento pelo visitante liberado",
      );
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Falha ao atualizar configuração");
    },
  });

  const enabled = !!data?.enabled;

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-md bg-muted p-2">
              <ShieldAlert size={18} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold">Bloquear cancelamento pelo visitante</h3>
                {enabled ? (
                  <Badge variant="destructive">Bloqueado</Badge>
                ) : (
                  <Badge variant="secondary">Liberado</Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Quando ativo, o botão "Cancelar" some da agenda do visitante e a chamada
                <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">cancelMeeting</code>
                é rejeitada no backend antes de qualquer alteração em
                <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">meetings.status</code>.
                Nenhum e-mail ou notificação de cancelamento é gerado.
                Fluxos de admin (cancelar manual, cancelar futuras, inativação) continuam funcionando normalmente.
              </p>
              {data?.updated_at && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Última alteração: {new Date(data.updated_at).toLocaleString("pt-BR")}
                </p>
              )}
            </div>
          </div>
          <div className="shrink-0">
            {isLoading ? (
              <Skeleton className="h-6 w-11" />
            ) : (
              <Switch
                checked={enabled}
                disabled={mut.isPending}
                onCheckedChange={(v) => mut.mutate(v)}
                aria-label="Bloquear cancelamento pelo visitante"
              />
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}