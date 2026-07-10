/**
 * Server-side resolution of the current white-label site.
 *
 * Resolution order:
 *   1. Request `Host` header (SSR) or provided hostname (client refresh).
 *      Matches `site_configs.hostname` OR any entry in `alt_hostnames`.
 *   2. `VITE_SITE_SLUG` env fallback (useful for local dev and previews
 *      whose hostname is not yet registered).
 *   3. `is_default = true` row (guaranteed to exist by the seed migration).
 *
 * `site_configs` has a public SELECT policy — reads go through the server
 * publishable client, no bearer needed.
 */
import { createServerFn } from "@tanstack/react-start";
import { getHeaders } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { FALLBACK_SITE_CONTEXT, type SiteContext } from "./site-context";

function rowToContext(row: Database["public"]["Tables"]["site_configs"]["Row"]): SiteContext {
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
  };
}

function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // strip port
  return raw.split(":")[0].toLowerCase().trim() || null;
}

export const getSiteContext = createServerFn({ method: "GET" })
  .inputValidator((input: { hostname?: string } | undefined) => input ?? {})
  .handler(async ({ data }): Promise<SiteContext> => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return FALLBACK_SITE_CONTEXT;

    const supabase = createClient<Database>(url, key, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });

    // 1. Hostname (request or explicit override)
    let host = normalizeHost(data.hostname);
    if (!host) {
      try {
        const headers = getHeaders();
        host = normalizeHost(headers.host ?? headers["x-forwarded-host"] ?? null);
      } catch {
        // running outside a request scope (build time)
        host = null;
      }
    }

    if (host) {
      const { data: byHost } = await supabase
        .from("site_configs")
        .select("*")
        .or(`hostname.eq.${host},alt_hostnames.cs.{${host}}`)
        .limit(1)
        .maybeSingle();
      if (byHost) return rowToContext(byHost);
    }

    // 2. Env slug fallback
    const envSlug = process.env.VITE_SITE_SLUG || process.env.SITE_SLUG;
    if (envSlug) {
      const { data: bySlug } = await supabase
        .from("site_configs")
        .select("*")
        .eq("slug", envSlug)
        .maybeSingle();
      if (bySlug) return rowToContext(bySlug);
    }

    // 3. Default
    const { data: byDefault } = await supabase
      .from("site_configs")
      .select("*")
      .eq("is_default", true)
      .limit(1)
      .maybeSingle();
    if (byDefault) return rowToContext(byDefault);

    return FALLBACK_SITE_CONTEXT;
  });