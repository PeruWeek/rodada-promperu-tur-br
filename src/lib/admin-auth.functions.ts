import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertAdminStrict(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const ok = (data ?? []).some((r) => r.role === "admin");
  if (!ok) throw new Error("Forbidden");
}

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const ok = (data ?? []).some((r) => r.role === "admin");
  if (!ok) throw new Error("Forbidden: admin only");
}

async function audit(action: string, userId: string, payload: Record<string, unknown>) {
  // Lightweight logger; audit_logs requires event_id which is not available here.
  console.log(`[admin-auth] action=${action} actor=${userId}`, payload);
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
        role: z.enum(["admin", "staff", "exhibitor", "visitor", "cliente"]).optional(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    // Only admin can create another admin
    if (data.role === "admin") {
      await assertAdminStrict(context.userId);
    }
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
    const newUserId = created.user?.id ?? null;
    if (newUserId && data.role) {
      await supabaseAdmin.from("user_roles").delete().eq("user_id", newUserId);
      await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: newUserId, role: data.role });
    }
    await audit("admin.user_create_confirmed", context.userId, {
      target_user_id: newUserId,
      target_email: data.email,
      role: data.role ?? "visitor",
    });
    return {
      ok: true,
      userId: newUserId,
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

export const adminUpdateUserEmail = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        userId: z.string().uuid(),
        newEmail: emailSchema,
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    if (data.userId === context.userId) {
      throw new Error("Use o fluxo normal para alterar seu próprio e-mail.");
    }
    const { data: current, error: getErr } = await supabaseAdmin.auth.admin.getUserById(
      data.userId,
    );
    if (getErr) throw new Error(getErr.message);
    const oldEmail = current.user?.email ?? null;
    if (oldEmail && oldEmail.toLowerCase() === data.newEmail) {
      throw new Error("O novo e-mail é igual ao atual.");
    }
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      email: data.newEmail,
      email_confirm: true,
    });
    if (error) {
      const msg = error.message || "";
      if (/already|registered|exists|in use/i.test(msg)) {
        throw new Error("E-mail já está em uso por outra conta.");
      }
      throw new Error(msg);
    }
    await supabaseAdmin
      .from("profiles")
      .update({ email: data.newEmail })
      .eq("auth_user_id", data.userId);
    await audit("admin.email_change", context.userId, {
      target_user_id: data.userId,
      old_email: oldEmail,
      new_email: data.newEmail,
    });
    return { ok: true, email: data.newEmail };
  });

export const adminUpdateUserProfile = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        userId: z.string().uuid(),
        full_name: z.string().trim().min(1).max(120).optional(),
        preferred_language: z.enum(["pt-BR", "es"]).optional(),
        is_active: z.boolean().optional(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const patch: {
      full_name?: string;
      preferred_language?: "pt-BR" | "es";
      is_active?: boolean;
    } = {};
    if (data.full_name !== undefined) patch.full_name = data.full_name;
    if (data.preferred_language !== undefined) patch.preferred_language = data.preferred_language;
    if (data.is_active !== undefined) patch.is_active = data.is_active;
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await supabaseAdmin
      .from("profiles")
      .update(patch)
      .eq("auth_user_id", data.userId);
    if (error) throw new Error(error.message);
    await audit("admin.profile_update", context.userId, {
      target_user_id: data.userId,
      patch,
    });
    return { ok: true };
  });

export const adminUpsertUserCompany = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        userId: z.string().uuid(),
        trade_name: z.string().trim().min(1).max(200),
        country_code: z.string().trim().min(2).max(2).default("BR"),
        city: z.string().trim().max(120).optional(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: prof, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("id, company_id")
      .eq("auth_user_id", data.userId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!prof) throw new Error("Perfil não encontrado.");
    const city = data.city?.trim() ? data.city.trim() : null;
    if (prof.company_id) {
      const { error } = await supabaseAdmin
        .from("companies")
        .update({ trade_name: data.trade_name, country_code: data.country_code, city })
        .eq("id", prof.company_id);
      if (error) throw new Error(error.message);
      await audit("admin.company_update", context.userId, {
        target_user_id: data.userId,
        company_id: prof.company_id,
      });
      return { ok: true, companyId: prof.company_id };
    }
    const { data: created, error: cErr } = await supabaseAdmin
      .from("companies")
      .insert({ trade_name: data.trade_name, country_code: data.country_code, city })
      .select("id")
      .single();
    if (cErr) throw new Error(cErr.message);
    const { error: uErr } = await supabaseAdmin
      .from("profiles")
      .update({ company_id: created.id })
      .eq("id", prof.id);
    if (uErr) throw new Error(uErr.message);
    await audit("admin.company_create", context.userId, {
      target_user_id: data.userId,
      company_id: created.id,
    });
    return { ok: true, companyId: created.id };
  });

