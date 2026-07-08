import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { applyMeetingCheckIn } from "@/lib/checkin.functions";

const SITE_URL = "https://rodada.promperu.tur.br";

async function isAdminOrStaff(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  return (data ?? []).some((r) => r.role === "admin" || r.role === "staff");
}

async function loadLatestEventId(eventId?: string | null): Promise<string | null> {
  if (eventId) return eventId;
  const { data } = await supabaseAdmin
    .from("events")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

// ============================================================
// ADMIN: list eligible participants + their Q&A status.
// Eligible = present in general_checkins for this event.
// ============================================================
export const listPostEventQAStatus = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ eventId: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    if (!(await isAdminOrStaff(context.userId)))
      throw new Error("Forbidden: admin/staff only");
    const eventId = await loadLatestEventId(data.eventId ?? null);
    if (!eventId) return { eventId: null, rows: [] as Array<any> };

    const { data: chks } = await supabaseAdmin
      .from("general_checkins")
      .select("profile_id")
      .eq("event_id", eventId);
    const profileIds = Array.from(
      new Set((chks ?? []).map((c) => c.profile_id as string)),
    );
    if (!profileIds.length) return { eventId, rows: [] as Array<any> };

    const [{ data: profs }, { data: tokens }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, full_name, email, company_id")
        .in("id", profileIds),
      supabaseAdmin
        .from("postevent_qa_tokens")
        .select("profile_id, sent_at, first_opened_at, submitted_at, expires_at")
        .eq("event_id", eventId)
        .in("profile_id", profileIds),
    ]);
    const compIds = Array.from(
      new Set(
        (profs ?? []).map((p) => p.company_id).filter(Boolean) as string[],
      ),
    );
    const { data: comps } = compIds.length
      ? await supabaseAdmin
          .from("companies")
          .select("id, trade_name")
          .in("id", compIds)
      : { data: [] as Array<{ id: string; trade_name: string }> };
    const compMap = new Map((comps ?? []).map((c) => [c.id as string, c.trade_name]));
    const tokMap = new Map((tokens ?? []).map((t) => [t.profile_id as string, t]));

    const rows = (profs ?? []).map((p) => {
      const tok = tokMap.get(p.id) ?? null;
      return {
        profile_id: p.id,
        full_name: p.full_name,
        email: p.email,
        company: p.company_id ? compMap.get(p.company_id) ?? null : null,
        sent_at: tok?.sent_at ?? null,
        first_opened_at: tok?.first_opened_at ?? null,
        submitted_at: tok?.submitted_at ?? null,
      };
    });
    rows.sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? "", "pt-BR"));
    return { eventId, rows };
  });

