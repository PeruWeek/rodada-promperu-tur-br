import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { DoorClosed } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  getSignupSettings,
  updateSignupSettings,
} from "@/lib/signup-settings.functions";

export function SignupSettingsTab() {
  const qc = useQueryClient();
  const getFn = useServerFn(getSignupSettings);
  const updateFn = useServerFn(updateSignupSettings);

  const { data, isLoading } = useQuery({
    queryKey: ["signup-settings"],
    queryFn: () => getFn(),
  });

  const mut = useMutation({
    mutationFn: (enabled: boolean) => updateFn({ data: { enabled } }),
    onSuccess: (updated) => {
      qc.setQueryData(["signup-settings"], updated);
      qc.invalidateQueries({ queryKey: ["signup-settings"] });
      toast.success(
        updated.enabled ? "Inscrições abertas" : "Inscrições encerradas",
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
              <DoorClosed size={18} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold">Controle de inscrições</h3>
                {enabled ? (
                  <Badge variant="secondary">Inscrições abertas</Badge>
                ) : (
                  <Badge variant="destructive">Inscrições encerradas</Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Quando desligado, os formulários de <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">/signup</code>
                e <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">/signup-exhibitor</code>
                deixam de ser exibidos e a home e o header escondem o CTA de cadastro.
                O login continua funcionando normalmente para quem já está cadastrado.
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
                aria-label="Controle de inscrições"
              />
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}