export const adminDeleteUser = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ userId: z.string().uuid() }).parse(input))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdminStrict(context.userId);
    if (data.userId === context.userId) {
      throw new Error("Você não pode excluir a si mesmo.");
    }
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    await audit("admin.user_delete", context.userId, { target_user_id: data.userId });
    return { ok: true };
  });

export const adminSetPrimaryRole = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        userId: z.string().uuid(),
        role: z.enum(["staff", "exhibitor", "visitor", "cliente"]),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    // Only admin can grant/revoke staff
    if (data.role === "staff") {
      await assertAdminStrict(context.userId);
    }
    // Block editing admins through this flow (admins must be managed elsewhere)
    const { data: targetRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.userId);
    if ((targetRoles ?? []).some((r) => r.role === "admin")) {
      throw new Error("Usuários admin não podem ter a categoria alterada por este fluxo.");
    }
    // Replace any non-admin role with the chosen one. Preserve admin if present
    // (defensive — blocked above, but keep the delete narrow).
    const { error: delErr } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId)
      .in("role", ["staff", "exhibitor", "visitor", "cliente"]);
    if (delErr) throw new Error(delErr.message);
    const { error: insErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: data.userId, role: data.role });
    if (insErr) throw new Error(insErr.message);
    // Sync dependent profile rows so derived listings (companies/registrants)
    // reflect the new category immediately.
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("auth_user_id", data.userId)
      .maybeSingle();
    if (prof?.id) {
      if (data.role === "exhibitor") {
        await supabaseAdmin
          .from("exhibitor_profiles")
          .upsert({ profile_id: prof.id }, { onConflict: "profile_id" });
      } else {
        // Remove exhibitor profile so company/registrant listings stop
        // labeling this user as exhibitor. event_tables FK is ON DELETE SET NULL.
        await supabaseAdmin
          .from("exhibitor_profiles")
          .delete()
          .eq("profile_id", prof.id);
      }
      if (data.role === "visitor") {
        await supabaseAdmin
          .from("visitor_profiles")
          .upsert({ profile_id: prof.id }, { onConflict: "profile_id" });
      }
    }
    await audit("admin.set_primary_role", context.userId, {
      target_user_id: data.userId,
      role: data.role,
    });
    return { ok: true };
  });

export const adminListUsers = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        q: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    let q = supabaseAdmin
      .from("profiles")
      .select("id, auth_user_id, full_name, email, is_active, preferred_language, company_id, companies:company_id(id, trade_name, country_code, city)")
      .not("auth_user_id", "is", null)
      .order("full_name")
      .limit(data.limit ?? 200);
    if (data.q?.trim()) {
      const term = `%${data.q.trim()}%`;
      q = q.or(`full_name.ilike.${term},email.ilike.${term}`);
    }
    const { data: profs, error } = await q;
    if (error) throw new Error(error.message);
    const userIds = (profs ?? []).map((p) => p.auth_user_id).filter(Boolean) as string[];
    const { data: roles } = userIds.length
      ? await supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", userIds)
      : { data: [] as Array<{ user_id: string; role: string }> };
    return {
      users: (profs ?? []).map((p) => {
        const company = (p as unknown as { companies: { id: string; trade_name: string; country_code: string; city: string | null } | null }).companies ?? null;
        return {
          id: p.id,
          auth_user_id: p.auth_user_id,
          full_name: p.full_name,
          email: p.email,
          is_active: p.is_active,
          preferred_language: p.preferred_language,
          company_id: p.company_id,
          company,
          roles: (roles ?? [])
            .filter((r) => r.user_id === p.auth_user_id)
            .map((r) => r.role as "admin" | "staff" | "exhibitor" | "visitor" | "cliente"),
        };
      }),
    };
  });