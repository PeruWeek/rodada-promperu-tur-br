import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PasswordInput } from "@/components/ui/password-input";
import {
  getCredentialStatus,
  saveUserCredential,
  deleteUserCredential,
} from "@/lib/credentials.functions";

export const Route = createFileRoute("/_authenticated/credenciais-llm")({
  component: Page,
});

function Page() {
  const qc = useQueryClient();
  const statusFn = useServerFn(getCredentialStatus);
  const saveFn = useServerFn(saveUserCredential);
  const delFn = useServerFn(deleteUserCredential);
  const [key, setKey] = useState("");

  const { data: status } = useQuery({ queryKey: ["llm-cred"], queryFn: () => statusFn() });

  const save = useMutation({
    mutationFn: async () => saveFn({ data: { api_key: key } }),
    onSuccess: () => {
      toast.success("Chave salva");
      setKey("");
      qc.invalidateQueries({ queryKey: ["llm-cred"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async () => delFn(),
    onSuccess: () => {
      toast.success("Chave removida");
      qc.invalidateQueries({ queryKey: ["llm-cred"] });
    },
  });

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Credenciais LLM</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Sua API key OpenRouter pessoal (opcional). Se não definida, usamos a chave do app.
        </p>
      </div>

      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-sm">Status:</span>
          {status?.has_user_key ? (
            <Badge>Usando sua chave pessoal</Badge>
          ) : status?.app_key_available ? (
            <Badge variant="secondary">Usando chave do app</Badge>
          ) : (
            <Badge variant="destructive">Nenhuma chave disponível</Badge>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">API Key OpenRouter</label>
          <PasswordInput
            placeholder="sk-or-..."
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="flex gap-2">
          <Button onClick={() => save.mutate()} disabled={!key || save.isPending}>
            {status?.has_user_key ? "Substituir" : "Salvar"}
          </Button>
          {status?.has_user_key && (
            <Button variant="outline" onClick={() => remove.mutate()} disabled={remove.isPending}>
              Remover
            </Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          A chave é criptografada antes de ser armazenada. Nunca exibimos a chave após o salvamento.
        </p>
      </Card>
    </div>
  );
}