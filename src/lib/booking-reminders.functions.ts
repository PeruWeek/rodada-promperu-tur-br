import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const ok = (data ?? []).some((r) => r.role === "admin");
  if (!ok) throw new Error("Forbidden: admin only");
}

export const getBookingReminderSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("booking_reminder_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

const SettingsSchema = z.object({
  enabled: z.boolean().optional(),
  run_hour: z.number().int().min(0).max(23).optional(),
  timezone: z.string().min(1).max(64).optional(),
  max_reminders_per_event: z.number().int().min(1).max(20).optional(),
  min_interval_hours: z.number().int().min(1).max(720).optional(),
  event_scope: z.string().uuid().nullable().optional(),
});

export const updateBookingReminderSettings = createServerFn({ method: "POST" })
  .inputValidator((i) => SettingsSchema.parse(i))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: updated, error } = await supabaseAdmin
      .from("booking_reminder_settings")
      .update({ ...data, updated_by: context.userId })
      .eq("id", 1)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return updated;
  });

export const runBookingRemindersNow = createServerFn({ method: "POST" })
  .inputValidator((i) =>
    z
      .object({ dryRun: z.boolean().optional() })
      .parse(i ?? {}),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runBookingReminders } = await import("@/lib/booking-reminders.server");
    const summary = await runBookingReminders(supabaseAdmin, {
      mode: "manual",
      dryRun: data.dryRun === true,
    });
    return summary;
  });

const HistorySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  runId: z.string().uuid().optional(),
  eventId: z.string().uuid().optional(),
  status: z.enum(["sent", "queued", "skipped", "error"]).optional(),
  mode: z.enum(["auto", "manual"]).optional(),
  query: z.string().max(120).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

export const listBookingReminderHistory = createServerFn({ method: "POST" })
  .inputValidator((i) => HistorySchema.parse(i ?? {}))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("booking_reminder_log")
      .select(
        "id, run_id, event_id, profile_id, recipient_email, sent_at, status, mode, language, error_reason, skip_reason, idempotency_key, metadata",
      )
      .order("sent_at", { ascending: false })
      .limit(data.limit ?? 200);

    if (data.runId) q = q.eq("run_id", data.runId);
    if (data.from) q = q.gte("sent_at", data.from);
    if (data.to) q = q.lte("sent_at", data.to);
    if (data.eventId) q = q.eq("event_id", data.eventId);
    if (data.status) q = q.eq("status", data.status);
    if (data.mode) q = q.eq("mode", data.mode);
    if (data.query) q = q.ilike("recipient_email", `%${data.query}%`);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const profileIds = Array.from(
      new Set((rows ?? []).map((r) => r.profile_id).filter(Boolean) as string[]),
    );
    const eventIds = Array.from(
      new Set((rows ?? []).map((r) => r.event_id).filter(Boolean) as string[]),
    );

    const [{ data: profiles }, { data: events }] = await Promise.all([
      profileIds.length
        ? supabaseAdmin.from("profiles").select("id, full_name, email").in("id", profileIds)
        : Promise.resolve({ data: [] as any[] }),
      eventIds.length
        ? supabaseAdmin.from("events").select("id, name").in("id", eventIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
    const eventMap = new Map((events ?? []).map((e) => [e.id, e]));

    // Count sent reminders per (profile, event) across the whole log
    const sentCount = new Map<string, number>();
    if (profileIds.length && eventIds.length) {
      const { data: sentRows } = await supabaseAdmin
        .from("booking_reminder_log")
        .select("profile_id, event_id")
        .eq("status", "sent")
        .in("profile_id", profileIds)
        .in("event_id", eventIds);
      for (const r of sentRows ?? []) {
        const k = `${r.profile_id}::${r.event_id}`;
        sentCount.set(k, (sentCount.get(k) ?? 0) + 1);
      }
    }

    const items = (rows ?? []).map((r) => {
      const p = r.profile_id ? profileMap.get(r.profile_id) : null;
      const ev = r.event_id ? eventMap.get(r.event_id) : null;
      return {
        id: r.id,
        run_id: r.run_id ?? null,
        sent_at: r.sent_at,
        event_id: r.event_id,
        event_name: ev?.name ?? null,
        profile_id: r.profile_id,
        user_name: p?.full_name ?? null,
        recipient_email: r.recipient_email,
        language: r.language ?? null,
        mode: r.mode ?? null,
        status: r.status ?? "sent",
        skip_reason: r.skip_reason ?? null,
        error_reason: r.error_reason ?? null,
        metadata: (r as any).metadata ?? null,
        sent_count_for_user_event:
          sentCount.get(`${r.profile_id}::${r.event_id}`) ?? 0,
      };
    });

    return { items, eventsAvailable: events ?? [] };
  });

export const listBookingReminderEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("events")
      .select("id, name")
      .order("created_at", { ascending: false });
    return data ?? [];
  });