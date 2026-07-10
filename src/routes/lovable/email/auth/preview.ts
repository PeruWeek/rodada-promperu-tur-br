import * as React from 'react'
import { render } from '@react-email/components'
import { createFileRoute } from '@tanstack/react-router'
import { SignupEmail } from '@/lib/email-templates/signup'
import { InviteEmail } from '@/lib/email-templates/invite'
import { MagicLinkEmail } from '@/lib/email-templates/magic-link'
import { RecoveryEmail } from '@/lib/email-templates/recovery'
import { EmailChangeEmail } from '@/lib/email-templates/email-change'
import { ReauthenticationEmail } from '@/lib/email-templates/reauthentication'
import { resolveSiteContext } from '@/lib/site-context.server'

const EMAIL_TEMPLATES: Record<string, React.ComponentType<any>> = {
  signup: SignupEmail,
  invite: InviteEmail,
  magiclink: MagicLinkEmail,
  recovery: RecoveryEmail,
  email_change: EmailChangeEmail,
  reauthentication: ReauthenticationEmail,
}

// Sample e-mail (RFC 6761 .test TLD) — Go backend rewrites this at test send.
const SAMPLE_EMAIL = "user@example.test"

function sampleDataFor(type: string, siteName: string, siteUrl: string): object {
  switch (type) {
    case 'signup':
      return { siteName, siteUrl, recipient: SAMPLE_EMAIL, confirmationUrl: siteUrl, loginUrl: `${siteUrl}/login` }
    case 'magiclink':
      return { siteName, confirmationUrl: siteUrl }
    case 'recovery':
      return { siteName, confirmationUrl: siteUrl }
    case 'invite':
      return { siteName, siteUrl, confirmationUrl: siteUrl }
    case 'email_change':
      return { siteName, oldEmail: SAMPLE_EMAIL, email: SAMPLE_EMAIL, newEmail: SAMPLE_EMAIL, confirmationUrl: siteUrl }
    case 'reauthentication':
      return { token: '123456' }
    default:
      return {}
  }
}

export const Route = createFileRoute("/lovable/email/auth/preview")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.LOVABLE_API_KEY

        if (!apiKey) {
          return Response.json(
            { error: 'Server configuration error' },
            { status: 500 }
          )
        }

        // Verify the caller is authorized with LOVABLE_API_KEY
        const authHeader = request.headers.get('Authorization')
        if (!authHeader || authHeader !== `Bearer ${apiKey}`) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        let type: string
        try {
          const body = await request.json()
          type = body.type
        } catch {
          return Response.json(
            { error: 'Invalid JSON in request body' },
            { status: 400 }
          )
        }

        const EmailTemplate = EMAIL_TEMPLATES[type]

        if (!EmailTemplate) {
          return Response.json(
            { error: `Unknown email type: ${type}` },
            { status: 400 }
          )
        }

        const site = await resolveSiteContext()
        const siteUrl = (site.siteUrl || `https://${site.hostname}`).replace(/\/+$/, '')
        const sampleData = sampleDataFor(type, site.name, siteUrl)
        const html = await render(React.createElement(EmailTemplate, sampleData))

        return new Response(html, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      },
    },
  },
})