// ============================================================
// ADMIN: send Q&A e-mail to a batch of eligible profiles.
// ============================================================
export const sendPostEventQA = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        eventId: z.string().uuid().optional(),
        profileIds: z.array(z.string().uuid()).min(1).max(10),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const canSend = (roles ?? []).some((r) => r.role === "admin" || r.role === "staff");
    if (!canSend)
      throw new Error("Forbidden: admin/staff only");

    const eventId = data.eventId ?? (await (async () => {
      const { data: evt } = await supabaseAdmin
        .from("events")
        .select("id")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return evt?.id ?? null;
    })());
    if (!eventId) throw new Error("No event found");

    const makeToken = () => {
      const bytes = new Uint8Array(24);
      crypto.getRandomValues(bytes);
      return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    };
    const siteUrl = "https://rodada.promperu.tur.br";
    const describeSendFailure = (res: { status: number; body?: unknown }) => {
      const body = (res.body ?? {}) as Record<string, unknown>;
      if (body.reason === "email_suppressed") {
        return "E-mail está suprimido/descadastrado e não pode receber mensagens.";
      }
      if (typeof body.error === "string" && body.error.trim()) return body.error;
      if (typeof body.details === "string" && body.details.trim()) return body.details;
      return `Serviço de e-mail retornou status ${res.status}.`;
    };

    const failures: Array<{
      profileId: string;
      email: string | null;
      name: string | null;
      reason: string;
    }> = [];

    // Only allow profiles actually present in general_checkins for the event.
    const { data: chks } = await supabaseAdmin
      .from("general_checkins")
      .select("profile_id")
      .eq("event_id", eventId)
      .in("profile_id", data.profileIds);
    const eligibleSet = new Set((chks ?? []).map((c) => c.profile_id as string));
    const eligibleIds = data.profileIds.filter((id) => eligibleSet.has(id));
    const skippedIds = data.profileIds.filter((id) => !eligibleSet.has(id));
    if (!eligibleIds.length) {
      return {
        sent: 0,
        failed: 0,
        skipped: skippedIds.length,
        eligible: 0,
        failures,
      };
    }

    const { data: evt } = await supabaseAdmin
      .from("events")
      .select("id, name")
      .eq("id", eventId)
      .maybeSingle();
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", eligibleIds);

    const { processTransactionalSend } = await import("@/lib/email-send.server");

    const profiles = profs ?? [];
    const foundProfileIds = new Set(profiles.map((p) => p.id as string));
    for (const id of eligibleIds) {
      if (!foundProfileIds.has(id)) {
        failures.push({
          profileId: id,
          email: null,
          name: null,
          reason: "Perfil não encontrado para este participante.",
        });
      }
    }

    let sent = 0;
    const startedAt = Date.now();
    const REQUEST_BUDGET_MS = 22_000;
    for (let i = 0; i < profiles.length; i++) {
      const p = profiles[i];
      if (Date.now() - startedAt > REQUEST_BUDGET_MS) {
        for (const pending of profiles.slice(i)) {
          failures.push({
            profileId: pending.id as string,
            email: pending.email ?? null,
            name: pending.full_name ?? null,
            reason:
              "Lote interrompido para evitar timeout. Reenvie este participante em uma nova tentativa.",
          });
        }
        break;
      }
      if (!p.email) {
        failures.push({
          profileId: p.id as string,
          email: null,
          name: p.full_name ?? null,
          reason: "Participante sem e-mail cadastrado.",
        });
        continue;
      }
      // Idempotent token: reuse existing unless submitted.
      const { data: existing } = await supabaseAdmin
        .from("postevent_qa_tokens")
        .select("id, token, submitted_at")
        .eq("event_id", eventId)
        .eq("profile_id", p.id)
        .maybeSingle();
      let token: string;
      let tokenRowId: string;
      if (existing) {
        token = existing.token as string;
        tokenRowId = existing.id as string;
      } else {
        token = makeToken();
        const { data: inserted, error: insErr } = await supabaseAdmin
          .from("postevent_qa_tokens")
          .insert({ event_id: eventId, profile_id: p.id, token } as never)
          .select("id")
          .single();
        if (insErr) {
          failures.push({
            profileId: p.id as string,
            email: p.email,
            name: p.full_name ?? null,
            reason: `Não foi possível criar o link individual: ${insErr.message}`,
          });
          continue;
        }
        tokenRowId = inserted.id as string;
      }

      const qaUrl = `${siteUrl}/qa/${token}`;
      const res = await processTransactionalSend(supabaseAdmin as any, {
        templateName: "postevent-qa",
        recipientEmail: p.email,
        idempotencyKey: `postevent-qa:${eventId}:${p.id}`,
        templateData: {
          language: "pt-BR",
          visitorName: p.full_name ?? "",
          eventName: evt?.name ?? "",
          qaUrl,
        },
      });
      if (res.status === 200 && (res.body as any)?.success) {
        await supabaseAdmin
          .from("postevent_qa_tokens")
          .update({ sent_at: new Date().toISOString() })
          .eq("id", tokenRowId);
        sent++;
      } else {
        failures.push({
          profileId: p.id as string,
          email: p.email,
          name: p.full_name ?? null,
          reason: describeSendFailure(res),
        });
      }
    }
    return {
      sent,
      failed: failures.length,
      skipped: skippedIds.length,
      eligible: eligibleIds.length,
      failures,
    };
  });

