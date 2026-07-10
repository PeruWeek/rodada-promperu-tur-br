/**
 * White-label theme + i18n runtime helpers.
 *
 * `buildThemeCss` renders a small `<style>` block that overrides the base
 * CSS variables from `styles.css` with the palette editable in
 * `Admin > Branding`. Values must be validated to avoid CSS injection.
 *
 * `applyContentOverrides` re-registers the per-language i18n bundles
 * stored in `site_configs.content_overrides` so the components using
 * `t("landing.heroTitle")` render the site-specific copy without touching
 * the shipped translation files.
 */
import type { i18n as I18n } from "i18next";

const TOKEN_TO_CSS_VAR: Record<string, string> = {
  primary: "--primary",
  primaryForeground: "--primary-foreground",
  secondary: "--secondary",
  secondaryForeground: "--secondary-foreground",
  accent: "--accent",
  accentForeground: "--accent-foreground",
  background: "--background",
  foreground: "--foreground",
  card: "--card",
  cardForeground: "--card-foreground",
  muted: "--muted",
  mutedForeground: "--muted-foreground",
  border: "--border",
  ring: "--ring",
};

export const THEME_TOKEN_KEYS = Object.keys(TOKEN_TO_CSS_VAR);

// Only accept simple hex / rgb / hsl / oklch color literals — anything with
// characters that could break out of a CSS declaration is rejected.
const SAFE_COLOR_RE = /^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla|oklch|oklab|color)\([^;{}"'<>\\]+\))$/;

export function isSafeCssColor(value: unknown): value is string {
  return typeof value === "string" && value.length <= 80 && SAFE_COLOR_RE.test(value.trim());
}

export function buildThemeCss(tokens: Record<string, string> | null | undefined): string {
  if (!tokens) return "";
  const decls: string[] = [];
  for (const [key, val] of Object.entries(tokens)) {
    const cssVar = TOKEN_TO_CSS_VAR[key];
    if (!cssVar || !isSafeCssColor(val)) continue;
    decls.push(`${cssVar}:${val};`);
  }
  if (!decls.length) return "";
  return `:root{${decls.join("")}}`;
}

function setNested(obj: Record<string, unknown>, path: string, value: string) {
  const parts = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (typeof cur[p] !== "object" || cur[p] === null) cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

/**
 * Convert `{ "landing.heroTitle": "..." }` → `{ landing: { heroTitle: "..." } }`
 * and merge it into the i18next resource bundle for each configured language.
 * Idempotent — safe to call on every mount / language change.
 */
export function applyContentOverrides(
  i18n: I18n,
  overrides: Record<string, Record<string, string>> | null | undefined,
) {
  if (!overrides) return;
  for (const [lng, flat] of Object.entries(overrides)) {
    if (!flat || typeof flat !== "object") continue;
    const nested: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(flat)) {
      if (typeof val !== "string" || !val.trim()) continue;
      setNested(nested, key, val);
    }
    if (Object.keys(nested).length) {
      i18n.addResourceBundle(lng, "translation", nested, true, true);
    }
  }
}

/**
 * Curated list of i18n keys exposed in the Admin > Branding text editor.
 * Kept intentionally small — this is not a full CMS.
 */
export const EDITABLE_CONTENT_KEYS: Array<{ key: string; label: string; multiline?: boolean }> = [
  { key: "common.appName", label: "Nome do app" },
  { key: "common.tagline", label: "Tagline" },
  { key: "landing.heroEyebrow", label: "Landing — eyebrow (data/local)" },
  { key: "landing.heroTitle", label: "Landing — título principal", multiline: true },
  { key: "landing.heroSubtitle", label: "Landing — subtítulo", multiline: true },
  { key: "landing.ctaSignup", label: "Landing — CTA primário" },
  { key: "landing.ctaLogin", label: "Landing — CTA secundário" },
  { key: "landing.howTitle", label: "Landing — seção 'como funciona'" },
  { key: "landing.scheduleTitle", label: "Landing — título da programação" },
  { key: "landing.venueTitle", label: "Landing — título do local" },
  { key: "landing.venueDate", label: "Landing — data do evento" },
  { key: "landing.venueName", label: "Landing — nome do local" },
  { key: "landing.venueAddress", label: "Landing — endereço" },
  { key: "auth.loginTitle", label: "Login — título" },
  { key: "auth.loginSubtitle", label: "Login — subtítulo" },
  { key: "auth.signupTitle", label: "Signup — título" },
  { key: "auth.signupSubtitle", label: "Signup — subtítulo" },
];

export const EDITABLE_LANGUAGES: Array<{ code: string; label: string }> = [
  { code: "pt-BR", label: "Português (Brasil)" },
  { code: "es", label: "Español" },
];