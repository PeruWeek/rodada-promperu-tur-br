import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type State =
  | { kind: "loading" }
  | { kind: "valid"; email: string }
  | { kind: "already" }
  | { kind: "invalid"; message: string }
  | { kind: "done" };

export const Route = createFileRoute("/unsubscribe")({
  validateSearch: (s: Record<string, unknown>) => ({
    token: typeof s.token === "string" ? s.token : "",
  }),
  component: UnsubscribePage,
});

function UnsubscribePage() {
  const { token } = Route.useSearch();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setState({ kind: "invalid", message: "Missing token." });
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `/email/unsubscribe?token=${encodeURIComponent(token)}`,
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setState({ kind: "invalid", message: data?.error ?? "Invalid token." });
          return;
        }
        if (data?.already_unsubscribed) {
          setState({ kind: "already" });
          return;
        }
        setState({ kind: "valid", email: data?.email ?? "" });
      } catch {
        setState({ kind: "invalid", message: "Could not validate token." });
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
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setState({ kind: "invalid", message: data?.error ?? "Failed to unsubscribe." });
        return;
      }
      setState({ kind: "done" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 text-center shadow-sm">
        <h1 className="text-2xl font-bold text-foreground">Cancelar inscrição</h1>
        <div className="mt-6 text-sm text-muted-foreground">
          {state.kind === "loading" && <p>Validando…</p>}
          {state.kind === "valid" && (
            <>
              <p>
                Deseja parar de receber e-mails {state.email ? `em ${state.email}` : ""}?
              </p>
              <Button
                className="mt-6 w-full"
                onClick={confirm}
                disabled={submitting}
              >
                {submitting ? "Processando…" : "Confirmar cancelamento"}
              </Button>
            </>
          )}
          {state.kind === "already" && <p>Você já está cancelado(a).</p>}
          {state.kind === "done" && (
            <p>Pronto. Você não receberá mais e-mails deste tipo.</p>
          )}
          {state.kind === "invalid" && (
            <p className="text-destructive">{state.message}</p>
          )}
        </div>
      </div>
    </main>
  );
}