import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertStaff(userId: string) {
  const { data } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
  const ok = (data ?? []).some((r) => r.role === "admin" || r.role === "staff");
  if (!ok) throw new Error("Forbidden");
}

const agentInput = z.object({
  id: z.string().uuid().optional(),
  event_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  base_url_mode: z.enum(["api", "free"]),
  model: z.string().min(1).max(200),
  temperature: z.number().min(0).max(2).nullable().optional(),
  max_tokens: z.number().int().min(1).max(32000).nullable().optional(),
  system_prompt: z.string().max(8000).nullable().optional(),
  rag_enabled: z.boolean(),
  is_default: z.boolean(),
  is_active: z.boolean(),
  skill_ids: z.array(z.string().uuid()).default([]),
});

export const listAgents = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ event_id: z.string().uuid() }).parse(i))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data }) => {
    const { data: agents, error } = await supabaseAdmin
      .from("agents")
      .select("*, agent_skills(skill_id)")
      .eq("event_id", data.event_id)
      .order("created_at");
    if (error) throw new Error(error.message);
    return (agents ?? []).map((a) => ({
      ...a,
      skill_ids: (a.agent_skills as Array<{ skill_id: string }> | null)?.map((s) => s.skill_id) ?? [],
    }));
  });

export const listSkills = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("skills")
      .select("*")
      .eq("is_active", true)
      .order("scope")
      .order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertAgent = createServerFn({ method: "POST" })
  .inputValidator((i) => agentInput.parse(i))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertStaff(context.userId);
    const { skill_ids, id, ...payload } = data;
    let agentId = id;
    if (data.is_default) {
      await supabaseAdmin
        .from("agents")
        .update({ is_default: false })
        .eq("event_id", data.event_id)
        .neq("id", id ?? "00000000-0000-0000-0000-000000000000");
    }
    if (agentId) {
      const { error } = await supabaseAdmin
        .from("agents")
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq("id", agentId);
      if (error) throw new Error(error.message);
    } else {
      const { data: created, error } = await supabaseAdmin
        .from("agents")
        .insert(payload)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      agentId = created!.id;
    }
    await supabaseAdmin.from("agent_skills").delete().eq("agent_id", agentId);
    if (skill_ids.length > 0) {
      const { error: e2 } = await supabaseAdmin
        .from("agent_skills")
        .insert(skill_ids.map((sid) => ({ agent_id: agentId!, skill_id: sid })));
      if (e2) throw new Error(e2.message);
    }
    return { id: agentId };
  });

export const deleteAgent = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertStaff(context.userId);
    const { error } = await supabaseAdmin.from("agents").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const duplicateAgent = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertStaff(context.userId);
    const { data: src, error } = await supabaseAdmin
      .from("agents")
      .select("*, agent_skills(skill_id)")
      .eq("id", data.id)
      .maybeSingle();
    if (error || !src) throw new Error(error?.message ?? "Agente não encontrado");
    const agentSkills = (src.agent_skills as Array<{ skill_id: string }> | null) ?? [];
    const { data: created, error: e2 } = await supabaseAdmin
      .from("agents")
      .insert({
        event_id: src.event_id,
        name: `${src.name} (cópia)`,
        provider: src.provider,
        base_url_mode: src.base_url_mode,
        model: src.model,
        temperature: src.temperature,
        max_tokens: src.max_tokens,
        system_prompt: src.system_prompt,
        rag_enabled: src.rag_enabled,
        is_active: src.is_active,
        is_default: false,
      })
      .select("id")
      .maybeSingle();
    if (e2) throw new Error(e2.message);
    const skillIds = agentSkills.map((s) => s.skill_id);
    if (skillIds.length > 0 && created) {
      await supabaseAdmin
        .from("agent_skills")
        .insert(skillIds.map((sid) => ({ agent_id: created.id, skill_id: sid })));
    }
    return { id: created!.id };
  });