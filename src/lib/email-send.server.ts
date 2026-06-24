import * as React from 'react'
import { render } from '@react-email/components'
import type { SupabaseClient } from '@supabase/supabase-js'
import { TEMPLATES } from '@/lib/email-templates/registry'
import { resolveTemplateOverrides } from '@/lib/email-templates/overrides.server'

// SendGrid sender (verified Single Sender / Authenticated Domain).
const FROM_EMAIL = 'rodada@promperu.tur.br'
const FROM_NAME = 'Rodada de Negócios PromPerú'
const REPLY_TO_EMAIL = 'rodada@promperu.tur.br'
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

export type ProcessSendInput = {
  templateName: string
  recipientEmail?: string
  idempotencyKey?: string
  templateData?: Record<string, any>
}

export type ProcessSendResult = {
  status: number
  body: Record<string, any>
}

/**
 * Core transactional send pipeline. Caller is responsible for authorization.
 * Used by both the HTTP route and admin server functions (avoids worker
 * loopback fetches that can drop the Authorization header).
 */
export async function processTransactionalSend(
  supabase: SupabaseClient<any>,
  input: ProcessSendInput,
): Promise<ProcessSendResult> {
  const templateName = input.templateName
  if (!templateName) return { status: 400, body: { error: 'templateName is required' } }

  const template = TEMPLATES[templateName]
  if (!template) {
    return {
      status: 404,
      body: { error: `Template '${templateName}' not found. Available: ${Object.keys(TEMPLATES).join(', ')}` },
    }
  }

  const messageId = crypto.randomUUID()
  const idempotencyKey = input.idempotencyKey || messageId
  const templateData: Record<string, any> = input.templateData ?? {}

  const effectiveRecipient = (template as any).to || input.recipientEmail
  if (!effectiveRecipient) {
    return {
      status: 400,
      body: { error: 'recipientEmail is required (unless the template defines a fixed recipient)' },
    }
  }

  const { data: suppressed, error: suppressionError } = await supabase
    .from('suppressed_emails')
    .select('id')
    .eq('email', effectiveRecipient.toLowerCase())
    .maybeSingle()

  if (suppressionError) {
    console.error('Suppression check failed', { error: suppressionError })
    return { status: 500, body: { error: 'Failed to verify suppression status' } }
  }

  if (suppressed) {
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName,
      recipient_email: effectiveRecipient,
      status: 'suppressed',
    })
    return { status: 200, body: { success: false, reason: 'email_suppressed' } }
  }

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
    return { status: 500, body: { error: 'Failed to prepare email' } }
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
      return { status: 500, body: { error: 'Failed to prepare email' } }
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
      return { status: 500, body: { error: 'Failed to prepare email' } }
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
    return { status: 200, body: { success: false, reason: 'email_suppressed' } }
  }

  const language = templateData.language === 'es' ? 'es' : 'pt-BR'
  const overrides = await resolveTemplateOverrides(templateName, language)
  const componentProps = { ...templateData, overrides: overrides.copy }
  const element = React.createElement(template.component as any, componentProps)
  const renderedHtml = await render(element)
  const renderedText = await render(element, { plainText: true })
  const unsubscribeUrl = buildUnsubscribeUrl(unsubscribeToken)
  const { html, text } = appendUnsubscribeFooter(renderedHtml, renderedText, unsubscribeUrl)

  const subjectData = { ...templateData, overrideSubject: overrides.subjectTemplate }
  const resolvedSubject =
    typeof template.subject === 'function' ? (template.subject as any)(subjectData) : template.subject

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
    return { status: 502, body: { error: 'Failed to send email', details: result.error } }
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

  return {
    status: 200,
    body: { success: true, message_id: messageId, sg_message_id: result.sgMessageId },
  }
}