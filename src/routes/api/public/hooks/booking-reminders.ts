import { createFileRoute } from "@tanstack/react-router";

/**
 * Public cron hook for the booking-reminders job. Runs every hour via pg_cron;
 * decides internally whether to fire (settings.enabled + hour-in-tz + once/day).
 * The /api/public/* prefix bypasses auth; we still require the Authorization
 * bearer present (any value) so randomly-hit URLs are no-ops.
 */
export const Route = createFileRoute("/api/public/hooks/booking-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!request.headers.get("authorization")) {
          return new Response(
            JSON.stringify({ error: "missing_authorization" }),
            { status: 401, headers: { "Content-Type": "application/json" } },
          );
        }
        try {
          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );
          const { shouldRunNow, runBookingReminders } = await import(
            "@/lib/booking-reminders.server"
          );

          const decision = await shouldRunNow(supabaseAdmin);
          if (!decision.run) {
            return Response.json({ ok: true, skipped: decision.reason });
          }
          const summary = await runBookingReminders(supabaseAdmin, { mode: "auto" });
          return Response.json({ ok: true, summary });
        } catch (err) {
          console.error("[booking-reminders] cron failed", err);
          return Response.json(
            { ok: false, error: err instanceof Error ? err.message : String(err) },
            { status: 500 },
          );
        }
      },
    },
  },
});