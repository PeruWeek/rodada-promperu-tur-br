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
    const patch: Record<string, unknown> = { ...data, updated_by: context.userId };
    const { data: updated, error } = await supabaseAdmin
      .from("booking_reminder_settings")
      .update(patch)
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