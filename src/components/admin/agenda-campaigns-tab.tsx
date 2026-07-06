import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, RefreshCw, Send, TestTube } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import {
  createAndSendAgendaCampaign,
  getCampaignRecipients,
  listAgendaCampaigns,
  previewEligibleRecipients,
  sendTestAgendaCampaign,
} from "@/lib/agenda-campaigns.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Category = "visitor" | "exhibitor";

export function AgendaCampaignsTab() {
  const qc = useQueryClient();
  const previewFn = useServerFn(previewEligibleRecipients);
  const sendTestFn = useServerFn(sendTestAgendaCampaign);
  const sendCampaignFn = useServerFn(createAndSendAgendaCampaign);
  const listCampaignsFn = useServerFn(listAgendaCampaigns);

  const [category, setCategory] = useState<Category>("visitor");
  const [eventId, setEventId] = useState<string | null>(null);
  const [subject, setSubject] = useState("Sua agenda — Rodada de Negócios PromPerú");
  const [body, setBody] = useState(
    "Sua agenda pessoal está pronta.\n\nClique no botão abaixo para baixar o PDF com todos os seus horários confirmados.",
  );
  const [buttonLabel, setButtonLabel] = useState("Baixar minha agenda");
  const [testEmail, setTestEmail] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Events dropdown (staff/admin can see all).
  const { data: events } = useQuery({
    queryKey: ["agenda-campaigns-events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, name, created_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
  const effectiveEventId = eventId ?? events?.[0]?.id ?? null;

  // Preview.
  const previewQuery = useQuery({
    queryKey: ["agenda-campaign-preview", effectiveEventId, category],
    enabled: !!effectiveEventId,
    queryFn: () =>
      previewFn({ data: { eventId: effectiveEventId as string, category } }),
  });
  const total = previewQuery.data?.total ?? 0;

  // History.
  const historyQuery = useQuery({
    queryKey: ["agenda-campaigns-list", effectiveEventId],
    enabled: !!effectiveEventId,
    queryFn: () =>
      listCampaignsFn({ data: { eventId: effectiveEventId as string } }),
  });

  const sendTestMut = useMutation({
    mutationFn: async () => {
      if (!effectiveEventId) throw new Error("event_missing");
      if (!testEmail) throw new Error("test_email_missing");
      return sendTestFn({
        data: {
          eventId: effectiveEventId,
          category,
          subject,
          body_md: body,
          buttonLabel,
          testEmail,
        },
      });
    },
    onSuccess: (res: { ok: boolean }) => {
      if (res.ok) toast.success("E-mail de teste enviado.");
      else toast.error("Não foi possível enviar o e-mail de teste.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sendCampaignMut = useMutation({
    mutationFn: async () => {
      if (!effectiveEventId) throw new Error("event_missing");
      return sendCampaignFn({
        data: {
          eventId: effectiveEventId,
          category,
          subject,
          body_md: body,
          buttonLabel,
        },
      });
    },
    onSuccess: (res: { totals: { sent: number; failed: number; suppressed: number; eligible: number } }) => {
      toast.success(
        `Lote disparado: ${res.totals.sent} enviados, ${res.totals.failed} falhas, ${res.totals.suppressed} suprimidos (de ${res.totals.eligible} elegíveis).`,
      );
      setConfirmOpen(false);
      qc.invalidateQueries({ queryKey: ["agenda-campaigns-list"] });
      qc.invalidateQueries({ queryKey: ["agenda-campaign-preview"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <Card className="p-5 space-y-5">
        <div>
          <h2 className="text-lg font-semibold">Disparo de agendas</h2>
          <p className="text-sm text-muted-foreground">
            Envie o link da agenda individual para todos os perfis com agenda
            no evento selecionado. Categoria obrigatória — visitantes e
            expositores nunca são misturados no mesmo lote.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Categoria</Label>
            <RadioGroup
              value={category}
              onValueChange={(v) => setCategory(v as Category)}
              className="flex gap-6"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="visitor" id="cat-visitor" />
                <Label htmlFor="cat-visitor">Visitantes</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="exhibitor" id="cat-exhibitor" />
                <Label htmlFor="cat-exhibitor">Expositores</Label>
              </div>
            </RadioGroup>
          </div>
          <div className="space-y-2">
            <Label>Evento</Label>
            <Select
              value={effectiveEventId ?? undefined}
              onValueChange={(v) => setEventId(v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione o evento" />
              </SelectTrigger>
              <SelectContent>
                {(events ?? []).map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <EligiblePreview
          loading={previewQuery.isLoading}
          total={total}
          sample={previewQuery.data?.sample ?? []}
          onRefresh={() =>
            qc.invalidateQueries({ queryKey: ["agenda-campaign-preview"] })
          }
        />

        <div className="space-y-2">
          <Label>Assunto</Label>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Texto do e-mail</Label>
          <Textarea
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Texto simples. Deixe uma linha em branco entre parágrafos.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Label do botão</Label>
            <Input
              value={buttonLabel}
              onChange={(e) => setButtonLabel(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>E-mail de teste</Label>
            <Input
              type="email"
              placeholder="voce@empresa.com"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => sendTestMut.mutate()}
            disabled={sendTestMut.isPending || !testEmail || !effectiveEventId}
          >
            {sendTestMut.isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <TestTube className="mr-2 size-4" />
            )}
            Enviar teste
          </Button>
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={total === 0 || !effectiveEventId}
          >
            <Send className="mr-2 size-4" />
            Disparar lote ({total})
          </Button>
        </div>
      </Card>

      <CampaignsHistory
        campaigns={(historyQuery.data?.rows ?? []) as unknown as CampaignRow[]}
        liveTotals={historyQuery.data?.liveTotals ?? {}}
        loading={historyQuery.isLoading}
      />

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar disparo</DialogTitle>
            <DialogDescription>
              Enviar o e-mail para <strong>{total}</strong> destinatário(s) da
              categoria{" "}
              <strong>{category === "visitor" ? "Visitantes" : "Expositores"}</strong>?
              Perfis sem agenda individual não recebem. E-mails na lista de
              supressão são ignorados.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => sendCampaignMut.mutate()}
              disabled={sendCampaignMut.isPending}
            >
              {sendCampaignMut.isPending && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Confirmar disparo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EligiblePreview(props: {
  loading: boolean;
  total: number;
  sample: Array<{
    profileId: string;
    email: string;
    fullName: string;
    companyName: string;
    profileMeetingsCount: number;
  }>;
  onRefresh: () => void;
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm">
          <span className="font-medium">Elegíveis:</span>{" "}
          {props.loading ? "…" : props.total}
          <span className="ml-2 text-muted-foreground">
            (perfis com agenda individual nesta categoria)
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={props.onRefresh}
          disabled={props.loading}
        >
          <RefreshCw className="mr-1 size-3.5" /> Atualizar
        </Button>
      </div>
      {props.sample.length > 0 && (
        <div className="mt-3 max-h-56 overflow-auto rounded border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-2 text-left">Nome</th>
                <th className="p-2 text-left">Empresa</th>
                <th className="p-2 text-left">E-mail</th>
                <th className="p-2 text-right">Reuniões</th>
              </tr>
            </thead>
            <tbody>
              {props.sample.map((r) => (
                <tr key={r.profileId} className="border-t">
                  <td className="p-2">{r.fullName}</td>
                  <td className="p-2">{r.companyName}</td>
                  <td className="p-2">{r.email}</td>
                  <td className="p-2 text-right">{r.profileMeetingsCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!props.loading && props.total === 0 && (
        <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <AlertTriangle className="size-4" />
          Nenhum perfil elegível para esta categoria neste evento.
        </div>
      )}
    </div>
  );
}

type CampaignRow = {
  id: string;
  event_id: string;
  category: "visitor" | "exhibitor";
  subject: string;
  status: string;
  totals: Record<string, unknown> | null;
  created_at: string;
};

function CampaignsHistory(props: {
  campaigns: CampaignRow[];
  liveTotals: Record<
    string,
    { eligible: number; sent: number; failed: number; suppressed: number; clicked: number; downloaded: number }
  >;
  loading: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <Card className="p-5">
      <h3 className="text-base font-semibold">Histórico de disparos</h3>
      <p className="text-sm text-muted-foreground">
        Enviados, cliques e downloads são registrados separadamente. Clique
        é o acesso ao link; download é o PDF entregue com sucesso.
      </p>
      <div className="mt-3 space-y-2">
        {props.loading && (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        )}
        {!props.loading && props.campaigns.length === 0 && (
          <div className="text-sm text-muted-foreground">
            Nenhuma campanha ainda.
          </div>
        )}
        {props.campaigns.map((c) => {
          const t =
            props.liveTotals[c.id] ??
            {
              eligible: 0,
              sent: 0,
              failed: 0,
              suppressed: 0,
              clicked: 0,
              downloaded: 0,
            };
          const isOpen = expanded === c.id;
          return (
            <div key={c.id} className="rounded border">
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : c.id)}
                className="flex w-full items-center gap-3 p-3 text-left"
              >
                {isOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={c.category === "visitor" ? "default" : "secondary"}>
                      {c.category === "visitor" ? "Visitantes" : "Expositores"}
                    </Badge>
                    <span className="truncate font-medium">{c.subject}</span>
                    <Badge variant="outline">{c.status}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {new Date(c.created_at).toLocaleString("pt-BR")}
                  </div>
                </div>
                <div className="flex gap-3 text-xs">
                  <Kpi label="Eleg." value={t.eligible} />
                  <Kpi label="Env." value={t.sent} />
                  <Kpi label="Falh." value={t.failed} tone="danger" />
                  <Kpi label="Cliq." value={t.clicked} />
                  <Kpi label="Down." value={t.downloaded} tone="ok" />
                </div>
              </button>
              {isOpen && <CampaignDrillDown campaignId={c.id} />}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function Kpi(props: { label: string; value: number; tone?: "ok" | "danger" }) {
  const color =
    props.tone === "ok"
      ? "text-emerald-600"
      : props.tone === "danger"
        ? "text-red-600"
        : "text-foreground";
  return (
    <div className="text-right leading-tight">
      <div className={`font-semibold ${color}`}>{props.value}</div>
      <div className="text-[10px] uppercase text-muted-foreground">
        {props.label}
      </div>
    </div>
  );
}

function CampaignDrillDown(props: { campaignId: string }) {
  const getRecipients = useServerFn(getCampaignRecipients);
  const [status, setStatus] = useState<string>("");
  const [clicked, setClicked] = useState<string>("");
  const [downloaded, setDownloaded] = useState<string>("");
  const [email, setEmail] = useState<string>("");

  const filters = useMemo(
    () => ({
      send_status: (status || undefined) as
        | "pending"
        | "sent"
        | "suppressed"
        | "failed"
        | undefined,
      clicked: clicked === "" ? undefined : clicked === "true",
      downloaded: downloaded === "" ? undefined : downloaded === "true",
      email: email || undefined,
    }),
    [status, clicked, downloaded, email],
  );

  const { data, isLoading } = useQuery({
    queryKey: ["agenda-campaign-recipients", props.campaignId, filters],
    queryFn: () =>
      getRecipients({
        data: { campaignId: props.campaignId, filters },
      }),
  });

  return (
    <div className="border-t p-3 space-y-3">
      <div className="flex flex-wrap gap-2">
        <Select value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Status: todos</SelectItem>
            <SelectItem value="sent">Enviados</SelectItem>
            <SelectItem value="failed">Falhas</SelectItem>
            <SelectItem value="suppressed">Suprimidos</SelectItem>
            <SelectItem value="pending">Pendentes</SelectItem>
          </SelectContent>
        </Select>
        <Select value={clicked || "all"} onValueChange={(v) => setClicked(v === "all" ? "" : v)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Clicou" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Clicou: todos</SelectItem>
            <SelectItem value="true">Sim</SelectItem>
            <SelectItem value="false">Não</SelectItem>
          </SelectContent>
        </Select>
        <Select value={downloaded || "all"} onValueChange={(v) => setDownloaded(v === "all" ? "" : v)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Baixou" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Baixou: todos</SelectItem>
            <SelectItem value="true">Sim</SelectItem>
            <SelectItem value="false">Não</SelectItem>
          </SelectContent>
        </Select>
        <Input
          className="w-64"
          placeholder="Filtrar por e-mail"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando…</div>
      ) : (
        <div className="max-h-96 overflow-auto rounded border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-2 text-left">E-mail</th>
                <th className="p-2 text-left">Cat.</th>
                <th className="p-2 text-left">Status</th>
                <th className="p-2 text-left">Enviado</th>
                <th className="p-2 text-left">Clicou</th>
                <th className="p-2 text-left">Baixou</th>
              </tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).map((r: any) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{r.recipient_email}</td>
                  <td className="p-2">{r.role_category}</td>
                  <td className="p-2">
                    <Badge variant={r.send_status === "sent" ? "default" : r.send_status === "failed" ? "destructive" : "secondary"}>
                      {r.send_status}
                    </Badge>
                    {r.error_message && (
                      <div className="mt-1 text-xs text-red-600 truncate max-w-[240px]">
                        {r.error_message}
                      </div>
                    )}
                  </td>
                  <td className="p-2 text-xs">
                    {r.sent_at ? new Date(r.sent_at).toLocaleString("pt-BR") : "—"}
                  </td>
                  <td className="p-2 text-xs">
                    {r.clicked_at
                      ? `${new Date(r.clicked_at).toLocaleString("pt-BR")} (${r.click_count})`
                      : "—"}
                  </td>
                  <td className="p-2 text-xs">
                    {r.downloaded_at
                      ? `${new Date(r.downloaded_at).toLocaleString("pt-BR")} (${r.download_count})`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}