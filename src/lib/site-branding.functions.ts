/**
 * Admin-only server functions for the Branding tab. Reads/writes
 * `site_configs` fields that drive the frontend look-and-feel: colors,
 * institutional copy, SEO metadata, event display strings.
 *
 * Content overrides use per-language flat dot-notation keys — see
 * `EDITABLE_CONTENT_KEYS` in `site-theme.ts` for the whitelist.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { isSafeCssColor } from "@/lib/site-theme";

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const ok = (data ?? []).some((r) => r.role === "admin");
  if (!ok) throw new Error("Forbidden: admin only");
}

export const listAdminSiteConfigs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("site_configs")
      .select("id, slug, name, hostname, is_default")
      .order("is_default", { ascending: false })
      .order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getAdminSiteConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: row, error } = await supabaseAdmin
      .from("site_configs")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Site config not found");
    return row;
  });

const brandingInput = z.object({
  id: z.string().uuid(),
  // Branding text
  name: z.string().min(1).max(120).optional(),
  tagline: z.string().max(200).nullable().optional(),
  footer_text: z.string().max(500).nullable().optional(),
  event_display_name: z.string().max(120).nullable().optional(),
  event_display_date: z.string().max(120).nullable().optional(),
  // SEO
  meta_description: z.string().max(300).nullable().optional(),
  og_image_url: z.string().url().nullable().optional().or(z.literal("").transform(() => null)),
  logo_url: z.string().url().nullable().optional().or(z.literal("").transform(() => null)),
  favicon_url: z.string().url().nullable().optional().or(z.literal("").transform(() => null)),
  // Palette
  theme_tokens: z.record(z.string(), z.string()).optional(),
  // Copy overrides: { "pt-BR": { "landing.heroTitle": "..." }, "es": {...} }
  content_overrides: z.record(z.string(), z.record(z.string(), z.string())).optional(),
});

export const updateAdminSiteConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => brandingInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { id, theme_tokens, content_overrides, ...rest } = data;

    const patch: Database["public"]["Tables"]["site_configs"]["Update"] = { ...rest };

    if (theme_tokens) {
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(theme_tokens)) {
        const trimmed = (v ?? "").trim();
        if (!trimmed) continue; // empty = fallback to default
        if (!isSafeCssColor(trimmed)) throw new Error(`Cor inválida em "${k}": ${trimmed}`);
        clean[k] = trimmed;
      }
      patch.theme_tokens = clean;
    }

    if (content_overrides) {
      const clean: Record<string, Record<string, string>> = {};
      for (const [lng, entries] of Object.entries(content_overrides)) {
        const inner: Record<string, string> = {};
        for (const [k, v] of Object.entries(entries ?? {})) {
          const trimmed = (v ?? "").trim();
          if (trimmed) inner[k] = trimmed;
        }
        if (Object.keys(inner).length) clean[lng] = inner;
      }
      patch.content_overrides = clean;
    }

    const { data: row, error } = await supabaseAdmin
      .from("site_configs")
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row;
  });