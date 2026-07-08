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

function generateToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
        profileIds: z.array(z.string().uuid()).min(1).max(25),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    if (!(await isAdminOrStaff(context.userId)))
      throw new Error("Forbidden: admin/staff only");
    const eventId = await loadLatestEventId(data.eventId ?? null);
    if (!eventId) throw new Error("No event found");

    // Only allow profiles actually present in general_checkins for the event.
    const { data: chks } = await supabaseAdmin
      .from("general_checkins")
      .select("profile_id")
      .eq("event_id", eventId)
      .in("profile_id", data.profileIds);
    const eligibleSet = new Set((chks ?? []).map((c) => c.profile_id as string));
    const eligibleIds = data.profileIds.filter((id) => eligibleSet.has(id));
    if (!eligibleIds.length) return { sent: 0, skipped: data.profileIds.length };

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

    let sent = 0;
    let failed = 0;
    for (const p of profs ?? []) {
      if (!p.email) {
        failed++;
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
        token = generateToken();
        const { data: inserted, error: insErr } = await supabaseAdmin
          .from("postevent_qa_tokens")
          .insert({ event_id: eventId, profile_id: p.id, token } as never)
          .select("id")
          .single();
        if (insErr) {
          failed++;
          continue;
        }
        tokenRowId = inserted.id as string;
      }

      const qaUrl = `${SITE_URL}/qa/${token}`;
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
        failed++;
      }
    }
    return { sent, failed, eligible: eligibleIds.length };
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