import { Link } from "@tanstack/react-router";
import { DoorClosed } from "lucide-react";

import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";

export function SignupClosedPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-20 text-center">
        <div className="rounded-full bg-muted p-4">
          <DoorClosed size={28} />
        </div>
        <h1 className="mt-6 text-3xl font-bold">Inscrições encerradas</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          As inscrições para o evento estão encerradas no momento. Se você já possui cadastro,
          entre para consultar sua agenda.
        </p>
        <Button asChild size="lg" className="mt-8">
          <Link to="/login">Entrar</Link>
        </Button>
      </div>
    </div>
  );
}