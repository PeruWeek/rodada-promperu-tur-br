import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/_authenticated/table-agenda")({
  component: () => (<div className="mx-auto max-w-6xl px-4 py-10"><h1 className="text-3xl font-bold">Agenda da Mesa</h1><p className="mt-2 text-muted-foreground">Em breve (Fase 3): agenda da mesa do expositor.</p></div>),
});