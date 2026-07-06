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
import { template as bookingReminder } from './booking-reminder'
import { template as companyContactInvite } from './company-contact-invite'
import { template as agendaDelivery } from './agenda-delivery'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'meeting-confirmation': meetingConfirmation,
  'meeting-cancelled': meetingCancelled,
  'buyer-welcome': buyerWelcome,
  'booking-reminder': bookingReminder,
  'company-contact-invite': companyContactInvite,
  'agenda-delivery': agendaDelivery,
}
