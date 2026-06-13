import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Download, FileUp, Loader2 } from "lucide-react";
import Papa from "papaparse";

import { supabase } from "@/integrations/supabase/client";
import {
  importPreRegistrationsCsv,
  PRE_REG_CSV_HEADERS,
  type ImportRowResult,
} from "@/lib/pre-registration.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { downloadBlob } from "@/lib/exports/csv";

const MAX_BYTES = 2 * 1024 * 1024; // 2MB
const BATCH_SIZE = 50;
const BATCH_RETRIES = 2; // total attempts per batch = 1 + BATCH_RETRIES

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function buildTemplateCsv(): string {
  const headers = PRE_REG_CSV_HEADERS.join(";");
  const sample = [
    "Empresa Exemplo Ltda",
    "Empresa Exemplo Comércio Ltda",
    "12.345.678/0001-90",
    "BR",
    "SP",
    "São Paulo",
    "Maria Silva",
    "Diretora Comercial",
    "maria@exemplo.com",
    "(11) 98765-4321",
    "(11) 98765-4321",
    "pt-BR",
  ].join(";");
  return "\ufeff" + headers + "\r\n" + sample + "\r\n";
}

function resultsToCsv(results: ImportRowResult[]): string {
  const headers = ["line", "email", "outcome", "message"].join(";");
  const lines = results.map((r) =>
    [r.line, r.email ?? "", r.outcome, (r.message ?? "").replace(/[\r\n;]/g, " ")].join(";"),
  );
  return "\ufeff" + headers + "\r\n" + lines.join("\r\n");
}

