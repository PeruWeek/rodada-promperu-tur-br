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
      .select("id, slug, name, hostname, alt_hostnames, site_url, is_default, active_event_id")
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

/* ────────────────────────────────────────────────────────────────────── */
/* Structural CRUD: URL/domain + event binding                             */
/* ────────────────────────────────────────────────────────────────────── */

const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function normalizeHostname(h: string): string {
  const trimmed = h.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return trimmed;
}

function normalizeAltHostnames(list: string[] | undefined | null): string[] {
  if (!list) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const h = normalizeHostname(raw ?? "");
    if (!h) continue;
    if (!HOSTNAME_RE.test(h)) throw new Error(`Hostname alternativo inválido: ${raw}`);
    if (!seen.has(h)) {
      seen.add(h);
      out.push(h);
    }
  }
  return out;
}

const structuralInput = z.object({
  slug: z.string().min(1).max(60).transform((v) => v.trim().toLowerCase()),
  name: z.string().min(1).max(120),
  hostname: z.string().min(3).max(253).transform(normalizeHostname),
  alt_hostnames: z.array(z.string()).optional(),
  site_url: z.string().url().max(300),
  active_event_id: z.string().uuid().nullable().optional(),
  is_default: z.boolean().optional(),
});

function validateStructural(input: z.infer<typeof structuralInput>) {
  if (!SLUG_RE.test(input.slug)) {
    throw new Error("Slug inválido: use letras minúsculas, números e hífens.");
  }
  if (!HOSTNAME_RE.test(input.hostname)) {
    throw new Error(`Hostname inválido: ${input.hostname}`);
  }
  try {
    // eslint-disable-next-line no-new
    new URL(input.site_url);
  } catch {
    throw new Error("site_url deve ser uma URL absoluta (https://...).");
  }
  return normalizeAltHostnames(input.alt_hostnames);
}

async function assertHostnameFree(hostname: string, ignoreId?: string) {
  const q = supabaseAdmin.from("site_configs").select("id, hostname, alt_hostnames");
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    if (ignoreId && row.id === ignoreId) continue;
    if (row.hostname === hostname) throw new Error(`Hostname já em uso: ${hostname}`);
    if ((row.alt_hostnames ?? []).includes(hostname))
      throw new Error(`Hostname já em uso como alternativo em outro site: ${hostname}`);
  }
}

async function assertAltHostnamesFree(alts: string[], ignoreId?: string) {
  if (!alts.length) return;
  const { data, error } = await supabaseAdmin
    .from("site_configs")
    .select("id, hostname, alt_hostnames");
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    if (ignoreId && row.id === ignoreId) continue;
    for (const a of alts) {
      if (row.hostname === a || (row.alt_hostnames ?? []).includes(a)) {
        throw new Error(`Hostname alternativo já em uso em outro site: ${a}`);
      }
    }
  }
}

async function clearDefaultsExcept(id: string | null) {
  const q = supabaseAdmin.from("site_configs").update({ is_default: false }).eq("is_default", true);
  const { error } = id ? await q.neq("id", id) : await q;
  if (error) throw new Error(error.message);
}

export const createAdminSiteConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => structuralInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const alts = validateStructural(data);
    await assertHostnameFree(data.hostname);
    await assertAltHostnamesFree(alts);

    const insert: Database["public"]["Tables"]["site_configs"]["Insert"] = {
      slug: data.slug,
      name: data.name,
      hostname: data.hostname,
      alt_hostnames: alts,
      site_url: data.site_url.replace(/\/+$/, ""),
      active_event_id: data.active_event_id ?? null,
      is_default: data.is_default ?? false,
    };

    if (insert.is_default) await clearDefaultsExcept(null);

    const { data: row, error } = await supabaseAdmin
      .from("site_configs")
      .insert(insert)
      .select("*")
      .single();
    if (error) {
      if (error.code === "23505") throw new Error(`Slug ou hostname já existe.`);
      throw new Error(error.message);
    }
    return row;
  });

export const updateAdminSiteStructure = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    structuralInput.extend({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const alts = validateStructural(data);
    await assertHostnameFree(data.hostname, data.id);
    await assertAltHostnamesFree(alts, data.id);

    if (data.is_default) await clearDefaultsExcept(data.id);

    const patch: Database["public"]["Tables"]["site_configs"]["Update"] = {
      slug: data.slug,
      name: data.name,
      hostname: data.hostname,
      alt_hostnames: alts,
      site_url: data.site_url.replace(/\/+$/, ""),
      active_event_id: data.active_event_id ?? null,
      is_default: data.is_default ?? false,
    };

    const { data: row, error } = await supabaseAdmin
      .from("site_configs")
      .update(patch)
      .eq("id", data.id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteAdminSiteConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: row } = await supabaseAdmin
      .from("site_configs")
      .select("id, is_default")
      .eq("id", data.id)
      .maybeSingle();
    if (!row) throw new Error("Site não encontrado.");
    if (row.is_default) throw new Error("Não é possível excluir o site padrão. Defina outro site como padrão antes.");
    const { count, error: countErr } = await supabaseAdmin
      .from("site_configs")
      .select("id", { count: "exact", head: true });
    if (countErr) throw new Error(countErr.message);
    if ((count ?? 0) <= 1) {
      throw new Error("Não é possível excluir o único site existente. Crie outro site antes.");
    }
    const { error } = await supabaseAdmin.from("site_configs").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listAdminEventsForSites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("events")
      .select("id, name, event_date")
      .order("event_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });