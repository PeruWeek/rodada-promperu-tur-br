import { supabase } from "@/integrations/supabase/client";

type EnsureOpts = {
  userId: string;
  email: string;
  fullName: string | null;
  alreadySentAt?: string | null | undefined;
};

/**
 * Idempotently dispatch the buyer welcome email.
 *
 * Safe to call from anywhere on the client where a buyer is known to have
 * completed signup. Short-circuits if `alreadySentAt` is present. Dedupe is
 * also enforced server-side via the deterministic idempotencyKey, so multiple
 * concurrent calls won't deliver duplicates. Never throws — failures only
 * console.warn.
 */
export async function ensureBuyerWelcomeEmail(opts: EnsureOpts): Promise<void> {
  if (opts.alreadySentAt) return;
  if (!opts.email) return;
  try {
    const { data: sess } = await supabase.auth.getSession();
    const accessToken = sess.session?.access_token;
    if (!accessToken) return;
    const firstName = (opts.fullName ?? "").trim().split(/\s+/)[0] ?? "";
    // Same-origin canonical URL — the server pipeline also injects the
    // white-label `siteUrl` default, but we pass a concrete `agendaUrl` so
    // the template renders the correct absolute link even when the site
    // is served under a preview host.
    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    const res = await fetch("/lovable/email/transactional/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        templateName: "buyer-welcome",
        recipientEmail: opts.email,
        idempotencyKey: `buyer-welcome-${opts.userId}`,
        templateData: {
          visitorName: firstName,
          agendaUrl: `${origin}/agenda`,
        },
      }),
    });
    if (!res.ok) {
      console.warn("[buyer-welcome] non-ok response", res.status);
      return;
    }
    try {
      await supabase.auth.updateUser({
        data: { welcome_email_sent_at: new Date().toISOString() },
      });
    } catch {
      /* metadata update is best-effort; idempotency key prevents dupes */
    }
  } catch (err) {
    console.warn("[buyer-welcome] failed", err);
  }
}