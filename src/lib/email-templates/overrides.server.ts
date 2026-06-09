import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  DEFAULT_FROM_NAME,
  TEMPLATE_COPY_DEFAULTS,
  type CopyFields,
  type EmailLang,
} from "./copy-defaults";

export interface ResolvedTemplateOverrides {
  fromName: string;
  subjectTemplate: string;
  copy: Partial<CopyFields>;
}

// 60s in-memory cache per worker instance.
const CACHE = new Map<string, { at: number; row: Record<string, string | null> | null }>();
const TTL_MS = 60_000;

export function invalidateOverrideCache(templateName?: string) {
  if (templateName) CACHE.delete(templateName);
  else CACHE.clear();
}

async function loadRow(templateName: string) {
  const cached = CACHE.get(templateName);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.row;
  const { data } = await supabaseAdmin
    .from("email_template_overrides")
    .select(
      "from_name,subject_pt,subject_es,greeting_pt,greeting_es,intro_pt,intro_es,outro_pt,outro_es,cta_label_pt,cta_label_es,signature_pt,signature_es",
    )
    .eq("template_name", templateName)
    .maybeSingle();
  const row = (data as Record<string, string | null> | null) ?? null;
  CACHE.set(templateName, { at: Date.now(), row });
  return row;
}

export async function resolveTemplateOverrides(
  templateName: string,
  language: EmailLang,
): Promise<ResolvedTemplateOverrides> {
  const defaults = TEMPLATE_COPY_DEFAULTS[templateName];
  const defaultFromName = defaults?.fromName ?? DEFAULT_FROM_NAME;
  const defaultSubject = defaults?.subject[language] ?? "";
  const row = await loadRow(templateName);
  if (!row) {
    return { fromName: defaultFromName, subjectTemplate: defaultSubject, copy: {} };
  }
  const suffix = language === "es" ? "_es" : "_pt";
  const pick = (k: string) => {
    const v = row[`${k}${suffix}`];
    return v && v.trim().length > 0 ? v : null;
  };
  return {
    fromName: row.from_name?.trim() || defaultFromName,
    subjectTemplate: pick("subject") ?? defaultSubject,
    copy: {
      greeting: pick("greeting") ?? undefined,
      intro: pick("intro") ?? undefined,
      outro: pick("outro") ?? undefined,
      ctaLabel: pick("cta_label") ?? undefined,
      signature: pick("signature") ?? undefined,
    },
  };
}