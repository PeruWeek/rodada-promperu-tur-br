/**
 * Server-only white-label site resolver, shared by e-mail helpers, server
 * functions and server routes.
 *
 * The `getSiteContext` server function (site-context.functions.ts) is meant
 * to be called from routers / loaders. Everything else — enqueue routes,
 * background jobs, admin server functions, PDF generation — should call
 * `resolveSiteContext()` from here. It:
 *
 *   1. Reads the current request Host header (when there is one).
 *   2. Falls back to `VITE_SITE_SLUG` / `SITE_SLUG` env vars.
 *   3. Falls back to `is_default = true` in site_configs.
 *
 * Result is cached per-process for 60s so the queue processor doesn't
 * hammer the DB.
 *
 * Uses service-role because it is invoked from server-only paths that need
 * the row regardless of RLS surface (site_configs has public SELECT anyway,
 * so this is a convenience, not a privilege escalation).
 */
import { getRequest } from "@tanstack/react-start/server";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { FALLBACK_SITE_CONTEXT, type SiteContext } from "./site-context";

type Row = Database["public"]["Tables"]["site_configs"]["Row"];

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; site: SiteContext }>();

function rowToContext(row: Row): SiteContext {
  return {
    id: row.id,
    slug: row.slug,
    hostname: row.hostname,
    altHostnames: row.alt_hostnames ?? [],
    isDefault: row.is_default,
    activeEventId: row.active_event_id,
    name: row.name,
    tagline: row.tagline,
    logoUrl: row.logo_url,
    faviconUrl: row.favicon_url,
    primaryColor: row.primary_color,
    secondaryColor: row.secondary_color,
    metaDescription: row.meta_description,
    ogImageUrl: row.og_image_url,
    siteUrl: (row.site_url ?? "").replace(/\/+$/, ""),
    emailFromName: row.email_from_name,
    emailFromAddress: row.email_from_address,
    emailReplyTo: row.email_reply_to,
    footerText: row.footer_text,
    eventDisplayName: row.event_display_name,
    eventDisplayDate: row.event_display_date,
    themeTokens: (row.theme_tokens as Record<string, string> | null) ?? {},
    contentOverrides:
      (row.content_overrides as Record<string, Record<string, string>> | null) ?? {},
  };
}

function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw.split(":")[0].toLowerCase().trim() || null;
}

function currentHost(): string | null {
  try {
    const req = getRequest();
    return normalizeHost(
      req.headers.get("x-forwarded-host") ?? req.headers.get("host"),
    );
  } catch {
    return null;
  }
}

async function loadByHost(host: string): Promise<SiteContext | null> {
  const { data } = await supabaseAdmin
    .from("site_configs")
    .select("*")
    .or(`hostname.eq.${host},alt_hostnames.cs.{${host}}`)
    .limit(1)
    .maybeSingle();
  return data ? rowToContext(data as Row) : null;
}

async function loadBySlug(slug: string): Promise<SiteContext | null> {
  const { data } = await supabaseAdmin
    .from("site_configs")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  return data ? rowToContext(data as Row) : null;
}

async function loadDefault(): Promise<SiteContext | null> {
  const { data } = await supabaseAdmin
    .from("site_configs")
    .select("*")
    .eq("is_default", true)
    .limit(1)
    .maybeSingle();
  return data ? rowToContext(data as Row) : null;
}

/**
 * Resolve the active site for the current server call. Cached per-process.
 * Never throws — falls back to `FALLBACK_SITE_CONTEXT` so callers always
 * have a shape to work with.
 */
export async function resolveSiteContext(
  opts: { hostname?: string | null } = {},
): Promise<SiteContext> {
  const host = normalizeHost(opts.hostname) ?? currentHost();
  const envSlug = process.env.VITE_SITE_SLUG || process.env.SITE_SLUG || null;
  const key = host ? `host:${host}` : envSlug ? `slug:${envSlug}` : "default";

  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.site;

  let site: SiteContext | null = null;
  if (host) site = await loadByHost(host);
  if (!site && envSlug) site = await loadBySlug(envSlug);
  if (!site) site = await loadDefault();
  const resolved = site ?? FALLBACK_SITE_CONTEXT;
  cache.set(key, { at: Date.now(), site: resolved });
  return resolved;
}

/**
 * Build an absolute URL against the current site. Prefer this over any
 * hardcoded `https://rodada.promperu.tur.br` string in server code.
 */
export async function siteUrl(path: string = "/"): Promise<string> {
  const site = await resolveSiteContext();
  const base = (site.siteUrl || "").replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${suffix}` : suffix;
}

/**
 * Preferred display name for the active event (falls back to site name).
 */
export async function siteEventName(): Promise<string> {
  const site = await resolveSiteContext();
  return site.eventDisplayName || site.name;
}
