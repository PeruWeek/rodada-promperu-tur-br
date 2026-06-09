import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const ok = (data ?? []).some((r) => r.role === "admin" || r.role === "staff");
  if (!ok) throw new Error("Forbidden");
}

export const sendTestTransactionalEmail = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        recipientEmail: z.string().trim().toLowerCase().email(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);

    const request = getRequest();
    const authHeader = request?.headers.get("authorization");
    if (!authHeader || !request) {
      throw new Error("Missing request context");
    }
    const origin = new URL(request.url).origin;

    const payload = {
      templateName: "meeting-confirmation",
      recipientEmail: data.recipientEmail,
      idempotencyKey: `test-${Date.now()}`,
      templateData: {
        language: "pt-BR",
        visitorName: "Teste Comprador",
        exhibitorCompany: "Teste Expositor",
        tableNumber: 1,
        slotStart: new Date(Date.now() + 86400000).toISOString(),
        slotEnd: new Date(Date.now() + 86400000 + 30 * 60 * 1000).toISOString(),
        agendaUrl: `${origin}/agenda`,
      },
    };

    const res = await fetch(`${origin}/lovable/email/transactional/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(payload),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false as const, status: res.status, body };
    }
    return { ok: true as const, status: res.status, body };
  });