// ============================================================
// PUBLIC: token-authenticated read + write (no auth middleware —
// the token itself is the bearer, validated server-side).
// ============================================================
export const sendPostEventQATest = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        eventId: z.string().uuid().optional(),
        testEmail: z.string().email(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    if (!(await isAdminOrStaff(context.userId)))
      throw new Error("Forbidden: admin/staff only");
    const eventId = await loadLatestEventId(data.eventId ?? null);
    const { data: evt } = eventId
      ? await supabaseAdmin
          .from("events")
          .select("id, name")
          .eq("id", eventId)
          .maybeSingle()
      : { data: null as { id: string; name: string } | null };

    const { processTransactionalSend } = await import("@/lib/email-send.server");
    // Static, dedicated preview route (takes precedence over /qa/$token).
    // Renders a mocked form; no server calls, no token validation, no writes.
    const previewUrl = `${SITE_URL}/qa/preview`;
    const res = await processTransactionalSend(supabaseAdmin as any, {
      templateName: "postevent-qa",
      recipientEmail: data.testEmail,
      idempotencyKey: `postevent-qa-test:${Date.now()}:${data.testEmail}`,
      templateData: {
        language: "pt-BR",
        visitorName: "(teste)",
        eventName: evt?.name ?? "Rodada de Negócios PromPerú",
        qaUrl: previewUrl,
      },
    });
    const ok = res.status === 200 && (res.body as any)?.success;
    return { ok };
  });

