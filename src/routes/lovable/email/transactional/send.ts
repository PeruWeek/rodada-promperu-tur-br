import { createClient } from '@supabase/supabase-js'
import { createFileRoute } from '@tanstack/react-router'
import { processTransactionalSend } from '@/lib/email-send.server'

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

        let body: any
        try {
          body = await request.json()
        } catch {
          return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 })
        }

        const result = await processTransactionalSend(supabase, {
          templateName: body.templateName || body.template_name,
          recipientEmail: body.recipientEmail || body.recipient_email,
          idempotencyKey: body.idempotencyKey || body.idempotency_key,
          templateData:
            body.templateData && typeof body.templateData === 'object' ? body.templateData : {},
        })
        return Response.json(result.body, { status: result.status })
      },
    },
  },
})
