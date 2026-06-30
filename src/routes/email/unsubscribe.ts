import { createClient } from '@supabase/supabase-js'
import { createFileRoute } from '@tanstack/react-router'

function redactEmail(email: string | null | undefined): string {
  if (!email) return '***'
  const [localPart, domain] = email.split('@')
  if (!localPart || !domain) return '***'
  return `${localPart[0]}***@${domain}`
}

function redactToken(token: string | null | undefined): string {
  if (!token) return '***'
  if (token.length <= 8) return '***'
  return `${token.slice(0, 4)}…${token.slice(-4)} (len=${token.length})`
}

// Tokens are 64-char lowercase hex (see generateToken in email-send.server.ts).
// We accept any non-empty hex-ish string of plausible length to avoid false
// negatives if generation ever changes, but reject obvious junk early.
const TOKEN_SHAPE = /^[a-zA-Z0-9_-]{16,256}$/

type FailureReason =
  | 'missing_token'
  | 'malformed_token'
  | 'expired_or_invalid_token'
  | 'already_consumed'
  | 'lookup_failed'
  | 'suppress_failed'
  | 'config_error'

function failure(reason: FailureReason, status: number) {
  return Response.json({ ok: false, reason }, { status })
}

export const Route = createFileRoute("/email/unsubscribe")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

        if (!supabaseUrl || !supabaseServiceKey) {
          console.error('[unsubscribe.GET] missing server config')
          return failure('config_error', 500)
        }

        const url = new URL(request.url)
        const token = url.searchParams.get('token')

        if (!token) {
          console.warn('[unsubscribe.GET] missing_token')
          return failure('missing_token', 400)
        }
        if (!TOKEN_SHAPE.test(token)) {
          console.warn('[unsubscribe.GET] malformed_token', { token_preview: redactToken(token) })
          return failure('malformed_token', 400)
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey)

        const { data: tokenRecord, error: lookupError } = await supabase
          .from('email_unsubscribe_tokens')
          .select('email, used_at')
          .eq('token', token)
          .maybeSingle()

        if (lookupError) {
          console.error('[unsubscribe.GET] lookup_failed', {
            token_preview: redactToken(token),
            error: lookupError.message,
          })
          return failure('lookup_failed', 500)
        }
        if (!tokenRecord) {
          console.warn('[unsubscribe.GET] expired_or_invalid_token', {
            token_preview: redactToken(token),
          })
          return failure('expired_or_invalid_token', 404)
        }

        if (tokenRecord.used_at) {
          console.log('[unsubscribe.GET] already_consumed', {
            email_redacted: redactEmail(tokenRecord.email),
          })
          return Response.json({
            ok: true,
            status: 'already_unsubscribed',
            email_masked: redactEmail(tokenRecord.email),
          })
        }

        console.log('[unsubscribe.GET] validated', {
          email_redacted: redactEmail(tokenRecord.email),
        })
        return Response.json({
          ok: true,
          status: 'valid',
          email_masked: redactEmail(tokenRecord.email),
        })
      },

      POST: async ({ request }) => {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

        if (!supabaseUrl || !supabaseServiceKey) {
          console.error('[unsubscribe.POST] missing server config')
          return failure('config_error', 500)
        }

        const url = new URL(request.url)
        let token: string | null = url.searchParams.get('token')

        // Detect RFC 8058 one-click unsubscribe: POST with form-encoded body
        // containing "List-Unsubscribe=One-Click". Email clients (Gmail, Apple Mail,
        // etc.) send this when the user clicks "Unsubscribe" in the mail UI.
        const contentType = request.headers.get('content-type') ?? ''
        if (contentType.includes('application/x-www-form-urlencoded')) {
          const formText = await request.text()
          const params = new URLSearchParams(formText)
          // For one-click, token comes from query param (already set above).
          // Otherwise, token may be in the form body.
          if (!params.get('List-Unsubscribe')) {
            const formToken = params.get('token')
            if (formToken) {
              token = formToken
            }
          }
        } else {
          // JSON body (from the app's unsubscribe page)
          try {
            const body = await request.json()
            if (body.token) {
              token = body.token
            }
          } catch {
            // Fall through — token stays from query param
          }
        }

        if (!token) {
          console.warn('[unsubscribe.POST] missing_token')
          return failure('missing_token', 400)
        }
        if (!TOKEN_SHAPE.test(token)) {
          console.warn('[unsubscribe.POST] malformed_token', { token_preview: redactToken(token) })
          return failure('malformed_token', 400)
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey)

        const { data: tokenRecord, error: lookupError } = await supabase
          .from('email_unsubscribe_tokens')
          .select('email, used_at')
          .eq('token', token)
          .maybeSingle()

        if (lookupError) {
          console.error('[unsubscribe.POST] lookup_failed', {
            token_preview: redactToken(token),
            error: lookupError.message,
          })
          return failure('lookup_failed', 500)
        }
        if (!tokenRecord) {
          console.warn('[unsubscribe.POST] expired_or_invalid_token', {
            token_preview: redactToken(token),
          })
          return failure('expired_or_invalid_token', 404)
        }

        if (tokenRecord.used_at) {
          console.log('[unsubscribe.POST] already_consumed', {
            email_redacted: redactEmail(tokenRecord.email),
          })
          return Response.json({
            ok: true,
            status: 'already_unsubscribed',
            email_masked: redactEmail(tokenRecord.email),
          })
        }

        // Atomic check-and-update to avoid TOCTOU race
        const { data: updated, error: updateError } = await supabase
          .from('email_unsubscribe_tokens')
          .update({ used_at: new Date().toISOString() })
          .eq('token', token)
          .is('used_at', null)
          .select()
          .maybeSingle()

        if (updateError) {
          console.error('[unsubscribe.POST] unsubscribe_failed (update)', {
            token_preview: redactToken(token),
            error: updateError.message,
          })
          return failure('suppress_failed', 500)
        }

        if (!updated) {
          console.log('[unsubscribe.POST] already_consumed (race)', {
            email_redacted: redactEmail(tokenRecord.email),
          })
          return Response.json({
            ok: true,
            status: 'already_unsubscribed',
            email_masked: redactEmail(tokenRecord.email),
          })
        }

        // Add email to suppressed list (upsert to handle duplicates)
        const { error: suppressError } = await supabase
          .from('suppressed_emails')
          .upsert(
            { email: tokenRecord.email.toLowerCase(), reason: 'unsubscribe' },
            { onConflict: 'email' },
          )

        if (suppressError) {
          console.error('[unsubscribe.POST] suppress_failed', {
            email_redacted: redactEmail(tokenRecord.email),
            error: suppressError.message,
          })
          return failure('suppress_failed', 500)
        }

        console.log('[unsubscribe.POST] succeeded', {
          email_redacted: redactEmail(tokenRecord.email),
        })

        return Response.json({
          ok: true,
          status: 'unsubscribed',
          email_masked: redactEmail(tokenRecord.email),
        })
      },
    },
  },
})
