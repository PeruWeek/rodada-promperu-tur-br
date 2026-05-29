import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/_authenticated/admin")({
  component: () => (<div className="mx-auto max-w-6xl px-4 py-10"><h1 className="text-3xl font-bold">Admin</h1><p className="mt-2 text-muted-foreground">Em breve (Fase 5): gestão de mesas, check-in mobile e exports.</p></div>),
});