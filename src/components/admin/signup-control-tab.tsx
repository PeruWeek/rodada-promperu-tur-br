import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useSignupSettings } from "@/hooks/use-signup-settings";
import { updateSignupSettings } from "@/lib/signup-settings.functions";

export function SignupControlTab() {
  const qc = useQueryClient();
  const updateFn = useServerFn(updateSignupSettings);
  const { data, isLoading } = useSignupSettings();

  const mut = useMutation({
    mutationFn: (enabled: boolean) => updateFn({ data: { enabled } }),
    onSuccess: (updated) => {
      qc.setQueryData(["signup-settings"], updated);
      qc.invalidateQueries({ queryKey: ["signup-settings"] });
      toast.success(updated.enabled ? "Inscricoes abertas" : "Inscricoes encerradas");
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Falha ao atualizar configuracao");
    },
  });

  const enabled = data?.enabled ?? true;

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
                <h3 className="text-base font-semibold">Controle de inscricoes</h3>
                {enabled ? (
                  <Badge variant="secondary">Abertas</Badge>
                ) : (
                  <Badge variant="destructive">Encerradas</Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Quando desligado, as paginas publicas de cadastro ficam fora do ar,
                o login continua disponivel e o frontend exibe a mensagem
                <span className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">
                  Inscricoes encerradas
                </span>
                para novos acessos.
              </p>
              {data?.updated_at && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Ultima alteracao: {new Date(data.updated_at).toLocaleString("pt-BR")}
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
                aria-label="Controlar inscricoes"
              />
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
