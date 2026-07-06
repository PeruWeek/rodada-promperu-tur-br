import { createFileRoute } from "@tanstack/react-router";

function hexToBytes(hex: string): Uint8Array | null {
  const clean = hex.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(clean) || clean.length % 2 !== 0) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

async function sha256Bytes(input: Uint8Array): Promise<Uint8Array> {
  const view = new Uint8Array(input.byteLength);
  view.set(input);
  const buf = await crypto.subtle.digest("SHA-256", view.buffer as ArrayBuffer);
  return new Uint8Array(buf);
}

function toHexHash(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function getClientIp(request: Request): string | null {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("cf-connecting-ip") ?? null;
}

/**
 * Public tracked download endpoint for the admin "Disparo de agendas" flow.
 *
 * Contract:
 *   1. Locate the recipient row by (campaign_id, sha256(token)).
 *   2. Register the CLICK event first (isolated UPDATE, before PDF work).
 *   3. Only if the PDF renders successfully, register the DOWNLOAD event
 *      (separate isolated UPDATE).
 *   4. Return the PDF as `application/pdf; attachment`.
 *
 * Any validation failure returns a generic 404 with no data leakage.
 */
export const Route = createFileRoute("/api/public/agenda-download/$campaignId/$token")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const notFound = () => new Response("Not found", { status: 404 });
        const { campaignId, token } = params;
        if (!isUuid(campaignId)) return notFound();
        const tokenBytes = hexToBytes(token);
        if (!tokenBytes || tokenBytes.length !== 32) return notFound();

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        const tokenHash = await sha256Bytes(tokenBytes);
        // Supabase-js encodes `bytea` filter values as `\x<hex>` literals.
        const bytesLiteral = `\\x${toHexHash(tokenHash)}`;

        const { data: recipient, error: recErr } = await supabaseAdmin
          .from("agenda_email_campaign_recipients")
          .select("id, event_id, profile_id, campaign_id")
          .eq("campaign_id", campaignId)
          .eq("token_hash", bytesLiteral as unknown as never)
          .maybeSingle();
        if (recErr || !recipient) return notFound();

        const ip = getClientIp(request);
        const ua = request.headers.get("user-agent") ?? "";

        // 1) CLICK — isolated UPDATE, BEFORE the PDF is generated.
        {
          const { data: current } = await supabaseAdmin
            .from("agenda_email_campaign_recipients")
            .select("click_count, clicked_at, first_click_ip, metadata")
            .eq("id", recipient.id)
            .single();
          const nextMeta = {
            ...((current?.metadata as Record<string, unknown> | null) ?? {}),
            last_ua: ua.slice(0, 500),
          };
          await supabaseAdmin
            .from("agenda_email_campaign_recipients")
            .update({
              clicked_at: current?.clicked_at ?? new Date().toISOString(),
              click_count: (current?.click_count ?? 0) + 1,
              first_click_ip: current?.first_click_ip ?? ip,
              metadata: nextMeta,
            } as never)
            .eq("id", recipient.id);
        }

        // 2) Generate PDF.
        let pdf: { bytes: Uint8Array; profileName: string } | null = null;
        try {
          const { renderAgendaPdfFor } = await import(
            "@/lib/agenda-campaigns.server"
          );
          pdf = await renderAgendaPdfFor({
            eventId: recipient.event_id as string,
            profileId: recipient.profile_id as string,
          });
        } catch (err) {
          console.error("[agenda-download] pdf render failed", err);
          return notFound();
        }
        if (!pdf) return notFound();

        // 3) DOWNLOAD — isolated UPDATE, AFTER a successful PDF render.
        {
          const { data: current } = await supabaseAdmin
            .from("agenda_email_campaign_recipients")
            .select("download_count, downloaded_at")
            .eq("id", recipient.id)
            .single();
          await supabaseAdmin
            .from("agenda_email_campaign_recipients")
            .update({
              downloaded_at: current?.downloaded_at ?? new Date().toISOString(),
              download_count: (current?.download_count ?? 0) + 1,
            } as never)
            .eq("id", recipient.id);
        }

        const filename = `agenda-${(pdf.profileName || "participante")
          .replace(/[^a-z0-9-_]+/gi, "_")
          .slice(0, 60)
          .toLowerCase()}.pdf`;

        return new Response(pdf.bytes as unknown as BodyInit, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Cache-Control": "private, no-store",
          },
        });
      },
    },
  },
});