export function PreRegistrationsTab() {
  const { t } = useTranslation();
  const importFn = useServerFn(importPreRegistrationsCsv);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [eventId, setEventId] = useState<string>("");
  const [csv, setCsv] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [results, setResults] = useState<{
    total: number; created: number; updated: number; skipped: number; errors: number;
    results: ImportRowResult[];
  } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const { data: events, isLoading: loadingEvents } = useQuery({
    queryKey: ["pre-reg-events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, name, event_date")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Default to most recent event.
  useMemo(() => {
    if (!eventId && events && events.length > 0) setEventId(events[0].id);
  }, [events, eventId]);

  const mut = useMutation({
    mutationFn: async () => {
      if (!eventId) throw new Error(t("admin.preRegistration.selectEvent"));
      if (!csv) throw new Error(t("admin.preRegistration.selectFile"));

      // Parse once on the client, then send batches. A single full-file
      // request hits the worker wall-time budget and surfaces as "Load failed".
      const parsed = Papa.parse<Record<string, string>>(csv, {
        header: true,
        skipEmptyLines: "greedy",
        transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
      });
      const rows = parsed.data ?? [];
      const headers = parsed.meta.fields ?? [];
      if (rows.length === 0) {
        if (parsed.errors.length > 0) {
          throw new Error(parsed.errors[0]?.message ?? "CSV parse error");
        }
        return { total: 0, created: 0, updated: 0, skipped: 0, errors: 0, results: [] as ImportRowResult[] };
      }

      const aggregate = {
        total: 0, created: 0, updated: 0, skipped: 0, errors: 0,
        results: [] as ImportRowResult[],
      };
      const totalBatches = Math.ceil(rows.length / BATCH_SIZE);
      for (let b = 0; b < totalBatches; b++) {
        const startIdx = b * BATCH_SIZE;
        const chunk = rows.slice(startIdx, startIdx + BATCH_SIZE);
        const chunkCsv = Papa.unparse(
          { fields: headers, data: chunk },
          { delimiter: ";", newline: "\r\n" },
        );
        setProgress({ done: startIdx, total: rows.length });
        // The server fn is idempotent (upsert by email / tax_id), so on a
        // transport-layer failure ("Load failed", timeouts, 5xx) we can safely
        // retry the same batch — rows already persisted come back as
        // `updated` / `skipped_existing_filled` instead of duplicates.
        let lastError: unknown = null;
        let succeeded = false;
        for (let attempt = 0; attempt <= BATCH_RETRIES; attempt++) {
          try {
            const r = await importFn({ data: { csv: chunkCsv, eventId } });
            aggregate.total += r.total;
            aggregate.created += r.created;
            aggregate.updated += r.updated;
            aggregate.skipped += r.skipped;
            aggregate.errors += r.errors;
            for (const row of r.results) {
              aggregate.results.push({ ...row, line: startIdx + row.line });
            }
            succeeded = true;
            break;
          } catch (err) {
            lastError = err;
            if (attempt < BATCH_RETRIES) {
              await sleep(800 * (attempt + 1));
            }
          }
        }
        if (!succeeded) {
          const message = lastError instanceof Error ? lastError.message : String(lastError);
          for (let i = 0; i < chunk.length; i++) {
            aggregate.total += 1;
            aggregate.errors += 1;
            aggregate.results.push({
              line: startIdx + i + 2,
              email: typeof chunk[i]?.email === "string" ? chunk[i].email : null,
              outcome: "error",
              message,
            });
          }
        }
      }
      setProgress({ done: rows.length, total: rows.length });
      return aggregate;
    },
    onSuccess: (r) => {
      setResults(r);
      toast.success(
        t("admin.preRegistration.done", {
          created: r.created, updated: r.updated, skipped: r.skipped, errors: r.errors,
        }),
      );
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setProgress(null),
  });

  const onPickFile = async (file: File | null) => {
    if (!file) return;
    if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") {
      toast.error(t("admin.preRegistration.invalidType"));
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(t("admin.preRegistration.tooLarge"));
      return;
    }
    const text = await file.text();
    setCsv(text);
    setFileName(file.name);
    setResults(null);
  };

  const downloadTemplate = () => {
    downloadBlob("pre-cadastros-template.csv", new Blob([buildTemplateCsv()], { type: "text/csv;charset=utf-8" }));
  };

  const downloadReport = () => {
    if (!results) return;
    downloadBlob(
      `pre-cadastros-relatorio-${Date.now()}.csv`,
      new Blob([resultsToCsv(results.results)], { type: "text/csv;charset=utf-8" }),
    );
  };

  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">{t("admin.preRegistration.title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("admin.preRegistration.subtitle")}</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <label className="text-xs font-medium text-muted-foreground">{t("admin.preRegistration.event")}</label>
          <Select value={eventId} onValueChange={setEventId} disabled={loadingEvents}>
            <SelectTrigger className="mt-1.5"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              {(events ?? []).map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name}{e.event_date ? ` · ${e.event_date}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="button" variant="outline" onClick={downloadTemplate}>
          <Download className="mr-2 h-4 w-4" />{t("admin.preRegistration.downloadTemplate")}
        </Button>
      </div>

      <div className="mt-4 rounded-md border border-dashed p-4">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
            <FileUp className="mr-2 h-4 w-4" />{t("admin.preRegistration.pickFile")}
          </Button>
          <span className="text-sm text-muted-foreground">
            {fileName || t("admin.preRegistration.noFile")}
          </span>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {t("admin.preRegistration.headerHint", { headers: PRE_REG_CSV_HEADERS.join(", ") })}
        </p>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button
          type="button"
          onClick={() => mut.mutate()}
          disabled={mut.isPending || !eventId || !csv}
        >
          {mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {mut.isPending && progress
            ? `${progress.done}/${progress.total}`
            : t("admin.preRegistration.import")}
        </Button>
        {results && (
          <Button type="button" variant="ghost" onClick={downloadReport}>
            <Download className="mr-2 h-4 w-4" />{t("admin.preRegistration.downloadReport")}
          </Button>
        )}
      </div>

      {results && (
        <div className="mt-6 space-y-3">
          <div className="grid gap-2 sm:grid-cols-5 text-sm">
            <Summary label={t("admin.preRegistration.summary.total")} value={results.total} />
            <Summary label={t("admin.preRegistration.summary.created")} value={results.created} tone="ok" />
            <Summary label={t("admin.preRegistration.summary.updated")} value={results.updated} tone="info" />
            <Summary label={t("admin.preRegistration.summary.skipped")} value={results.skipped} tone="muted" />
            <Summary label={t("admin.preRegistration.summary.errors")} value={results.errors} tone="bad" />
          </div>
          {results.results.some((r) => r.outcome === "error") && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-sm font-medium text-destructive">{t("admin.preRegistration.errorsHeader")}</p>
              <ul className="mt-2 max-h-60 space-y-1 overflow-auto text-xs">
                {results.results
                  .filter((r) => r.outcome === "error")
                  .map((r) => (
                    <li key={r.line}>
                      <span className="font-mono">L{r.line}</span> · {r.email ?? "—"} · {r.message}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Summary({
  label, value, tone,
}: { label: string; value: number; tone?: "ok" | "bad" | "info" | "muted" }) {
  const cls =
    tone === "ok" ? "text-emerald-600" :
    tone === "bad" ? "text-destructive" :
    tone === "info" ? "text-primary" :
    tone === "muted" ? "text-muted-foreground" : "";
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${cls}`}>{value}</p>
    </div>
  );
}