export const getPostEventQAContext = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ token: z.string().min(16).max(128) }).parse(input))
  .handler(async ({ data }) => {
    const { data: tok } = await supabaseAdmin
      .from("postevent_qa_tokens")
      .select("id, event_id, profile_id, sent_at, submitted_at, expires_at, first_opened_at")
      .eq("token", data.token)
      .maybeSingle();
    if (!tok) return { ok: false as const, reason: "invalid" as const };
    if (new Date(tok.expires_at as string).getTime() < Date.now())
      return { ok: false as const, reason: "expired" as const };

    // Mark first open (idempotent).
    if (!tok.first_opened_at) {
      await supabaseAdmin
        .from("postevent_qa_tokens")
        .update({ first_opened_at: new Date().toISOString() })
        .eq("id", tok.id);
    }

    const [{ data: profile }, { data: event }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, full_name, company_id")
        .eq("id", tok.profile_id as string)
        .maybeSingle(),
      supabaseAdmin
        .from("events")
        .select("id, name")
        .eq("id", tok.event_id as string)
        .maybeSingle(),
    ]);

    // Meetings the participant took part in (visitor OR exhibitor via table).
    const { data: tables } = await supabaseAdmin
      .from("event_tables")
      .select("id, table_number, exhibitor_profile_id")
      .eq("event_id", tok.event_id as string);
    const myTableIds = (tables ?? [])
      .filter((t) => t.exhibitor_profile_id === tok.profile_id)
      .map((t) => t.id as string);
    const tableMap = new Map((tables ?? []).map((t) => [t.id as string, t]));

    const { data: mtgs } = await supabaseAdmin
      .from("meetings")
      .select("id, visitor_profile_id, table_id, slot_id, status")
      .eq("event_id", tok.event_id as string)
      .in("status", ["scheduled", "done", "no_show"]);
    const myMeetings = (mtgs ?? []).filter(
      (m) =>
        m.visitor_profile_id === tok.profile_id ||
        (m.table_id && myTableIds.includes(m.table_id as string)),
    );
    const slotIds = Array.from(
      new Set(myMeetings.map((m) => m.slot_id).filter(Boolean) as string[]),
    );
    const { data: slots } = slotIds.length
      ? await supabaseAdmin
          .from("time_slots")
          .select("id, start_at, end_at")
          .in("id", slotIds)
      : { data: [] as Array<{ id: string; start_at: string; end_at: string }> };
    const slotMap = new Map((slots ?? []).map((s) => [s.id as string, s]));

    // Counterpart companies
    const counterpartProfileIds = new Set<string>();
    for (const m of myMeetings) {
      if (m.visitor_profile_id !== tok.profile_id && m.visitor_profile_id)
        counterpartProfileIds.add(m.visitor_profile_id as string);
      const t = m.table_id ? tableMap.get(m.table_id as string) : null;
      if (t?.exhibitor_profile_id && t.exhibitor_profile_id !== tok.profile_id)
        counterpartProfileIds.add(t.exhibitor_profile_id as string);
    }
    const cpIds = Array.from(counterpartProfileIds);
    const { data: cpProfiles } = cpIds.length
      ? await supabaseAdmin
          .from("profiles")
          .select("id, full_name, company_id")
          .in("id", cpIds)
      : { data: [] as Array<{ id: string; full_name: string; company_id: string | null }> };
    const compIds = Array.from(
      new Set((cpProfiles ?? []).map((p) => p.company_id).filter(Boolean) as string[]),
    );
    const { data: comps } = compIds.length
      ? await supabaseAdmin
          .from("companies")
          .select("id, trade_name")
          .in("id", compIds)
      : { data: [] as Array<{ id: string; trade_name: string }> };
    const compMap = new Map((comps ?? []).map((c) => [c.id as string, c.trade_name]));
    const profMap = new Map((cpProfiles ?? []).map((p) => [p.id as string, p]));

    const { data: existingChecks } = await supabaseAdmin
      .from("meeting_checkins")
      .select("meeting_id, status")
      .in("meeting_id", myMeetings.map((m) => m.id as string));
    const checkMap = new Map(
      (existingChecks ?? []).map((c) => [c.meeting_id as string, c.status as string]),
    );

    const meetings = myMeetings.map((m) => {
      const t = m.table_id ? tableMap.get(m.table_id as string) : null;
      const otherProfileId =
        m.visitor_profile_id === tok.profile_id
          ? (t?.exhibitor_profile_id as string | null)
          : (m.visitor_profile_id as string | null);
      const otherProf = otherProfileId ? profMap.get(otherProfileId) : null;
      const otherCompany = otherProf?.company_id
        ? compMap.get(otherProf.company_id) ?? null
        : null;
      const slot = m.slot_id ? slotMap.get(m.slot_id as string) : null;
      return {
        meeting_id: m.id as string,
        counterpart_name: otherProf?.full_name ?? "—",
        counterpart_company: otherCompany ?? "—",
        table_number: t?.table_number ?? null,
        slot_start: slot?.start_at ?? null,
        slot_end: slot?.end_at ?? null,
        current_status: m.status as string,
        checkin_status: checkMap.get(m.id as string) ?? null,
      };
    });
    meetings.sort((a, b) => (a.slot_start ?? "").localeCompare(b.slot_start ?? ""));

    return {
      ok: true as const,
      alreadySubmitted: !!tok.submitted_at,
      participant: {
        name: profile?.full_name ?? "",
      },
      event: { name: event?.name ?? "" },
      meetings,
    };
  });

