import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getPostEventQAContext,
  submitPostEventQA,
} from "@/lib/postevent-qa.functions";

export const Route = createFileRoute("/qa/$token")({
  head: () => ({
    meta: [
      { title: "Q&A pós-evento — Rodada de Negócios PromPerú" },
      {
        name: "description",
        content:
          "Confirme com quais empresas você realmente se reuniu durante a Rodada de Negócios.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: QaPage,
  errorComponent: () => (
    <div className="mx-auto max-w-lg p-8 text-center">
      <h1 className="text-lg font-semibold">Não foi possível carregar o formulário</h1>
      <p className="text-sm text-muted-foreground">
        Tente novamente pelo link recebido por e-mail.
      </p>
    </div>
  ),
  notFoundComponent: () => (
    <div className="mx-auto max-w-lg p-8 text-center">
      <h1 className="text-lg font-semibold">Link inválido</h1>
    </div>
  ),
});

type Decision = "done" | "no_show";

type SurveyState = {
  overallRating: number | null;
  meetingsQuality: number | null;
  nextEditionInterest: "yes" | "maybe" | "no" | null;
  comments: string;
};

function fmtSlot(s: string | null, e: string | null): string {
  if (!s) return "—";
  const start = new Date(s);
  const end = e ? new Date(e) : null;
  const opts: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  };
  const a = start.toLocaleString("pt-BR", opts);
  const b = end
    ? end.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : "";
  return b ? `${a}–${b}` : a;
}

function QaPage() {
  const { token } = Route.useParams();
  const ctxFn = useServerFn(getPostEventQAContext);
  const submitFn = useServerFn(submitPostEventQA);
  const { data, isLoading } = useQuery({
    queryKey: ["postevent-qa-ctx", token],
    queryFn: () => ctxFn({ data: { token } }),
    retry: false,
  });

  const meetings = useMemo(
    () => (data?.ok ? data.meetings : []),
    [data],
  );
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [survey, setSurvey] = useState<SurveyState>({
    overallRating: null,
    meetingsQuality: null,
    nextEditionInterest: null,
    comments: "",
  });
  const [submitted, setSubmitted] = useState(false);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const payload = meetings
        .filter((m) => decisions[m.meeting_id])
        .map((m) => ({
          meetingId: m.meeting_id,
          decision: decisions[m.meeting_id]!,
        }));
      return submitFn({
        data: {
          token,
          decisions: payload,
          survey: {
            overallRating: survey.overallRating,
            meetingsQuality: survey.meetingsQuality,
            nextEditionInterest: survey.nextEditionInterest,
            comments: survey.comments.trim() || null,
          },
        },
      });
    },
    onSuccess: (res) => {
      toast.success(`Obrigado! ${res.recorded} respostas registradas.`);
      setSubmitted(true);
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao enviar"),
  });

  const missingMeeting = meetings.some((m) => !decisions[m.meeting_id]);
  const missingSurvey =
    survey.overallRating == null ||
    survey.meetingsQuality == null ||
    survey.nextEditionInterest == null;

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!data?.ok) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <h1 className="text-lg font-semibold">
          {data?.reason === "expired" ? "Link expirado" : "Link inválido"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Entre em contato com a organização se você precisa acessar o formulário.
        </p>
      </div>
    );
  }

  if (submitted || data.alreadySubmitted) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <h1 className="text-lg font-semibold">Respostas registradas ✓</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Obrigado por confirmar suas reuniões — isso alimenta o relatório do evento.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">
          Obrigado por participar, {data.participant.name || "participante"}!
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Confirme abaixo com quais empresas você realmente se reuniu no evento{" "}
          {data.event.name ? `“${data.event.name}”` : ""}.
        </p>
      </div>

      {meetings.length === 0 ? (
        <Card className="p-5 text-sm text-muted-foreground">
          Não encontramos reuniões agendadas para você neste evento.
        </Card>
      ) : (
        <div className="space-y-3">
          {meetings.map((m) => {
            const current = decisions[m.meeting_id] ?? null;
            return (
              <Card key={m.meeting_id} className="p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium">{m.counterpart_company}</p>
                    <p className="text-xs text-muted-foreground">
                      {m.counterpart_name}
                      {m.table_number ? ` · Mesa ${m.table_number}` : ""} ·{" "}
                      {fmtSlot(m.slot_start, m.slot_end)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={current === "done" ? "default" : "outline"}
                      onClick={() =>
                        setDecisions((p) => ({ ...p, [m.meeting_id]: "done" }))
                      }
                    >
                      Realizada
                    </Button>
                    <Button
                      size="sm"
                      variant={current === "no_show" ? "destructive" : "outline"}
                      onClick={() =>
                        setDecisions((p) => ({
                          ...p,
                          [m.meeting_id]: "no_show",
                        }))
                      }
                    >
                      Não aconteceu
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="p-5 space-y-5">
        <div>
          <h2 className="text-base font-semibold">Pesquisa sobre o evento</h2>
          <p className="text-xs text-muted-foreground">
            Suas respostas ajudam a melhorar a próxima edição.
          </p>
        </div>

        <div>
          <p className="text-sm font-medium">
            1. Nota geral do evento <span className="text-destructive">*</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <Button
                key={n}
                size="sm"
                variant={survey.overallRating === n ? "default" : "outline"}
                onClick={() => setSurvey((s) => ({ ...s, overallRating: n }))}
              >
                {n}
              </Button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">1 = ruim · 5 = excelente</p>
        </div>

        <div>
          <p className="text-sm font-medium">
            2. Qualidade das reuniões realizadas <span className="text-destructive">*</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <Button
                key={n}
                size="sm"
                variant={survey.meetingsQuality === n ? "default" : "outline"}
                onClick={() => setSurvey((s) => ({ ...s, meetingsQuality: n }))}
              >
                {n}
              </Button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium">
            3. Você teria interesse em participar da próxima edição?{" "}
            <span className="text-destructive">*</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {[
              { v: "yes", label: "Sim" },
              { v: "maybe", label: "Talvez" },
              { v: "no", label: "Não" },
            ].map((o) => (
              <Button
                key={o.v}
                size="sm"
                variant={survey.nextEditionInterest === o.v ? "default" : "outline"}
                onClick={() =>
                  setSurvey((s) => ({
                    ...s,
                    nextEditionInterest: o.v as SurveyState["nextEditionInterest"],
                  }))
                }
              >
                {o.label}
              </Button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium">4. Comentários (opcional)</p>
          <textarea
            className="mt-2 w-full rounded-md border bg-background p-2 text-sm"
            rows={3}
            maxLength={2000}
            value={survey.comments}
            onChange={(e) => setSurvey((s) => ({ ...s, comments: e.target.value }))}
            placeholder="Sugestões, elogios, o que podemos melhorar…"
          />
        </div>
      </Card>

      <div className="flex justify-end">
        <Button
          disabled={
            submitMutation.isPending ||
            (meetings.length > 0 && missingMeeting) ||
            missingSurvey
          }
          onClick={() => submitMutation.mutate()}
        >
          Enviar respostas
        </Button>
      </div>
      {(missingMeeting || missingSurvey) && (
        <p className="text-right text-xs text-muted-foreground">
          {missingMeeting
            ? "Responda todas as reuniões e a pesquisa para enviar."
            : "Responda as 3 perguntas obrigatórias da pesquisa para enviar."}
        </p>
      )}
    </div>
  );
}