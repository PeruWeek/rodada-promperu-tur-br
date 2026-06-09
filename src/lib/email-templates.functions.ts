import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  DEFAULT_FROM_NAME,
  OVERRIDE_FIELDS,
  TEMPLATE_COPY_DEFAULTS,
  TEMPLATE_DISPLAY_NAMES,
  TEMPLATE_PLACEHOLDERS,
  type OverrideField,
} from "@/lib/email-templates/copy-defaults";
import { invalidateOverrideCache } from "@/lib/email-templates/overrides.server";

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const ok = (data ?? []).some((r) => r.role === "admin");
  if (!ok) throw new Error("Forbidden: admin only");
}

async function getProfileId(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  return data?.id ?? null;
}

export const listEmailTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const names = Object.keys(TEMPLATE_COPY_DEFAULTS);
    const { data: rows } = await supabaseAdmin
      .from("email_template_overrides")
      .select("*")
      .in("template_name", names);
    type OverrideRow = Record<string, string | null>;
    const byName = new Map<string, OverrideRow>();
    for (const r of rows ?? []) byName.set((r as any).template_name, r as OverrideRow);

    return {
      defaultFromName: DEFAULT_FROM_NAME,
      templates: names.map((name) => ({
        templateName: name,
        displayName: TEMPLATE_DISPLAY_NAMES[name] ?? name,
        placeholders: TEMPLATE_PLACEHOLDERS[name] ?? [],
        defaults: TEMPLATE_COPY_DEFAULTS[name],
        override: (byName.get(name) ?? null) as OverrideRow | null,
      })),
    };
  });

const FieldEnum = z.enum(OVERRIDE_FIELDS as [OverrideField, ...OverrideField[]]);

const UpdateSchema = z.object({
  templateName: z.string().min(1).max(80),
  fields: z.record(FieldEnum, z.string().max(2000).nullable()),
});

export const updateEmailTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => UpdateSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    if (!TEMPLATE_COPY_DEFAULTS[data.templateName]) {
      throw new Error("Unknown template");
    }
    const profileId = await getProfileId(context.userId);
    const patch: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(data.fields)) {
      const trimmed = typeof v === "string" ? v.trim() : v;
      patch[k] = trimmed && trimmed.length > 0 ? trimmed : null;
    }
    const row = {
      template_name: data.templateName,
      ...patch,
      updated_by: profileId,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabaseAdmin
      .from("email_template_overrides")
      .upsert(row as never, { onConflict: "template_name" });
    if (error) throw new Error(error.message);
    invalidateOverrideCache(data.templateName);
    return { ok: true };
  });

const ResetSchema = z.object({
  templateName: z.string().min(1).max(80),
  field: FieldEnum,
});

export const resetEmailTemplateField = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ResetSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const profileId = await getProfileId(context.userId);
    const row = {
      template_name: data.templateName,
      [data.field]: null,
      updated_by: profileId,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabaseAdmin
      .from("email_template_overrides")
      .upsert(row as never, { onConflict: "template_name" });
    if (error) throw new Error(error.message);
    invalidateOverrideCache(data.templateName);
    return { ok: true };
  });