export const submitPostEventQA = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        token: z.string().min(16).max(128),
        decisions: z
          .array(
            z.object({
              meetingId: z.string().uuid(),
              decision: z.enum(["done", "no_show"]),
            }),
          )
          .max(200),
        survey: z
          .object({
            overallRating: z.number().int().min(1).max(5).nullable().optional(),
            meetingsQuality: z.number().int().min(1).max(5).nullable().optional(),
            nextEditionInterest: z
              .enum(["yes", "maybe", "no"])
              .nullable()
              .optional(),
            comments: z.string().max(2000).nullable().optional(),
          })
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { data: tok } = await supabaseAdmin
      .from("postevent_qa_tokens")
      .select("id, event_id, profile_id, expires_at, submitted_at")
      .eq("token", data.token)
      .maybeSingle();
    if (!tok) throw new Error("Invalid token");
    if (new Date(tok.expires_at as string).getTime() < Date.now())
      throw new Error("Expired token");

    // Restrict decisions to meetings actually belonging to this participant.
    const { data: tables } = await supabaseAdmin
      .from("event_tables")
      .select("id, exhibitor_profile_id")
      .eq("event_id", tok.event_id as string);
    const myTableIds = new Set(
      (tables ?? [])
        .filter((t) => t.exhibitor_profile_id === tok.profile_id)
        .map((t) => t.id as string),
    );
    const meetingIds = data.decisions.map((d) => d.meetingId);
    const { data: mtgs } = meetingIds.length
      ? await supabaseAdmin
          .from("meetings")
          .select("id, visitor_profile_id, table_id, event_id")
          .in("id", meetingIds)
      : { data: [] as Array<{ id: string; visitor_profile_id: string | null; table_id: string | null; event_id: string }> };
    const allowed = new Set(
      (mtgs ?? [])
        .filter(
          (m) =>
            m.event_id === tok.event_id &&
            (m.visitor_profile_id === tok.profile_id ||
              (m.table_id && myTableIds.has(m.table_id as string))),
        )
        .map((m) => m.id as string),
    );

    let recorded = 0;
    for (const d of data.decisions) {
      if (!allowed.has(d.meetingId)) continue;
      await applyMeetingCheckIn({
        meetingId: d.meetingId,
        status: d.decision === "done" ? "present" : "no_show",
        byRole: "visitor",
      });
      recorded++;
    }

    // Persist survey answers separately (idempotent per token).
    if (data.survey) {
      const s = data.survey;
      await (supabaseAdmin as any)
        .from("postevent_survey_responses")
        .upsert(
          {
            token_id: tok.id,
            event_id: tok.event_id,
            profile_id: tok.profile_id,
            overall_rating: s.overallRating ?? null,
            meetings_quality: s.meetingsQuality ?? null,
            next_edition_interest: s.nextEditionInterest ?? null,
            comments: s.comments ?? null,
          },
          { onConflict: "token_id" },
        );
    }

    await supabaseAdmin
      .from("postevent_qa_tokens")
      .update({ submitted_at: new Date().toISOString() })
      .eq("id", tok.id);

    return { ok: true, recorded };
  });

