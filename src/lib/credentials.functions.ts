import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { encryptSecret } from "./llm/crypto.server";

export const getCredentialStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await supabaseAdmin
      .from("user_llm_credentials")
      .select("user_id, updated_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    return {
      has_user_key: !!data,
      app_key_available: !!process.env.OPENROUTER_API_KEY_APP,
      updated_at: data?.updated_at ?? null,
    };
  });

export const saveUserCredential = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ api_key: z.string().min(8).max(500) }).parse(i))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const enc = encryptSecret(data.api_key.trim());
    const { error } = await supabaseAdmin
      .from("user_llm_credentials")
      .upsert(
        {
          user_id: context.userId,
          provider: "openrouter",
          api_key_encrypted: enc,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteUserCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await supabaseAdmin.from("user_llm_credentials").delete().eq("user_id", context.userId);
    return { ok: true };
  });