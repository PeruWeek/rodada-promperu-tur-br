import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useSiteContext } from "@/lib/site-context";

type FailureReason =
  | "missing_token"
  | "malformed_token"
  | "expired_or_invalid_token"
  | "lookup_failed"
  | "suppress_failed"
  | "config_error"
  | "network_error";

type State =
  | { kind: "loading" }
  | { kind: "valid"; emailMasked: string }
  | { kind: "already"; emailMasked: string }
  | { kind: "done"; emailMasked: string }
  | { kind: "failure"; reason: FailureReason };

const FAILURE_COPY: Record<
  FailureReason,
  { title: string; description: string; hint: string }
> = {
  missing_token: {
    title: "Link incompleto",
    description:
      "O link de cancelamento veio sem o código de identificação. Isso pode acontecer quando o link é copiado pela metade ou aberto direto pelo navegador.",
    hint: "Abra o link diretamente do e-mail mais recente que você recebeu, ou fale com a gente para concluir o cancelamento.",
  },
  malformed_token: {
    title: "Link inválido",
    description:
      "O código deste link não tem o formato esperado. Provavelmente ele foi cortado ou alterado durante o envio.",
    hint: "Abra o link diretamente do e-mail mais recente que você recebeu, ou fale com a gente para concluir o cancelamento.",
  },
  expired_or_invalid_token: {
    title: "Link expirado ou já utilizado",
    description:
      "Não encontramos esse pedido de cancelamento. O link pode ter sido substituído por outro mais recente, ou já ter sido usado.",
    hint: "Verifique o e-mail mais recente que você recebeu e use o link de cancelamento mais novo. Se preferir, podemos remover seu endereço diretamente.",
  },
  lookup_failed: {
    title: "Não conseguimos validar agora",
    description:
      "Tivemos um problema temporário para confirmar seu pedido. Não foi você — foi do nosso lado.",
    hint: "Tente novamente em alguns minutos. Se persistir, fale com a gente que removemos manualmente.",
  },
  suppress_failed: {
    title: "Não conseguimos concluir agora",
    description:
      "Validamos seu pedido, mas houve uma falha temporária ao registrar o cancelamento.",
    hint: "Tente novamente em alguns minutos. Se persistir, fale com a gente que finalizamos manualmente.",
  },
  config_error: {
    title: "Indisponível no momento",
    description:
      "Nosso sistema de cancelamento está temporariamente fora do ar.",
    hint: "Tente novamente em alguns minutos. Se preferir, fale com a gente que removemos manualmente.",
  },
  network_error: {
    title: "Sem conexão",
    description:
      "Não conseguimos falar com o servidor para validar seu pedido.",
    hint: "Verifique sua conexão e tente novamente. Se preferir, fale com a gente.",
  },
};

function track(event: string, data?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  // Microsoft Clarity custom event (no PII).
  try {
    (window as any).clarity?.("event", event);
    if (data) (window as any).clarity?.("set", event, JSON.stringify(data));
  } catch {
    /* noop */
  }
}

export const Route = createFileRoute("/unsubscribe")({
  validateSearch: (s: Record<string, unknown>) => ({
    token: typeof s.token === "string" ? s.token : "",
  }),
  component: UnsubscribePage,
});

