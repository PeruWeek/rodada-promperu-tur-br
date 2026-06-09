import * as React from 'react'
import { render } from '@react-email/components'
import { createClient } from '@supabase/supabase-js'
import { createFileRoute } from '@tanstack/react-router'
import { TEMPLATES } from '@/lib/email-templates/registry'
import { resolveTemplateOverrides } from '@/lib/email-templates/overrides.server'

// SendGrid sender (verified Single Sender / Authenticated Domain).
const FROM_EMAIL = 'rodada@promperu.tur.br'
const FROM_NAME = 'Rodada de Negócios PromPerú'
const REPLY_TO_EMAIL = 'rodada@promperu.tur.br'
// Public site URL used for unsubscribe link in email footer.
const SITE_URL = 'https://rodada.promperu.tur.br'

function redactEmail(email: string | null | undefined): string {
  if (!email) return '***'
  const [localPart, domain] = email.split('@')
  if (!localPart || !domain) return '***'
  return `${localPart[0]}***@${domain}`
}

function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function buildUnsubscribeUrl(token: string) {
  return `${SITE_URL}/unsubscribe?token=${encodeURIComponent(token)}`
}

function appendUnsubscribeFooter(html: string, text: string, unsubscribeUrl: string) {
  const htmlFooter = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;border-top:1px solid #e5e7eb;padding-top:16px;font-family:Arial,sans-serif;font-size:12px;color:#6b7280;text-align:center;"><tr><td>Você está recebendo este e-mail porque participa da Rodada de Negócios PromPerú.<br/><a href="${unsubscribeUrl}" style="color:#6b7280;text-decoration:underline;">Cancelar inscrição</a></td></tr></table>`
  const htmlOut = html.includes('</body>')
    ? html.replace('</body>', `${htmlFooter}</body>`)
    : html + htmlFooter
  const textOut = `${text}\n\n---\nCancelar inscrição: ${unsubscribeUrl}\n`
  return { html: htmlOut, text: textOut }
}

