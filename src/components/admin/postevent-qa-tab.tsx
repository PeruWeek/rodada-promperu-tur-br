import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Mail, Send, RefreshCw, CheckCircle2, Clock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  sendPostEventQATest,
} from "@/lib/postevent-qa.functions";

type SendFailure = {
  profileId: string;
  email: string | null;
  name: string | null;
  reason: string;
};

type SendSummary = {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  failures: SendFailure[];
};

function fmt(dt: string | null): string {
  if (!dt) return "—";
  return new Date(dt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function PostEventQATab() {
  const listFn = useServerFn(listPostEventQAStatus);
  const sendFn = useServerFn(sendPostEventQA);
  const sendTestFn = useServerFn(sendPostEventQATest);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["postevent-qa-status"],
    queryFn: () => listFn({ data: {} }),
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [batchProgress, setBatchProgress] = useState<{
    total: number;
    done: number;
    sent: number;
    failed: number;
    skipped: number;
  } | null>(null);
  const [lastSendSummary, setLastSendSummary] = useState<SendSummary | null>(null);

  const allRows = useMemo(() => data?.rows ?? [], [data]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allRows;
    return allRows.filter(
      (r) =>
        (r.full_name ?? "").toLowerCase().includes(q) ||
        (r.email ?? "").toLowerCase().includes(q) ||
        (r.company ?? "").toLowerCase().includes(q),
    );
  }, [allRows, search]);

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

  const CHUNK_SIZE = 8;
  const sendMutation = useMutation({
    mutationFn: async (profileIds: string[]) => {
      const chunks: string[][] = [];
      for (let i = 0; i < profileIds.length; i += CHUNK_SIZE) {
        chunks.push(profileIds.slice(i, i + CHUNK_SIZE));
      }
      let sent = 0;
      let failed = 0;
      let skipped = 0;
      let done = 0;
      const failures: SendFailure[] = [];
      setLastSendSummary(null);
      setBatchProgress({
        total: profileIds.length,
        done: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
      });
      for (const chunk of chunks) {
        try {
          const res = await sendFn({ data: { profileIds: chunk } });
          sent += res.sent ?? 0;
          failed += res.failed ?? 0;
          skipped += res.skipped ?? 0;
          failures.push(...((res.failures ?? []) as SendFailure[]));
        } catch (e) {
          const reason = e instanceof Error ? e.message : "Falha inesperada no lote.";
          failed += chunk.length;
          failures.push(
            ...chunk.map((profileId) => {
              const row = allRows.find((r) => r.profile_id === profileId);
              return {
                profileId,
                email: row?.email ?? null,
                name: row?.full_name ?? null,
                reason,
              };
            }),
          );
          console.error("[postevent-qa] chunk failed", { chunkSize: chunk.length, reason });
        }
        done += chunk.length;
        setBatchProgress({ total: profileIds.length, done, sent, failed, skipped });
      }
      return { total: profileIds.length, sent, failed, skipped, failures };
    },
    onSuccess: (res) => {
      setLastSendSummary(res);
      if (res.failed > 0) {
        toast.warning(
          `Envio concluído com falhas: ${res.sent} enviados, ${res.failed} falharam.`,
        );
      } else {
        toast.success(`Envio concluído: ${res.sent} enviados.`);
      }
      setSelected(new Set());
      setBatchProgress(null);
      qc.invalidateQueries({ queryKey: ["postevent-qa-status"] });
    },
    onError: (e: any) => {
      setBatchProgress(null);
      toast.error(e?.message ?? "Falha ao enviar");
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => sendTestFn({ data: { testEmail } }),
    onSuccess: (res) => {
      if (res.ok) toast.success("E-mail de teste enviado.");
      else toast.error("Não foi possível enviar o e-mail de teste.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao enviar teste"),
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
              <Send size={14} />
              {sendMutation.isPending && batchProgress
                ? `Enviando ${batchProgress.done}/${batchProgress.total}…`
                : `Enviar Pesquisa (${selected.size})`}
            </Button>
          </div>
        </div>
        {batchProgress && (
          <div className="mt-4 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">
              Envio em andamento: {batchProgress.done}/{batchProgress.total}
            </p>
            <p>
              Enviados: {batchProgress.sent} · Falhas: {batchProgress.failed} · Ignorados: {batchProgress.skipped}
            </p>
          </div>
        )}
        {lastSendSummary && (
          <div className="mt-4 rounded-md border p-3 text-xs">
            <p className="font-medium">
              Último envio: {lastSendSummary.sent} enviados, {lastSendSummary.failed} falhas,
              {" "}{lastSendSummary.skipped} ignorados de {lastSendSummary.total} selecionados.
            </p>
            {lastSendSummary.failures.length > 0 && (
              <div className="mt-2 space-y-1 text-muted-foreground">
                {lastSendSummary.failures.slice(0, 8).map((failure) => (
                  <p key={`${failure.profileId}-${failure.reason}`}>
                    {failure.name || failure.email || failure.profileId}: {failure.reason}
                  </p>
                ))}
                {lastSendSummary.failures.length > 8 && (
                  <p>Mais {lastSendSummary.failures.length - 8} falhas omitidas.</p>
                )}
              </div>
            )}
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-end gap-3 border-t pt-4">
          <div className="min-w-[240px] flex-1">
            <Label className="text-xs">E-mail de teste</Label>
            <Input
              type="email"
              placeholder="voce@exemplo.com"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={!testEmail || testMutation.isPending}
            onClick={() => testMutation.mutate()}
          >
            <Send size={14} /> Enviar teste
          </Button>
          <p className="w-full text-xs text-muted-foreground">
            O envio de teste vai para o e-mail informado, não gera campanha, não cria
            token e não altera <code>meeting_checkins</code> ou <code>meetings.status</code>.
          </p>
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-3">
          <Input
            placeholder="Buscar por empresa, participante ou e-mail…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-md"
          />
        </div>
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : rows.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            {allRows.length === 0
              ? "Nenhum participante presente no evento ainda. A Pesquisa só é habilitada para quem tem check-in geral registrado."
              : "Nenhum resultado para a busca."}
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