function UnsubscribePage() {
  const { token } = Route.useSearch();
  const site = useSiteContext();
  const siteName = site.eventDisplayName || site.name;
  const SUPPORT_EMAIL =
    site.emailReplyTo || site.emailFromAddress || "";
  const [state, setState] = useState<State>({ kind: "loading" });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    track("unsubscribe_page_opened");
    if (!token) {
      track("unsubscribe_failed", { reason: "missing_token" });
      setState({ kind: "failure", reason: "missing_token" });
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `/email/unsubscribe?token=${encodeURIComponent(token)}`,
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data?.ok === false) {
          const reason = (data?.reason as FailureReason) ?? "lookup_failed";
          track("unsubscribe_failed", { reason, step: "validate" });
          setState({ kind: "failure", reason });
          return;
        }
        const emailMasked = data?.email_masked ?? "";
        if (data?.status === "already_unsubscribed") {
          track("unsubscribe_validated", { status: "already" });
          setState({ kind: "already", emailMasked });
          return;
        }
        track("unsubscribe_validated", { status: "valid" });
        setState({ kind: "valid", emailMasked });
      } catch {
        track("unsubscribe_failed", { reason: "network_error" });
        setState({ kind: "failure", reason: "network_error" });
      }
    })();
  }, [token]);

  const confirm = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/email/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        const reason = (data?.reason as FailureReason) ?? "suppress_failed";
        track("unsubscribe_failed", { reason, step: "confirm" });
        setState({ kind: "failure", reason });
        return;
      }
      const emailMasked = data?.email_masked ?? "";
      if (data?.status === "already_unsubscribed") {
        track("unsubscribe_succeeded", { status: "already" });
        setState({ kind: "already", emailMasked });
        return;
      }
      track("unsubscribe_succeeded", { status: "unsubscribed" });
      setState({ kind: "done", emailMasked });
    } catch {
      track("unsubscribe_failed", { reason: "network_error", step: "confirm" });
      setState({ kind: "failure", reason: "network_error" });
    } finally {
      setSubmitting(false);
    }
  };

  const supportHref = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    "Cancelar inscrição da lista de e-mails",
  )}&body=${encodeURIComponent(
    `Olá, gostaria de cancelar minha inscrição da lista de e-mails de ${siteName}. Meu e-mail cadastrado é: `,
  )}`;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 shadow-sm">
        <h1 className="text-center text-2xl font-bold text-foreground">
          Cancelar inscrição
        </h1>
        <div className="mt-6 text-sm text-muted-foreground">
          {state.kind === "loading" && (
            <p className="text-center">Validando seu link…</p>
          )}

          {state.kind === "valid" && (
            <div className="space-y-4 text-center">
              <p>
                Deseja parar de receber e-mails de {siteName}
                {state.emailMasked ? (
                  <>
                    {" "}no endereço{" "}
                    <span className="font-medium text-foreground">
                      {state.emailMasked}
                    </span>
                  </>
                ) : null}
                ?
              </p>
              <Button
                className="w-full"
                onClick={confirm}
                disabled={submitting}
              >
                {submitting ? "Processando…" : "Confirmar cancelamento"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Você pode reativar a qualquer momento falando com a gente em{" "}
                <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">
                  {SUPPORT_EMAIL}
                </a>
                .
              </p>
            </div>
          )}

          {state.kind === "already" && (
            <div className="space-y-3 text-center">
              <p className="text-base font-medium text-foreground">
                Você já está descadastrado(a).
              </p>
              <p>
                O endereço{" "}
                {state.emailMasked ? (
                  <span className="font-medium text-foreground">
                    {state.emailMasked}
                  </span>
                ) : (
                  "informado"
                )}{" "}
                não receberá mais e-mails de {siteName}.
              </p>
            </div>
          )}

          {state.kind === "done" && (
            <div className="space-y-3 text-center">
              <p className="text-base font-medium text-foreground">
                Cancelamento confirmado.
              </p>
              <p>
                Removemos{" "}
                {state.emailMasked ? (
                  <span className="font-medium text-foreground">
                    {state.emailMasked}
                  </span>
                ) : (
                  "seu endereço"
                )}{" "}
                da lista de e-mails de {siteName}. Você não
                receberá mais comunicações desta lista.
              </p>
            </div>
          )}

          {state.kind === "failure" && (
            <div className="space-y-4">
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-center">
                <p className="text-base font-semibold text-destructive">
                  {FAILURE_COPY[state.reason].title}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {FAILURE_COPY[state.reason].description}
                </p>
              </div>
              <p className="text-center text-sm">
                {FAILURE_COPY[state.reason].hint}
              </p>
              <div className="flex flex-col gap-2">
                {(state.reason === "lookup_failed" ||
                  state.reason === "suppress_failed" ||
                  state.reason === "network_error" ||
                  state.reason === "config_error") && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      if (typeof window !== "undefined") window.location.reload();
                    }}
                  >
                    Tentar novamente
                  </Button>
                )}
                <a
                  href={supportHref}
                  className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Falar com a gente para cancelar
                </a>
              </div>
              <p className="text-center text-xs text-muted-foreground">
                Atendimento: {SUPPORT_EMAIL}
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}