async function sendViaSendGrid(payload: {
  to: string
  subject: string
  html: string
  text: string
  unsubscribeUrl: string
  templateName: string
  messageId: string
  fromName?: string
}): Promise<{ ok: true; sgMessageId: string | null } | { ok: false; status: number; error: string }> {
  const apiKey = process.env.SENDGRID_API_KEY
  if (!apiKey) {
    return { ok: false, status: 500, error: 'SENDGRID_API_KEY not configured' }
  }
  const fromName = payload.fromName?.trim() || FROM_NAME
  const body = {
    personalizations: [{ to: [{ email: payload.to }], subject: payload.subject }],
    from: { email: FROM_EMAIL, name: fromName },
    reply_to: { email: REPLY_TO_EMAIL, name: fromName },
    content: [
      { type: 'text/plain', value: payload.text },
      { type: 'text/html', value: payload.html },
    ],
    headers: {
      'List-Unsubscribe': `<${payload.unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    categories: [payload.templateName],
    custom_args: {
      template_name: payload.templateName,
      message_id: payload.messageId,
    },
    tracking_settings: {
      click_tracking: { enable: false, enable_text: false },
      open_tracking: { enable: false },
      subscription_tracking: { enable: false },
    },
    mail_settings: { sandbox_mode: { enable: false } },
  }
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (res.status === 202) {
    return { ok: true, sgMessageId: res.headers.get('x-message-id') }
  }
  const errBody = await res.text().catch(() => '')
  return { ok: false, status: res.status, error: errBody.slice(0, 500) }
}

export const Route = createFileRoute('/lovable/email/transactional/send')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

        if (!supabaseUrl || !supabaseServiceKey) {
          console.error('Missing required environment variables')
          return Response.json({ error: 'Server configuration error' }, { status: 500 })
        }

        const authHeader = request.headers.get('Authorization')
        if (!authHeader?.startsWith('Bearer ')) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const token = authHeader.slice('Bearer '.length).trim()
        const supabase = createClient(supabaseUrl, supabaseServiceKey)
        const { data: { user }, error: authError } = await supabase.auth.getUser(token)
        if (authError || !user) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        let templateName: string
        let recipientEmail: string
        let idempotencyKey: string
        let messageId: string
        let templateData: Record<string, any> = {}
        try {
          const body = await request.json()
          templateName = body.templateName || body.template_name
          recipientEmail = body.recipientEmail || body.recipient_email
          messageId = crypto.randomUUID()
          idempotencyKey = body.idempotencyKey || body.idempotency_key || messageId
          if (body.templateData && typeof body.templateData === 'object') {
            templateData = body.templateData
          }
        } catch {
          return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 })
        }

        if (!templateName) {
          return Response.json({ error: 'templateName is required' }, { status: 400 })
        }

        const template = TEMPLATES[templateName]
        if (!template) {
          return Response.json(
            { error: `Template '${templateName}' not found. Available: ${Object.keys(TEMPLATES).join(', ')}` },
            { status: 404 },
          )
        }

        const effectiveRecipient = template.to || recipientEmail
        if (!effectiveRecipient) {
          return Response.json(
            { error: 'recipientEmail is required (unless the template defines a fixed recipient)' },
            { status: 400 },
          )
        }

        const { data: suppressed, error: suppressionError } = await supabase
          .from('suppressed_emails')
          .select('id')
          .eq('email', effectiveRecipient.toLowerCase())
          .maybeSingle()

        if (suppressionError) {
          console.error('Suppression check failed', { error: suppressionError })
          return Response.json({ error: 'Failed to verify suppression status' }, { status: 500 })
        }

        if (suppressed) {
          await supabase.from('email_send_log').insert({
            message_id: messageId,
            template_name: templateName,
            recipient_email: effectiveRecipient,
            status: 'suppressed',
          })
          return Response.json({ success: false, reason: 'email_suppressed' })
        }

        // Get or create unsubscribe token
        const normalizedEmail = effectiveRecipient.toLowerCase()
        let unsubscribeToken: string
        const { data: existingToken, error: tokenLookupError } = await supabase
          .from('email_unsubscribe_tokens')
          .select('token, used_at')
          .eq('email', normalizedEmail)
          .maybeSingle()

        if (tokenLookupError) {
          await supabase.from('email_send_log').insert({
            message_id: messageId,
            template_name: templateName,
            recipient_email: effectiveRecipient,
            status: 'failed',
            error_message: 'Failed to look up unsubscribe token',
          })
          return Response.json({ error: 'Failed to prepare email' }, { status: 500 })
        }

        if (existingToken && !existingToken.used_at) {
          unsubscribeToken = existingToken.token
        } else if (!existingToken) {
          unsubscribeToken = generateToken()
          const { error: tokenError } = await supabase
            .from('email_unsubscribe_tokens')
            .upsert(
              { token: unsubscribeToken, email: normalizedEmail },
              { onConflict: 'email', ignoreDuplicates: true },
            )
          if (tokenError) {
            await supabase.from('email_send_log').insert({
              message_id: messageId,
              template_name: templateName,
              recipient_email: effectiveRecipient,
              status: 'failed',
              error_message: 'Failed to create unsubscribe token',
            })
            return Response.json({ error: 'Failed to prepare email' }, { status: 500 })
          }
          const { data: storedToken } = await supabase
            .from('email_unsubscribe_tokens')
            .select('token')
            .eq('email', normalizedEmail)
            .maybeSingle()
          if (!storedToken) {
            await supabase.from('email_send_log').insert({
              message_id: messageId,
              template_name: templateName,
              recipient_email: effectiveRecipient,
              status: 'failed',
              error_message: 'Failed to confirm unsubscribe token storage',
            })
            return Response.json({ error: 'Failed to prepare email' }, { status: 500 })
          }
          unsubscribeToken = storedToken.token
        } else {
          await supabase.from('email_send_log').insert({
            message_id: messageId,
            template_name: templateName,
            recipient_email: effectiveRecipient,
            status: 'suppressed',
            error_message: 'Unsubscribe token used but email missing from suppressed list',
          })
          return Response.json({ success: false, reason: 'email_suppressed' })
        }

        // Resolve admin overrides for subject/from/copy
        const language = templateData.language === 'es' ? 'es' : 'pt-BR'
        const overrides = await resolveTemplateOverrides(templateName, language)
        const componentProps = { ...templateData, overrides: overrides.copy }
        const element = React.createElement(template.component, componentProps)
        const renderedHtml = await render(element)
        const renderedText = await render(element, { plainText: true })
        const unsubscribeUrl = buildUnsubscribeUrl(unsubscribeToken)
        const { html, text } = appendUnsubscribeFooter(renderedHtml, renderedText, unsubscribeUrl)

        const subjectData = { ...templateData, overrideSubject: overrides.subjectTemplate }
        const resolvedSubject =
          typeof template.subject === 'function' ? template.subject(subjectData) : template.subject

        // Pending log row
        await supabase.from('email_send_log').insert({
          message_id: messageId,
          template_name: templateName,
          recipient_email: effectiveRecipient,
          status: 'pending',
        })

        const result = await sendViaSendGrid({
          to: effectiveRecipient,
          subject: resolvedSubject,
          html,
          text,
          unsubscribeUrl,
          templateName,
          messageId,
          fromName: overrides.fromName,
        })

        if (!result.ok) {
          console.error('SendGrid send failed', {
            status: result.status,
            error: result.error,
            templateName,
            recipient_redacted: redactEmail(effectiveRecipient),
          })
          await supabase.from('email_send_log').insert({
            message_id: messageId,
            template_name: templateName,
            recipient_email: effectiveRecipient,
            status: 'failed',
            error_message: `SendGrid ${result.status}: ${result.error}`,
          })
          return Response.json(
            { error: 'Failed to send email', details: result.error },
            { status: 502 },
          )
        }

        await supabase.from('email_send_log').insert({
          message_id: messageId,
          template_name: templateName,
          recipient_email: effectiveRecipient,
          status: 'sent',
          metadata: {
            provider: 'sendgrid',
            sg_message_id: result.sgMessageId,
            idempotency_key: idempotencyKey,
          },
        } as any)

        console.log('Transactional email sent', {
          templateName,
          provider: 'sendgrid',
          recipient_redacted: redactEmail(effectiveRecipient),
        })

        return Response.json({
          success: true,
          message_id: messageId,
          sg_message_id: result.sgMessageId,
        })
      },
    },
  },
})
