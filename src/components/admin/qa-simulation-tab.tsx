import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, Loader2, Play, Trash2 } from "lucide-react";

import {
  cleanupQaRound,
  listQaRuns,
  seedQaRound,
  type SeedManifestEntry,
} from "@/lib/qa-simulation.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function QaSimulationTab() {
  const qc = useQueryClient();
  const seedFn = useServerFn(seedQaRound);
  const cleanFn = useServerFn(cleanupQaRound);
  const listFn = useServerFn(listQaRuns);

  const [lastManifest, setLastManifest] = useState<{
    run_id: string;
    event_id: string;
    entries: SeedManifestEntry[];
  } | null>(null);
  const [cleanupInput, setCleanupInput] = useState("");

  const runs = useQuery({
    queryKey: ["qa-runs"],
    queryFn: () => listFn({ data: undefined as never }),
  });

  const seed = useMutation({
    mutationFn: () => seedFn({ data: {} }),
    onSuccess: (res: any) => {
      if (res?.skipped === "no_empty_tables") {
        toast.info("Nenhuma mesa vazia disponível para semear.");
        return;
      }
      setLastManifest({
        run_id: res.run_id,
        event_id: res.event_id,
        entries: res.entries ?? [],
      });
      setCleanupInput(res.run_id);
      toast.success(`Seed concluído: ${res.entries.length} mesa(s). Run ID: ${res.run_id}`);
      qc.invalidateQueries({ queryKey: ["qa-runs"] });
    },
    onError: (e: any) => toast.error(`Seed falhou: ${e?.message ?? e}`),
  });

  const cleanup = useMutation({
    mutationFn: (runId: string) => cleanFn({ data: { runId } }),
    onSuccess: (rep: any) => {
      toast.success(
        `Cleanup ok: meetings=${rep.meetings_deleted}, mesas liberadas=${rep.table_assignments_cleared}, users=${rep.auth_users_deleted}, empresas=${rep.companies_deleted}`,
      );
      if (lastManifest?.run_id === rep.run_id) setLastManifest(null);
      qc.invalidateQueries({ queryKey: ["qa-runs"] });
    },
    onError: (e: any) => toast.error(`Cleanup falhou: ${e?.message ?? e}`),
  });

  const copyManifest = () => {
    if (!lastManifest) return;
    navigator.clipboard.writeText(JSON.stringify(lastManifest, null, 2));
    toast.success("Manifest copiado.");
  };

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <h3 className="text-lg font-semibold">Simulação de Rodada (QA)</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Ferramenta temporária. Cria expositores/empresas fictícios nas mesas vazias e remove
          tudo (incluindo reuniões criadas durante o teste) ao final. Apenas admin.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => seed.mutate()} disabled={seed.isPending}>
            {seed.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Play className="mr-2 size-4" />}
            Seed mesas vazias
          </Button>
        </div>
      </Card>

      {lastManifest && (
        <Card className="p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h4 className="font-semibold">Manifest — Run ID: <span className="font-mono text-sm">{lastManifest.run_id}</span></h4>
              <p className="text-xs text-muted-foreground">event_id: <span className="font-mono">{lastManifest.event_id}</span></p>
            </div>
            <Button size="sm" variant="outline" onClick={copyManifest}>
              <Copy className="mr-2 size-4" />Copiar JSON
            </Button>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-2">Mesa</th>
                  <th className="py-1 pr-2">Empresa</th>
                  <th className="py-1 pr-2">Email</th>
                  <th className="py-1 pr-2">Senha</th>
                </tr>
              </thead>
              <tbody>
                {lastManifest.entries.map((e) => (
                  <tr key={e.exhibitor_profile_id} className="border-t">
                    <td className="py-1 pr-2 font-mono">#{e.table_number}</td>
                    <td className="py-1 pr-2">{e.company_name}</td>
                    <td className="py-1 pr-2 font-mono">{e.exhibitor_email}</td>
                    <td className="py-1 pr-2 font-mono">{e.exhibitor_password}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="p-4">
        <h4 className="font-semibold">Cleanup</h4>
        <p className="mt-1 text-sm text-muted-foreground">
          Informe o <code>qa_run_id</code> para remover todos os dados criados pelo seed e
          quaisquer reuniões associadas. Operação idempotente.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Input
            value={cleanupInput}
            onChange={(e) => setCleanupInput(e.target.value)}
            placeholder="qa-YYYYMMDDHHMMSS-xxxx"
            className="max-w-xs"
          />
          <Button
            variant="destructive"
            disabled={cleanup.isPending || !cleanupInput.trim()}
            onClick={() => cleanup.mutate(cleanupInput.trim())}
          >
            {cleanup.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Trash2 className="mr-2 size-4" />}
            Limpar run
          </Button>
        </div>

        <div className="mt-4">
          <h5 className="text-sm font-medium">Runs existentes</h5>
          {runs.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : (runs.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum run ativo.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {(runs.data ?? []).map((r: any) => (
                <li key={r.run_id} className="flex items-center justify-between gap-2 rounded border px-2 py-1 text-sm">
                  <span className="font-mono">{r.run_id}</span>
                  <span className="text-xs text-muted-foreground">{r.profile_count} perfil(s)</span>
                  <Button size="sm" variant="outline" onClick={() => setCleanupInput(r.run_id)}>
                    Selecionar
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}