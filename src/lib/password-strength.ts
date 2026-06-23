// Lightweight password strength + friendly auth-error helpers.
// Pure functions only — safe to import in any component.

// Small built-in blocklist of very common / obvious passwords (lowercased).
// Backend (Supabase) also rejects HIBP-leaked passwords; this list just
// catches the worst offenders before submit so the user gets fast feedback.
const COMMON_PASSWORDS = new Set([
  "password", "senha", "contrasena", "contraseña",
  "12345678", "123456789", "1234567890", "11111111", "00000000",
  "qwerty", "qwertyuiop", "qwerty123", "asdfghjkl",
  "abcdefgh", "abc12345", "iloveyou", "admin123", "administrator",
  "welcome1", "welcome123", "passw0rd", "p@ssw0rd", "senha123",
  "mudar123", "trocar123", "12345678a", "a12345678",
]);

export type PasswordCriterion =
  | "minLength"
  | "hasLower"
  | "hasUpper"
  | "hasNumber"
  | "hasSymbol"
  | "notCommon";

export type PasswordChecks = Record<PasswordCriterion, boolean>;

export function checkPassword(pw: string): PasswordChecks {
  const lower = pw.toLowerCase();
  const isCommon =
    COMMON_PASSWORDS.has(lower) ||
    /^(.)\1{5,}$/.test(pw) || // aaaaaa, 111111
    /^(0123|1234|2345|3456|4567|5678|6789|7890|abcd|qwer|asdf|zxcv)/i.test(pw);
  return {
    minLength: pw.length >= 8,
    hasLower: /[a-z]/.test(pw),
    hasUpper: /[A-Z]/.test(pw),
    hasNumber: /\d/.test(pw),
    hasSymbol: /[^A-Za-z0-9]/.test(pw),
    notCommon: pw.length > 0 && !isCommon,
  };
}

export type PasswordStrength = "empty" | "weak" | "medium" | "strong";

export function passwordStrength(pw: string): PasswordStrength {
  if (!pw) return "empty";
  const c = checkPassword(pw);
  if (!c.notCommon || !c.minLength) return "weak";
  const variety =
    Number(c.hasLower) + Number(c.hasUpper) + Number(c.hasNumber) + Number(c.hasSymbol);
  if (variety >= 4 && pw.length >= 12) return "strong";
  if (variety >= 3 && pw.length >= 10) return "strong";
  if (variety >= 2) return "medium";
  return "weak";
}

// Map a raw Supabase auth error message (often English, technical) into a
// friendly i18n key under `auth.errors.*`. Falls back to a generic key, and
// the caller can still surface the original message as a secondary hint.
export function friendlyAuthErrorKey(message: string | undefined | null): string {
  const m = (message || "").toLowerCase();
  if (!m) return "auth.errors.generic";
  if (m.includes("pwned") || m.includes("leaked") || m.includes("compromised") || m.includes("data breach"))
    return "auth.errors.passwordLeaked";
  if (m.includes("weak") || m.includes("too easy") || m.includes("common"))
    return "auth.errors.passwordWeak";
  if (m.includes("should be different from the old"))
    return "auth.errors.passwordSameAsOld";
  if (m.includes("at least") && m.includes("character"))
    return "auth.errors.passwordTooShort";
  if (m.includes("password") && (m.includes("invalid") || m.includes("requirement")))
    return "auth.errors.passwordWeak";
  return "auth.errors.generic";
}