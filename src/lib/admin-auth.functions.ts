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

// Cancela todas as reuniões futuras (start_at > now) do visitante em qualquer
// evento, libera os slots dos expositores, notifica cada expositor e registra
// uma linha de audit_logs por evento afetado.
//
// Usado quando um inscrito é inativado (is_active = false). Preserva o
// histórico (status = 'cancelled', cancel_reason preenchido) e não deleta nada.
async function cancelFutureMeetingsForRegistrant(params: {
  authUserId: string;
  actorUserId: string;
  reason: string;
}): Promise<{ cancelledCount: number }> {
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name")
    .eq("auth_user_id", params.authUserId)
    .maybeSingle();
  if (!profile) return { cancelledCount: 0 };

  const nowIso = new Date().toISOString();
  const { data: futureMeetings, error: mErr } = await supabaseAdmin
    .from("meetings")
    .select("id, event_id, table_id, slot_id, time_slots!meetings_slot_id_fkey!inner(start_at)")
    .eq("visitor_profile_id", profile.id)
    .eq("status", "scheduled")
    .gt("time_slots.start_at", nowIso);
  if (mErr) throw new Error(mErr.message);

  const rows = (futureMeetings ?? []) as unknown as Array<{
    id: string;
    event_id: string;
    table_id: string;
    slot_id: string;
    time_slots: { start_at: string } | null;
  }>;
  if (rows.length === 0) return { cancelledCount: 0 };

  const meetingIds = rows.map((m) => m.id);
  const { error: updErr } = await supabaseAdmin
    .from("meetings")
    .update({ status: "cancelled", cancel_reason: params.reason })
    .in("id", meetingIds);
  if (updErr) throw new Error(updErr.message);

  // Notify exhibitors (in-app). Best-effort; never blocks the deactivation.
  const tableIds = Array.from(new Set(rows.map((m) => m.table_id)));
  const { data: tables } = await supabaseAdmin
    .from("event_tables")
    .select("id, table_number, exhibitor_profile_id")
    .in("id", tableIds);
  const tableById = new Map(
    (tables ?? []).map((t) => [t.id, t] as const),
  );

  const notifications = rows
    .map((m) => {
      const t = tableById.get(m.table_id);
      if (!t?.exhibitor_profile_id) return null;
      return {
        event_id: m.event_id,
        recipient_profile_id: t.exhibitor_profile_id,
        type: "meeting_cancelled" as const,
        channel: "in_app" as const,
        status: "sent" as const,
        title: "Reunião cancelada",
        body: `${profile.full_name} teve o acesso inativado; a reunião foi cancelada e o horário liberado.`,
        data: {
          meeting_id: m.id,
          slot_start: m.time_slots?.start_at ?? null,
          table_number: t.table_number,
          reason: params.reason,
        },
      };
    })
    .filter((n): n is NonNullable<typeof n> => n !== null);
  if (notifications.length) {
    await supabaseAdmin.from("notifications").insert(notifications);
  }

  // audit_logs: uma linha por evento afetado (event_id é obrigatório).
  const byEvent = new Map<string, string[]>();
  for (const m of rows) {
    const arr = byEvent.get(m.event_id) ?? [];
    arr.push(m.id);
    byEvent.set(m.event_id, arr);
  }
  const { data: actorProfile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("auth_user_id", params.actorUserId)
    .maybeSingle();
  const actorProfileId = actorProfile?.id ?? null;
  const auditRows = Array.from(byEvent.entries()).map(([event_id, ids]) => ({
    event_id,
    actor_profile_id: actorProfileId,
    action: "registrant.deactivated.meetings_cancelled",
    payload: {
      target_auth_user_id: params.authUserId,
      target_profile_id: profile.id,
      meeting_ids: ids,
      reason: params.reason,
    },
  }));
  if (auditRows.length) {
    await supabaseAdmin.from("audit_logs").insert(auditRows);
  }

  return { cancelledCount: rows.length };
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
    // Ao inativar um inscrito, cancelar reuniões futuras dele para liberar
    // a agenda dos expositores. Reativar (is_active = true) não recria
    // reuniões — o inscrito precisa reagendar pelo fluxo normal.
    let cancelledMeetings = 0;
    if (data.is_active === false) {
      const result = await cancelFutureMeetingsForRegistrant({
        authUserId: data.userId,
        actorUserId: context.userId,
        reason: "admin_deactivated_registrant",
      });
      cancelledMeetings = result.cancelledCount;
    }
    await audit("admin.profile_update", context.userId, {
      target_user_id: data.userId,
      patch,
      cancelled_future_meetings: cancelledMeetings,
    });
    return { ok: true, cancelledMeetings };
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

export const getAuthDiagnostics = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ email: emailSchema }).parse(input))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const user = await findUserByEmailExact(data.email);
    const profile = user
      ? await supabaseAdmin
          .from("profiles")
          .select("id, full_name, is_active")
          .eq("auth_user_id", user.id)
          .maybeSingle()
          .then((r) => r.data)
      : null;
    const { data: logs } = await supabaseAdmin
      .from("email_send_log")
      .select("id, message_id, template_name, status, error_message, created_at")
      .eq("recipient_email", data.email)
      .order("created_at", { ascending: false })
      .limit(20);
    const { data: suppression } = await supabaseAdmin
      .from("suppressed_emails")
      .select("id, reason, created_at")
      .eq("email", data.email)
      .order("created_at", { ascending: false })
      .limit(5);
    return {
      user: user
        ? {
            id: user.id,
            email: user.email ?? data.email,
            email_confirmed_at: user.email_confirmed_at ?? null,
            created_at: user.created_at,
            last_sign_in_at: user.last_sign_in_at ?? null,
          }
        : null,
      profile,
      sendLog: logs ?? [],
      suppression: suppression ?? [],
    };
  });

export const adminSendRecoveryEmail = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ email: emailSchema, redirectTo: z.string().url() }).parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    // Generate a recovery link via Admin API so we get a real link even if
    // outbound delivery is failing; the auth hook will also enqueue the email.
    const { data: linkData, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: data.email,
      options: { redirectTo: data.redirectTo },
    });
    if (error) throw new Error(error.message);
    await audit("admin.send_recovery", context.userId, { target_email: data.email });
    return {
      ok: true,
      actionLink: linkData.properties?.action_link ?? null,
    };
  });