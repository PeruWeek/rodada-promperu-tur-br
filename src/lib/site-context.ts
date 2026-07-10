/**
 * White-label site context — types + client helpers.
 *
 * The full context is resolved server-side by `getSiteContext` in
 * `site-context.functions.ts` (reads the request Host header, falls back to
 * `VITE_SITE_SLUG` env, then to `is_default = true`) and returned by the
 * `__root` loader. Anywhere in the tree, call `useSiteContext()` to read
 * branding, SEO defaults, canonical URL, e-mail sender and the active
 * event id. Never hardcode PromPerú, `rodada.promperu.tur.br` or per-event
 * copy — read this context instead.
 */
import { useRouteContext } from "@tanstack/react-router";

export type SiteContext = {
  id: string;
  slug: string;
  hostname: string;
  altHostnames: string[];
  isDefault: boolean;
  activeEventId: string | null;
  name: string;
  tagline: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
  siteUrl: string; // canonical, no trailing slash
  emailFromName: string | null;
  emailFromAddress: string | null;
  emailReplyTo: string | null;
  footerText: string | null;
  eventDisplayName: string | null;
  eventDisplayDate: string | null;
};

/**
 * Fallback used only when the database is unreachable during SSR — keeps
 * the shell renderable. All real values come from `site_configs`.
 */
export const FALLBACK_SITE_CONTEXT: SiteContext = {
  id: "fallback",
  slug: "fallback",
  hostname: "localhost",
  altHostnames: [],
  isDefault: true,
  activeEventId: null,
  name: "Networking",
  tagline: null,
  logoUrl: null,
  faviconUrl: null,
  primaryColor: null,
  secondaryColor: null,
  metaDescription: null,
  ogImageUrl: null,
  siteUrl: "",
  emailFromName: null,
  emailFromAddress: null,
  emailReplyTo: null,
  footerText: null,
  eventDisplayName: null,
  eventDisplayDate: null,
};

/**
 * Reads the site context injected into the router context by the `__root`
 * beforeLoad. Never throws — falls back to FALLBACK_SITE_CONTEXT so a
 * client component in error boundaries still renders.
 */
export function useSiteContext(): SiteContext {
  const ctx = useRouteContext({ from: "__root__" }) as { site?: SiteContext };
  return ctx.site ?? FALLBACK_SITE_CONTEXT;
}