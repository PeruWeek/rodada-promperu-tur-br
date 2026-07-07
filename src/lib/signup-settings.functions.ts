import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const ok = (data ?? []).some((r) => r.role === "admin");
  if (!ok) throw new Error("Forbidden: admin only");
}

/**
 * Leitura publica porque o frontend precisa saber se as inscricoes estao
 * abertas antes de mostrar CTAs e formularios. O payload retorna apenas o
 * flag global e os metadados de auditoria.
 */
export const getSignupSettings = createServerFn({ method: "GET" })
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("signup_settings")
      .select("enabled, updated_at, updated_by")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      enabled: data?.enabled ?? true,
      updated_at: data?.updated_at ?? null,
      updated_by: data?.updated_by ?? null,
    };
  });

export const updateSignupSettings = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ enabled: z.boolean() }).parse(i))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: updated, error } = await supabaseAdmin
      .from("signup_settings")
      .update({
        enabled: data.enabled,
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1)
      .select("enabled, updated_at, updated_by")
      .single();
    if (error) throw new Error(error.message);
    return updated;
  });
