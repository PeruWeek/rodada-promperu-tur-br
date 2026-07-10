import type { SupabaseClient } from "@supabase/supabase-js";
import { processTransactionalSend } from "@/lib/email-send.server";
import { siteUrl } from "@/lib/site-context.server";

const MIN_SIGNUP_AGE_HOURS = 24;

export type BookingReminderMode = "auto" | "manual";

export interface BookingReminderSummary {
  run_id: string;
  event_id: string | null;
  mode: BookingReminderMode;
  evaluated: number;
  eligible: number;
  sent: number;
  skipped_has_meeting: number;
  skipped_limit: number;
  skipped_interval: number;
  skipped_recent_signup: number;
  errors: number;
  finished_at: string;
  error_details?: Array<{ profile_id: string; reason: string }>;
  dry_run?: boolean;
}

interface SettingsRow {
  enabled: boolean;
  run_hour: number;
  timezone: string;
  max_reminders_per_event: number;
  min_interval_hours: number;
  event_scope: string | null;
}

async function getSettings(supabase: SupabaseClient<any>): Promise<SettingsRow | null> {
  const { data } = await supabase
    .from("booking_reminder_settings")
    .select(
      "enabled, run_hour, timezone, max_reminders_per_event, min_interval_hours, event_scope",
    )
    .eq("id", 1)
    .maybeSingle();
  return (data as SettingsRow | null) ?? null;
}

async function resolveEventId(
  supabase: SupabaseClient<any>,
  scope: string | null,
): Promise<string | null> {
  if (scope) return scope;
  const { data } = await supabase
    .from("events")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

function currentHourInTz(tz: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const h = parts.find((p) => p.type === "hour")?.value;
    if (h == null) return null;
    const n = parseInt(h, 10);
    return Number.isFinite(n) ? n % 24 : null;
  } catch {
    return null;
  }
}

