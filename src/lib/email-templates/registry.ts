import type { ComponentType } from 'react'

export interface TemplateEntry {
  component: ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  displayName?: string
  previewData?: Record<string, any>
  /** Fixed recipient — overrides caller-provided recipientEmail when set. */
  to?: string
}

import { template as meetingConfirmation } from './meeting-confirmation'
import { template as meetingCancelled } from './meeting-cancelled'
import { template as buyerWelcome } from './buyer-welcome'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'meeting-confirmation': meetingConfirmation,
  'meeting-cancelled': meetingCancelled,
  'buyer-welcome': buyerWelcome,
}
