/* eslint-disable @typescript-eslint/no-explicit-any */
// Server-only helpers for the admin "Disparo de agendas" campaign flow.
//
// Rules encoded here:
//  - Eligibility source of truth: `_listEventRegistrantsImpl` (same base
//    query as the Inscritos tab). No parallel logic.
//  - Individual-agenda criterion: `profile_meetings_count > 0` (per-profile,
//    NOT company aggregate).
//  - PDF generation: reuses the canonical single-profile agenda from
//    `buildParticipantAgendaData` + `buildAgendaPdf`. `getCompanyAgenda` is
//    NOT used in this flow.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { _listEventRegistrantsImpl } from "@/lib/staff-exports.functions";
import {
  buildParticipantAgendaData,
  type BuildParticipantAgendaResult,
} from "@/lib/participant-agenda.server";
import { buildAgendaPdf } from "@/lib/pdf";

export type EligibleRecipient = {
  profileId: string;
  email: string;
  fullName: string;
  companyId: string;
  companyName: string;
  role: "visitor" | "exhibitor";
  profileMeetingsCount: number;
};

/**
 * List profiles eligible to receive the agenda-delivery email for a given
 * event and category. Eligibility = has a real individual agenda
 * (`profile_meetings_count > 0`) AND matches the requested category.
 *
 * The caller MUST have already been authorized (see
 * `agenda-campaigns.functions.ts` → `assertAdminRole`). This helper does
 * NOT re-check the caller; it delegates to `_listEventRegistrantsImpl`
 * with the admin userId (which is what the "Inscritos" tab uses today).
 */
export async function listEligibleRecipients(opts: {
  eventId: string;
  category: "visitor" | "exhibitor";
  actingAdminUserId: string;
}): Promise<EligibleRecipient[]> {
  const base = await _listEventRegistrantsImpl(
    {
      eventId: opts.eventId,
      role: opts.category,
      sort: "name",
    },
    { userId: opts.actingAdminUserId, supabase: supabaseAdmin },
  );
  const rows = base.rows ?? [];
  const out: EligibleRecipient[] = [];
  for (const r of rows) {
    if (r.role !== opts.category) continue;
    // Canonical per-profile criterion. See RegistrantRow docs:
    // `profile_meetings_count` is per-profile (matches getParticipantAgenda),
    // `scheduled_meetings_count` is company-aggregate.
    if ((r.profile_meetings_count ?? 0) <= 0) continue;
    if (!r.email) continue;
    out.push({
      profileId: r.profile_id,
      email: r.email,
      fullName: r.full_name,
      companyId: r.company_id,
      companyName: r.company_trade_name,
      role: r.role,
      profileMeetingsCount: r.profile_meetings_count,
    });
  }
  return out;
}

/**
 * Render an individual agenda PDF for one profile.
 * Reuses `buildParticipantAgendaData` (same helper `getParticipantAgenda`
 * now calls) so the rows emailed to the user are byte-identical with the
 * "Agenda (PDF)" download in the Inscritos tab.
 *
 * Returns `null` when the profile has no scheduled meetings for the event
 * (caller should treat that as "not eligible / do not serve PDF").
 */
export async function renderAgendaPdfFor(opts: {
  eventId: string;
  profileId: string;
}): Promise<{ bytes: Uint8Array; profileName: string } | null> {
  const data: BuildParticipantAgendaResult = await buildParticipantAgendaData({
    supabase: supabaseAdmin,
    eventId: opts.eventId,
    profileId: opts.profileId,
  });
  if (!data.rows || data.rows.length === 0) return null;

  const generatedAt = new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
  const doc = buildAgendaPdf({
    title: "Minha agenda",
    subtitle: "Rodada de Negócios PromPerú",
    ownerName: data.profileName,
    generatedLabel: `Gerado em ${generatedAt}`,
    rows: data.rows,
  });
  const ab = doc.output("arraybuffer") as ArrayBuffer;
  return { bytes: new Uint8Array(ab), profileName: data.profileName };
}