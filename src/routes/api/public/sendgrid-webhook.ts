import { createFileRoute } from '@tanstack/react-router'
import { createPublicKey, createVerify } from 'node:crypto'
import { supabaseAdmin } from '@/integrations/supabase/client.server'

/**
 * SendGrid Event Webhook receiver.
 *
 * Verifies the ECDSA signature (when SENDGRID_WEBHOOK_PUBLIC_KEY is set)
 * and inserts bounce / dropped / spamreport / unsubscribe events into
 * suppressed_emails so future sends are blocked.
 *
 * Configure in SendGrid: Settings -> Mail Settings -> Event Webhook.
 *   HTTP Post URL: https://rodada.promperu.tur.br/api/public/sendgrid-webhook
 *   Events: Bounced, Dropped, Spam Reports, Unsubscribed, Group Unsubscribes
 *   Enable "Signed Event Webhook" and paste the generated Verification Key
 *   into the SENDGRID_WEBHOOK_PUBLIC_KEY secret.
 */

const SUPPRESSING_EVENTS = new Set([
  'bounce',
  'dropped',
  'spamreport',
  'unsubscribe',
  'group_unsubscribe',
])

function toPem(key: string): string {
  const trimmed = key.trim()
  if (trimmed.startsWith('-----BEGIN')) return trimmed
  const wrapped = trimmed.replace(/(.{64})/g, '$1\n')
  return `-----BEGIN PUBLIC KEY-----\n${wrapped}\n-----END PUBLIC KEY-----\n`
}

function verifySignature(rawBody: string, signature: string, timestamp: string): boolean {
  const pubKey = process.env.SENDGRID_WEBHOOK_PUBLIC_KEY
  if (!pubKey) {
    console.warn('[sendgrid-webhook] SENDGRID_WEBHOOK_PUBLIC_KEY not set — skipping signature check')
    return true
  }
  try {
    const keyObj = createPublicKey(toPem(pubKey))
    const verifier = createVerify('sha256')
    verifier.update(timestamp + rawBody)
    verifier.end()
    return verifier.verify(keyObj, Buffer.from(signature, 'base64'))
  } catch (err) {
    console.error('[sendgrid-webhook] signature verification error', err)
    return false
  }
}

type SendGridEvent = {
  email?: string
  event?: string
  reason?: string
  type?: string
  sg_message_id?: string
  timestamp?: number
  template_name?: string
  message_id?: string
}

export const Route = createFileRoute('/api/public/sendgrid-webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text()
        const signature = request.headers.get('x-twilio-email-event-webhook-signature') ?? ''
        const timestamp = request.headers.get('x-twilio-email-event-webhook-timestamp') ?? ''

        if (process.env.SENDGRID_WEBHOOK_PUBLIC_KEY) {
          if (!signature || !timestamp) {
            return new Response('Missing signature', { status: 401 })
          }
          if (!verifySignature(rawBody, signature, timestamp)) {
            return new Response('Invalid signature', { status: 401 })
          }
        }

        let events: SendGridEvent[]
        try {
          const parsed = JSON.parse(rawBody)
          events = Array.isArray(parsed) ? parsed : [parsed]
        } catch {
          return new Response('Invalid JSON', { status: 400 })
        }

        let suppressed = 0
        for (const ev of events) {
          if (!ev?.email || !ev.event) continue
          const eventName = ev.event.toLowerCase()
          if (!SUPPRESSING_EVENTS.has(eventName)) continue

          const reason =
            eventName === 'bounce' || eventName === 'dropped'
              ? 'bounce'
              : eventName === 'spamreport'
                ? 'complaint'
                : 'unsubscribe'

          const { error } = await supabaseAdmin
            .from('suppressed_emails')
            .upsert(
              {
                email: ev.email.toLowerCase(),
                reason,
                metadata: {
                  provider: 'sendgrid',
                  event: eventName,
                  sg_message_id: ev.sg_message_id ?? null,
                  template_name: ev.template_name ?? null,
                  detail: ev.reason ?? ev.type ?? null,
                  ts: ev.timestamp ?? null,
                },
              },
              { onConflict: 'email', ignoreDuplicates: false },
            )

          if (error) {
            console.error('[sendgrid-webhook] failed to upsert suppression', { error, email: ev.email })
          } else {
            suppressed += 1
          }
        }

        return Response.json({ received: events.length, suppressed })
      },
    },
  },
})
