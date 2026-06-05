import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const ok = (data ?? []).some((r) => r.role === "admin" || r.role === "staff");
  if (!ok) throw new Error("Forbidden");
}

async function actorProfileId(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  return data?.id ?? null;
}

async function audit(action: string, userId: string, payload: Record<string, unknown>) {
  try {
    const actor = await actorProfileId(userId);
    await supabaseAdmin.from("audit_logs").insert({
      actor_profile_id: actor,
      action,
      payload,
    });
  } catch {
    // best-effort; do not block on audit failures
  }
}

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email();

async function findUserByEmailExact(email: string) {
  // Paginate listUsers and match exactly (filter is best-effort/partial).
  const perPage = 200;
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    const match = data.users.find((u) => u.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < perPage) break;
  }
  return null;
}

export const findAuthUserByEmail = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ email: emailSchema }).parse(input))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const user = await findUserByEmailExact(data.email);
    if (!user) return { user: null as null, hasProfile: false };
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    return {
      user: {
        id: user.id,
        email: user.email ?? data.email,
        email_confirmed_at: user.email_confirmed_at ?? null,
        created_at: user.created_at,
      },
      hasProfile: !!prof,
    };
  });

export const adminConfirmEmail = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ userId: z.string().uuid() }).parse(input))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: updated, error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    await audit("admin.email_confirm", context.userId, {
      target_user_id: data.userId,
      target_email: updated.user?.email ?? null,
    });
    return { ok: true };
  });

export const adminCreateConfirmedUser = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        email: emailSchema,
        password: z.string().min(8).max(128),
        full_name: z.string().trim().min(1).max(120),
        preferred_language: z.enum(["pt-BR", "es"]).default("pt-BR"),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: {
        full_name: data.full_name,
        preferred_language: data.preferred_language,
      },
    });
    if (error) throw new Error(error.message);
    await audit("admin.user_create_confirmed", context.userId, {
      target_user_id: created.user?.id ?? null,
      target_email: data.email,
    });
    return {
      ok: true,
      userId: created.user?.id ?? null,
      email: data.email,
    };
  });

export const adminSetPassword = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        userId: z.string().uuid(),
        password: z.string().min(8).max(128),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: data.password,
    });
    if (error) throw new Error(error.message);
    await audit("admin.password_reset", context.userId, {
      target_user_id: data.userId,
    });
    return { ok: true };
  });