function dayBucketUTC(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Decide whether the cron should fire now based on persisted settings.
 * Returns the matched settings on success, or a reason string when skipped.
 */
export async function shouldRunNow(
  supabase: SupabaseClient<any>,
): Promise<
  | { run: true; settings: SettingsRow }
  | { run: false; reason: string; settings: SettingsRow | null }
> {
  const settings = await getSettings(supabase);
  if (!settings) return { run: false, reason: "settings_missing", settings: null };
  if (!settings.enabled) return { run: false, reason: "disabled", settings };
  const hourNow = currentHourInTz(settings.timezone);
  if (hourNow == null) return { run: false, reason: "invalid_timezone", settings };
  if (hourNow !== settings.run_hour) {
    return { run: false, reason: "outside_window", settings };
  }
  // Idempotent per-day guard via last_run_at.
  const { data: row } = await supabase
    .from("booking_reminder_settings")
    .select("last_run_at")
    .eq("id", 1)
    .maybeSingle();
  if (row?.last_run_at) {
    const last = new Date(row.last_run_at as string);
    const lastBucket = last.toISOString().slice(0, 10);
    if (lastBucket === dayBucketUTC()) {
      return { run: false, reason: "already_ran_today", settings };
    }
  }
  return { run: true, settings };
}

interface RunOptions {
  mode: BookingReminderMode;
  dryRun?: boolean;
  /** Override the persisted settings (manual trigger from admin UI). */
  overrideSettings?: Partial<SettingsRow>;
}

/**
 * Core reminder pipeline used by both the cron route and the admin manual trigger.
 * Caller is responsible for authorization. Always uses an admin-capable client
 * because it needs to read auth-only data (visitor_profiles, profiles.email) and
 * write to booking_reminder_log.
 */
export async function runBookingReminders(
  supabaseAdmin: SupabaseClient<any>,
  options: RunOptions,
): Promise<BookingReminderSummary> {
  const runId = crypto.randomUUID();
  const persisted = (await getSettings(supabaseAdmin)) ?? ({
    enabled: true,
    run_hour: 10,
    timezone: "America/Sao_Paulo",
    max_reminders_per_event: 3,
    min_interval_hours: 24,
    event_scope: null,
  } as SettingsRow);
  const settings: SettingsRow = { ...persisted, ...(options.overrideSettings ?? {}) };

  const summary: BookingReminderSummary = {
    run_id: runId,
    event_id: null,
    mode: options.mode,
    evaluated: 0,
    eligible: 0,
    sent: 0,
    skipped_has_meeting: 0,
    skipped_limit: 0,
    skipped_interval: 0,
    skipped_recent_signup: 0,
    errors: 0,
    finished_at: new Date().toISOString(),
    error_details: [],
    dry_run: options.dryRun === true,
  };

  const eventId = await resolveEventId(supabaseAdmin, settings.event_scope);
  summary.event_id = eventId;
  if (!eventId) {
    summary.finished_at = new Date().toISOString();
    await persistSummary(supabaseAdmin, summary);
    return summary;
  }

  // 1. Find visitor_profiles with signup_completed_at older than threshold.
  const cutoff = new Date(Date.now() - MIN_SIGNUP_AGE_HOURS * 3600 * 1000).toISOString();

  const { data: vps, error: vpErr } = await supabaseAdmin
    .from("visitor_profiles")
    .select("profile_id, signup_completed_at")
    .not("signup_completed_at", "is", null);
  if (vpErr) {
    summary.errors += 1;
    summary.error_details!.push({ profile_id: "*", reason: vpErr.message });
    await persistSummary(supabaseAdmin, summary);
    return summary;
  }

  const recentSignupIds = new Set<string>();
  const candidateIds: string[] = [];
  for (const v of vps ?? []) {
    summary.evaluated += 1;
    if (!v.signup_completed_at || v.signup_completed_at > cutoff) {
      summary.skipped_recent_signup += 1;
      recentSignupIds.add(v.profile_id as string);
      continue;
    }
    candidateIds.push(v.profile_id as string);
  }

  if (candidateIds.length === 0) {
    await persistSummary(supabaseAdmin, summary);
    return summary;
  }

  // 2. Pull profile data (must have company + email).
  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, email, preferred_language, company_id, is_active")
    .in("id", candidateIds);

  const profilesWithCompany = (profiles ?? []).filter(
    (p) => p.company_id && p.email && p.is_active !== false,
  );
  const profileIds = profilesWithCompany.map((p) => p.id as string);
  if (profileIds.length === 0) {
    await persistSummary(supabaseAdmin, summary);
    return summary;
  }

  // 3. Exclude those with any scheduled meeting in this event.
  // Regra global de agendamento (src/lib/scheduling-status.ts): só envia
  // lembrete para empresas com `scheduled_meetings_count = 0`. Ausência de
  // qualquer `meetings.status='scheduled'` neste evento equivale a count = 0.
  const { data: meetings } = await supabaseAdmin
    .from("meetings")
    .select("visitor_profile_id")
    .eq("event_id", eventId)
    .eq("status", "scheduled")
    .in("visitor_profile_id", profileIds);
  // Conta por perfil (count real). Bloqueia qualquer envio para count > 0.
  const meetingCountByProfile = new Map<string, number>();
  for (const m of meetings ?? []) {
    const pid = m.visitor_profile_id as string;
    meetingCountByProfile.set(pid, (meetingCountByProfile.get(pid) ?? 0) + 1);
  }
  const withMeeting = new Set(meetingCountByProfile.keys());

  // 4. Pull reminder history for this event for the candidates.
  const { data: history } = await supabaseAdmin
    .from("booking_reminder_log")
    .select("profile_id, sent_at")
    .eq("event_id", eventId)
    .in("profile_id", profileIds);
  const historyByProfile = new Map<string, { count: number; lastSent: number }>();
  for (const h of history ?? []) {
    const pid = h.profile_id as string;
    const cur = historyByProfile.get(pid) ?? { count: 0, lastSent: 0 };
    cur.count += 1;
    const ts = new Date(h.sent_at as string).getTime();
    if (ts > cur.lastSent) cur.lastSent = ts;
    historyByProfile.set(pid, cur);
  }

  const minIntervalMs = settings.min_interval_hours * 3600 * 1000;
  const nowTs = Date.now();

  // 5. Process each eligible profile.
  for (const p of profilesWithCompany) {
    const pid = p.id as string;
    // Guarda defensiva: count > 0 ⇒ NUNCA envia lembrete.
    const meetingsCount = meetingCountByProfile.get(pid) ?? 0;
    if (meetingsCount > 0 || withMeeting.has(pid)) {
      summary.skipped_has_meeting += 1;
      const language = (p.preferred_language as string | null) === "es" ? "es" : "pt-BR";
      await supabaseAdmin.from("booking_reminder_log").insert({
        run_id: runId,
        event_id: eventId,
        profile_id: pid,
        recipient_email: p.email as string,
        reminder_type: "booking-reminder",
        idempotency_key: `skip-has-meeting-${options.mode}-${eventId}-${pid}-${new Date().toISOString()}`,
        status: "skipped",
        mode: options.mode,
        language,
        skip_reason: "has_scheduled_meeting",
        metadata: {
          run_id: runId,
          mode: options.mode,
          language,
          reason: "has_scheduled_meeting",
          scheduled_meetings_count: meetingsCount,
        },
      });
      continue;
    }
    const hist = historyByProfile.get(pid);
    const language = (p.preferred_language as string | null) === "es" ? "es" : "pt-BR";
    const dayKey = dayBucketUTC();
    if (hist) {
      if (hist.count >= settings.max_reminders_per_event) {
        summary.skipped_limit += 1;
        await supabaseAdmin.from("booking_reminder_log").insert({
          run_id: runId,
          event_id: eventId,
          profile_id: pid,
          recipient_email: p.email as string,
          reminder_type: "booking-reminder",
          idempotency_key: `skip-limit-${options.mode}-${eventId}-${pid}-${new Date().toISOString()}`,
          status: "skipped",
          mode: options.mode,
          language,
          skip_reason: "max_reminders_reached",
          metadata: { run_id: runId, mode: options.mode, language, reason: "max_reminders_reached" },
        });
        continue;
      }
      if (nowTs - hist.lastSent < minIntervalMs) {
        summary.skipped_interval += 1;
        const lastSentIso = new Date(hist.lastSent).toISOString();
        const nextEligibleIso = new Date(hist.lastSent + minIntervalMs).toISOString();
        await supabaseAdmin.from("booking_reminder_log").insert({
          run_id: runId,
          event_id: eventId,
          profile_id: pid,
          recipient_email: p.email as string,
          reminder_type: "booking-reminder",
          idempotency_key: `skip-interval-${options.mode}-${eventId}-${pid}-${new Date().toISOString()}`,
          status: "skipped",
          mode: options.mode,
          language,
          skip_reason: "min_interval_not_elapsed",
          metadata: {
            run_id: runId,
            mode: options.mode,
            language,
            reason: "min_interval_not_elapsed",
            last_sent_at: lastSentIso,
            min_interval_hours: settings.min_interval_hours,
            next_eligible_at: nextEligibleIso,
          },
        });
        continue;
      }
    }
    summary.eligible += 1;

    if (options.dryRun) continue;

    const fullName = (p.full_name as string | null) ?? "";
    const firstName = fullName.trim().split(/\s+/)[0] ?? "";
    const idempotencyKey = `booking-reminder-${eventId}-${pid}-${dayKey}`;

    // Pre-insert log row to lock idempotency BEFORE send. UNIQUE on idempotency_key
    // returns a conflict if a concurrent run already processed this profile today.
    const { error: logErr } = await supabaseAdmin
      .from("booking_reminder_log")
      .insert({
        run_id: runId,
        event_id: eventId,
        profile_id: pid,
        recipient_email: p.email as string,
        reminder_type: "booking-reminder",
        idempotency_key: idempotencyKey,
        status: "queued",
        mode: options.mode,
        language,
        metadata: { run_id: runId, mode: options.mode, language },
      });
    if (logErr) {
      // Duplicate idempotency = already processed today.
      // Leave a visible audit row so manual re-runs show up in the history.
      if ((logErr as any).code === "23505") {
        summary.skipped_interval += 1;
        await supabaseAdmin.from("booking_reminder_log").insert({
          run_id: runId,
          event_id: eventId,
          profile_id: pid,
          recipient_email: p.email as string,
          reminder_type: "booking-reminder",
          idempotency_key: `skip-dup-${options.mode}-${eventId}-${pid}-${new Date().toISOString()}`,
          status: "skipped",
          mode: options.mode,
          language,
          skip_reason: "already_processed_today",
          metadata: { run_id: runId, mode: options.mode, language, reason: "already_processed_today" },
        });
        continue;
      }
      summary.errors += 1;
      summary.error_details!.push({ profile_id: pid, reason: logErr.message });
      continue;
    }

    try {
      const agendaUrl = await siteUrl("/agenda");
      const forgotUrl = await siteUrl("/forgot-password");
      const result = await processTransactionalSend(supabaseAdmin, {
        templateName: "booking-reminder",
        recipientEmail: p.email as string,
        idempotencyKey,
        templateData: {
          language,
          visitorName: firstName,
          agendaUrl,
          forgotPasswordUrl: forgotUrl,
        },
      });
      if (result.status >= 200 && result.status < 300) {
        summary.sent += 1;
        await supabaseAdmin
          .from("booking_reminder_log")
          .update({ status: "sent" })
          .eq("idempotency_key", idempotencyKey);
      } else {
        summary.errors += 1;
        summary.error_details!.push({
          profile_id: pid,
          reason: `send_failed_${result.status}`,
        });
        // Mark as error and keep row for operator visibility. Day-level
        // idempotency still blocks retries within the same day.
        await supabaseAdmin
          .from("booking_reminder_log")
          .update({ status: "error", error_reason: `send_failed_${result.status}` })
          .eq("idempotency_key", idempotencyKey);
      }
    } catch (err) {
      summary.errors += 1;
      const reason = err instanceof Error ? err.message : String(err);
      summary.error_details!.push({
        profile_id: pid,
        reason,
      });
      await supabaseAdmin
        .from("booking_reminder_log")
        .update({ status: "error", error_reason: reason })
        .eq("idempotency_key", idempotencyKey);
    }
  }

  summary.finished_at = new Date().toISOString();
  await persistSummary(supabaseAdmin, summary);
  return summary;
}

async function persistSummary(
  supabaseAdmin: SupabaseClient<any>,
  summary: BookingReminderSummary,
) {
  // Trim error_details to a sane size before persisting.
  const trimmed = {
    ...summary,
    error_details: (summary.error_details ?? []).slice(0, 25),
  };
  // IMPORTANT: keep auto and manual executions in separate columns so the UI
  // can show both unambiguously. `last_run_at` / `last_run_summary` = cron
  // only; `last_manual_run_at` / `last_manual_run_summary` = admin trigger
  // only. This prevents a manual run from overwriting the auto timestamp and
  // making the operator think the cron ran today.
  const patch: Record<string, unknown> = {};
  if (summary.mode === "auto") {
    patch.last_run_at = summary.finished_at;
    patch.last_run_summary = trimmed;
  } else {
    patch.last_manual_run_at = summary.finished_at;
    patch.last_manual_run_summary = trimmed;
  }
  await supabaseAdmin
    .from("booking_reminder_settings")
    .update(patch)
    .eq("id", 1);
}