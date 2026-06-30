// Lightweight, privacy-aware telemetry for the signup funnel.
// Goal: differentiate UX hesitation vs validation blocks vs technical errors
// vs abandonment on the first signup step ("Conta"), without logging
// passwords or raw e-mails.
//
// Channels:
//   - Microsoft Clarity custom events / tags (already loaded in __root.tsx).
//   - Structured console.info (visible in browser logs + Clarity replay).
// Both are no-ops in SSR or when Clarity is blocked.

declare global {
  interface Window {
    clarity?: (...args: unknown[]) => void;
  }
}

export type SignupAccountEvent =
  | "signup_step_account_viewed"
  | "signup_email_started"
  | "signup_password_started"
  | "signup_password_rule_failed"
  | "signup_password_rule_passed"
  | "signup_confirm_password_started"
  | "signup_continue_clicked"
  | "signup_step_account_validation_failed"
  | "signup_step_account_completed"
  | "signup_abandoned_on_account_step";

export type SignupBlockReason =
  | "missing_email"
  | "invalid_email"
  | "missing_password"
  | "weak_password"
  | "password_mismatch"
  | "missing_confirm_password"
  | "unknown_validation_error";

function maskEmail(email: string): string {
  const e = email.trim();
  if (!e) return "";
  const at = e.indexOf("@");
  if (at <= 0) return "***";
  const user = e.slice(0, at);
  const domain = e.slice(at + 1);
  const head = user.slice(0, 1);
  return `${head}***@${domain}`;
}

const sent = new Set<string>();

export function trackSignupAccount(
  event: SignupAccountEvent,
  details?: {
    reason?: SignupBlockReason | SignupBlockReason[];
    field?: string;
    attempt?: number;
    timeOnStepMs?: number;
    hasEmail?: boolean;
    email?: string; // will be masked
    once?: boolean;
  },
) {
  if (typeof window === "undefined") return;
  const onceKey = details?.once ? `${event}` : null;
  if (onceKey && sent.has(onceKey)) return;
  if (onceKey) sent.add(onceKey);

  const payload: Record<string, unknown> = { event };
  if (details?.reason) payload.reason = details.reason;
  if (details?.field) payload.field = details.field;
  if (typeof details?.attempt === "number") payload.attempt = details.attempt;
  if (typeof details?.timeOnStepMs === "number") payload.time_on_step_ms = details.timeOnStepMs;
  if (typeof details?.hasEmail === "boolean") payload.has_email = details.hasEmail;
  if (details?.email) payload.email_masked = maskEmail(details.email);

  try {
    window.clarity?.("event", event);
    if (details?.reason) {
      const r = Array.isArray(details.reason) ? details.reason.join(",") : details.reason;
      window.clarity?.("set", "signup_block_reason", r);
    }
    if (details?.field) {
      window.clarity?.("set", "signup_last_field", details.field);
    }
  } catch {
    /* Clarity is best-effort */
  }

  console.info("[signup-telemetry]", payload);
}

export function resetSignupTelemetrySession() {
  sent.clear();
}