// ============================================================
// ADMIN: consolidated survey report for the "Pesquisa do evento".
// Returns aggregate metrics + per-participant drilldown rows,
// including canonical meeting confirmations from meeting_checkins
// / meetings.status.
// ============================================================
export const getPostEventSurveyReport = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ eventId: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    if (!(await isAdminOrStaff(context.userId)))
      throw new Error("Forbidden: admin/staff only");
    const eventId = await loadLatestEventId(data.eventId ?? null);
    if (!eventId) {
      return {
        eventId: null as string | null,
        metrics: {
          eligible: 0,
          sent: 0,
          opened: 0,
          submitted: 0,
          responseRate: 0,
          meetingsDone: 0,
          meetingsNoShow: 0,
          meetingsPending: 0,
          overallRatingAvg: null as number | null,
          meetingsQualityAvg: null as number | null,
          nextEdition: { yes: 0, maybe: 0, no: 0 },
        },
        rows: [] as Array<any>,
      };
    }

    // Eligible universe = general_checkins participants
    const { data: chks } = await supabaseAdmin
      .from("general_checkins")
      .select("profile_id")
      .eq("event_id", eventId);
    const profileIds = Array.from(
      new Set((chks ?? []).map((c) => c.profile_id as string)),
    );

    const [{ data: profs }, { data: tokens }, { data: surveys }, { data: tables }, { data: mtgs }] =
      await Promise.all([
        profileIds.length
          ? supabaseAdmin
              .from("profiles")
              .select("id, full_name, email, company_id")
              .in("id", profileIds)
          : Promise.resolve({ data: [] as Array<{ id: string; full_name: string; email: string; company_id: string | null }> } as any),
        supabaseAdmin
          .from("postevent_qa_tokens")
          .select("id, profile_id, sent_at, first_opened_at, submitted_at")
          .eq("event_id", eventId),
        (supabaseAdmin as any)
          .from("postevent_survey_responses")
          .select("token_id, profile_id, overall_rating, meetings_quality, next_edition_interest, comments, created_at")
          .eq("event_id", eventId),
        supabaseAdmin
          .from("event_tables")
          .select("id, table_number, exhibitor_profile_id")
          .eq("event_id", eventId),
        supabaseAdmin
          .from("meetings")
          .select("id, visitor_profile_id, table_id, slot_id, status")
          .eq("event_id", eventId)
          .in("status", ["scheduled", "done", "no_show"]),
      ]);

    const compIds = Array.from(
      new Set(((profs ?? []) as any[]).map((p) => p.company_id).filter(Boolean) as string[]),
    );
    const { data: comps } = compIds.length
      ? await supabaseAdmin
          .from("companies")
          .select("id, trade_name")
          .in("id", compIds)
      : { data: [] as Array<{ id: string; trade_name: string }> };
    const compMap = new Map((comps ?? []).map((c) => [c.id as string, c.trade_name]));

    const tableMap = new Map((tables ?? []).map((t) => [t.id as string, t]));
    const tokByProfile = new Map(
      (tokens ?? []).map((t) => [t.profile_id as string, t]),
    );
    const surveyByProfile = new Map(
      (surveys ?? []).map((s: any) => [s.profile_id as string, s]),
    );

    // Meeting checkins for status truth (canonical: meeting_checkins + meetings.status)
    const meetingIds = (mtgs ?? []).map((m) => m.id as string);
    const { data: checks } = meetingIds.length
      ? await supabaseAdmin
          .from("meeting_checkins")
          .select("meeting_id, status")
          .in("meeting_id", meetingIds)
      : { data: [] as Array<{ meeting_id: string; status: string }> };
    const checkMap = new Map((checks ?? []).map((c) => [c.meeting_id as string, c.status as string]));

    // Slots for optional context
    const slotIds = Array.from(
      new Set((mtgs ?? []).map((m) => m.slot_id).filter(Boolean) as string[]),
    );
    const { data: slots } = slotIds.length
      ? await supabaseAdmin
          .from("time_slots")
          .select("id, start_at")
          .in("id", slotIds)
      : { data: [] as Array<{ id: string; start_at: string }> };
    const slotMap = new Map((slots ?? []).map((s) => [s.id as string, s.start_at as string]));

    // Counterpart profiles (for drilldown display)
    const cpIds = new Set<string>();
    for (const m of (mtgs ?? [])) {
      if (m.visitor_profile_id) cpIds.add(m.visitor_profile_id as string);
      const t = m.table_id ? tableMap.get(m.table_id as string) : null;
      if (t?.exhibitor_profile_id) cpIds.add(t.exhibitor_profile_id as string);
    }
    const cpIdArr = Array.from(cpIds);
    const { data: cpProfs } = cpIdArr.length
      ? await supabaseAdmin
          .from("profiles")
          .select("id, full_name, company_id")
          .in("id", cpIdArr)
      : { data: [] as Array<{ id: string; full_name: string; company_id: string | null }> };
    const cpCompIds = Array.from(
      new Set((cpProfs ?? []).map((p) => p.company_id).filter(Boolean) as string[]),
    );
    const { data: cpComps } = cpCompIds.length
      ? await supabaseAdmin
          .from("companies")
          .select("id, trade_name")
          .in("id", cpCompIds)
      : { data: [] as Array<{ id: string; trade_name: string }> };
    const cpCompMap = new Map((cpComps ?? []).map((c) => [c.id as string, c.trade_name]));
    const cpProfMap = new Map((cpProfs ?? []).map((p) => [p.id as string, p]));

    // Build per-participant rows
    const rows = ((profs ?? []) as any[]).map((p) => {
      const tok = tokByProfile.get(p.id) ?? null;
      const survey = surveyByProfile.get(p.id) ?? null;

      const myTableIds = (tables ?? [])
        .filter((t) => t.exhibitor_profile_id === p.id)
        .map((t) => t.id as string);
      const myMeetings = (mtgs ?? []).filter(
        (m) =>
          m.visitor_profile_id === p.id ||
          (m.table_id && myTableIds.includes(m.table_id as string)),
      );
      const meetingsDetail = myMeetings.map((m) => {
        const t = m.table_id ? tableMap.get(m.table_id as string) : null;
        const otherProfileId =
          m.visitor_profile_id === p.id
            ? (t?.exhibitor_profile_id as string | null)
            : (m.visitor_profile_id as string | null);
        const otherProf = otherProfileId ? cpProfMap.get(otherProfileId) : null;
        const otherCompany = otherProf?.company_id ? cpCompMap.get(otherProf.company_id) ?? null : null;
        const canonicalStatus = (m.status as string) ?? "scheduled";
        return {
          meeting_id: m.id as string,
          counterpart_name: otherProf?.full_name ?? "—",
          counterpart_company: otherCompany ?? "—",
          table_number: t?.table_number ?? null,
          slot_start: m.slot_id ? slotMap.get(m.slot_id as string) ?? null : null,
          status: canonicalStatus,
          checkin_status: checkMap.get(m.id as string) ?? null,
        };
      });
      meetingsDetail.sort((a, b) => (a.slot_start ?? "").localeCompare(b.slot_start ?? ""));

      const doneCount = meetingsDetail.filter((m) => m.status === "done").length;
      const noShowCount = meetingsDetail.filter((m) => m.status === "no_show").length;
      const pendingCount = meetingsDetail.filter((m) => m.status !== "done" && m.status !== "no_show").length;

      return {
        profile_id: p.id as string,
        full_name: p.full_name as string,
        email: p.email as string,
        company: p.company_id ? compMap.get(p.company_id) ?? null : null,
        sent_at: tok?.sent_at ?? null,
        first_opened_at: tok?.first_opened_at ?? null,
        submitted_at: tok?.submitted_at ?? null,
        survey: survey
          ? {
              overall_rating: (survey as any).overall_rating ?? null,
              meetings_quality: (survey as any).meetings_quality ?? null,
              next_edition_interest: (survey as any).next_edition_interest ?? null,
              comments: (survey as any).comments ?? null,
              created_at: (survey as any).created_at ?? null,
            }
          : null,
        meetings: meetingsDetail,
        meetings_done: doneCount,
        meetings_no_show: noShowCount,
        meetings_pending: pendingCount,
      };
    });
    rows.sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? "", "pt-BR"));

    // Aggregate metrics
    const sentCount = (tokens ?? []).filter((t) => !!t.sent_at).length;
    const openedCount = (tokens ?? []).filter((t) => !!t.first_opened_at).length;
    const submittedCount = (tokens ?? []).filter((t) => !!t.submitted_at).length;
    const responseRate = sentCount > 0 ? submittedCount / sentCount : 0;

    let meetingsDone = 0;
    let meetingsNoShow = 0;
    let meetingsPending = 0;
    for (const m of (mtgs ?? [])) {
      if (m.status === "done") meetingsDone++;
      else if (m.status === "no_show") meetingsNoShow++;
      else meetingsPending++;
    }

    const ratings = (surveys ?? [])
      .map((s: any) => s.overall_rating as number | null)
      .filter((v): v is number => typeof v === "number");
    const qualities = (surveys ?? [])
      .map((s: any) => s.meetings_quality as number | null)
      .filter((v): v is number => typeof v === "number");
    const overallRatingAvg = ratings.length
      ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 100) / 100
      : null;
    const meetingsQualityAvg = qualities.length
      ? Math.round((qualities.reduce((a, b) => a + b, 0) / qualities.length) * 100) / 100
      : null;

    const nextEdition = { yes: 0, maybe: 0, no: 0 };
    for (const s of (surveys ?? []) as any[]) {
      const v = s.next_edition_interest as "yes" | "maybe" | "no" | null;
      if (v === "yes" || v === "maybe" || v === "no") nextEdition[v]++;
    }

    return {
      eventId,
      metrics: {
        eligible: profileIds.length,
        sent: sentCount,
        opened: openedCount,
        submitted: submittedCount,
        responseRate,
        meetingsDone,
        meetingsNoShow,
        meetingsPending,
        overallRatingAvg,
        meetingsQualityAvg,
        nextEdition,
      },
      rows,
    };
  });