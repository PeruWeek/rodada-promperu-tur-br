import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const ok = (data ?? []).some((r) => r.role === "admin");
  if (!ok) throw new Error("Forbidden: admin only");
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

export const resendBuyerWelcome = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        userId: z.string().uuid(),
        force: z.boolean().optional(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: userRes, error: userErr } =
      await supabaseAdmin.auth.admin.getUserById(data.userId);
    if (userErr || !userRes?.user) {
      throw new Error(userErr?.message ?? "User not found");
    }
    const targetUser = userRes.user;
    const targetEmail = targetUser.email;
    if (!targetEmail) throw new Error("Target user has no email");

    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("auth_user_id", data.userId)
      .maybeSingle();
    const fullName = (prof?.full_name as string | undefined) ?? "";
    const firstName = fullName.trim().split(/\s+/)[0] ?? "";

    const idempotencyKey = data.force
      ? `buyer-welcome-${data.userId}-${Date.now()}`
      : `buyer-welcome-${data.userId}`;

    // Call the send pipeline directly (avoids worker loopback HTTP fetch,
    // which can drop the Authorization header and yield spurious 401s).
    const { processTransactionalSend } = await import("@/lib/email-send.server");
    const { siteUrl } = await import("@/lib/site-context.server");
    const result = await processTransactionalSend(supabaseAdmin, {
      templateName: "buyer-welcome",
      recipientEmail: targetEmail,
      idempotencyKey,
      templateData: {
        visitorName: firstName,
        agendaUrl: await siteUrl("/agenda"),
      },
    });

    if (result.status < 200 || result.status >= 300) {
      return { ok: false as const, status: result.status, body: result.body };
    }

    try {
      const meta = (targetUser.user_metadata ?? {}) as Record<string, unknown>;
      await supabaseAdmin.auth.admin.updateUserById(data.userId, {
        user_metadata: {
          ...meta,
          welcome_email_sent_at: new Date().toISOString(),
        },
      });
    } catch {
      /* best-effort */
    }

    return { ok: true as const, status: result.status, body: result.body };
  });
