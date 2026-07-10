import { useSiteContext } from "@/lib/site-context";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type Decision = "done" | "no_show";

type SurveyState = {
  overallRating: number | null;
  meetingsQuality: number | null;
  nextEditionInterest: "yes" | "maybe" | "no" | null;
  comments: string;
};

const MOCK_MEETINGS = [
  {
    meeting_id: "preview-1",
    counterpart_name: "Ana Souza",
    counterpart_company: "Andes Tours",
    table_number: 12,
    slot_start: "2026-07-08T13:00:00",
    slot_end: "2026-07-08T13:20:00",
  },
  {
    meeting_id: "preview-2",
    counterpart_name: "Carlos Ramírez",
    counterpart_company: "Machu Travel Perú",
    table_number: 7,
    slot_start: "2026-07-08T14:00:00",
    slot_end: "2026-07-08T14:20:00",
  },
];

function fmtSlot(s: string, e: string): string {
  const start = new Date(s).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const end = new Date(e).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${start}–${end}`;
}

export const Route = createFileRoute("/qa/preview")({
  head: () => ({
    meta: [
      { title: "Pesquisa pós-evento (preview)" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PreviewPage,
});

function PreviewPage() {
  const site = useSiteContext();
  const eventName = site.eventDisplayName || site.name;
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [survey, setSurvey] = useState<SurveyState>({
    overallRating: null,
    meetingsQuality: null,
    nextEditionInterest: null,
    comments: "",
  });
  const [submitted, setSubmitted] = useState(false);

  if (submitted) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <h1 className="text-lg font-semibold">Preview: respostas NÃO gravadas ✓</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Este é um envio de teste. Nenhum check-in, status de reunião ou resposta
          foi persistido.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <div className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
        <strong>Preview / teste.</strong> Este link é apenas para validar layout e
        navegação. Nenhum dado é gravado em <code>meeting_checkins</code> ou{" "}
        <code>meetings.status</code>.
      </div>

      <div>
        <h1 className="text-xl font-semibold">
          Obrigado por participar, (teste)!
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Confirme abaixo com quais empresas você realmente se reuniu no evento
          {eventName ? ` “${eventName}”` : ""}.
        </p>
      </div>

      <div className="space-y-3">
        {MOCK_MEETINGS.map((m) => {
          const current = decisions[m.meeting_id] ?? null;
          return (
            <Card key={m.meeting_id} className="p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">{m.counterpart_company}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.counterpart_name} · Mesa {m.table_number} ·{" "}
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
                      setDecisions((p) => ({ ...p, [m.meeting_id]: "no_show" }))
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

      <Card className="p-5 space-y-5">
        <div>
          <h2 className="text-base font-semibold">Pesquisa sobre o evento</h2>
          <p className="text-xs text-muted-foreground">Preview — nada é gravado.</p>
        </div>
        <div>
          <p className="text-sm font-medium">1. Nota geral do evento *</p>
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
        </div>
        <div>
          <p className="text-sm font-medium">2. Qualidade das reuniões realizadas *</p>
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
            3. Interesse em participar da próxima edição? *
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
            value={survey.comments}
            onChange={(e) => setSurvey((s) => ({ ...s, comments: e.target.value }))}
          />
        </div>
      </Card>

      <div className="flex justify-end">
        <Button
          onClick={() => {
            toast.success("Preview enviado (nada foi gravado).");
            setSubmitted(true);
          }}
        >
          Enviar respostas (preview)
        </Button>
      </div>
    </div>
  );
}
