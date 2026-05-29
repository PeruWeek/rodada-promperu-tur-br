import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  chatCompletion,
  embed,
  getOpenRouterKey,
  resolveBaseUrl,
  type ChatMessage,
} from "./llm/openrouter.server";
import { executeSkill, skillRegistry } from "./llm/skills.server";

type Role = "admin" | "staff" | "exhibitor" | "visitor";

async function getCtx(userId: string) {
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  const { data: roleRows } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const roles = (roleRows ?? []).map((r) => r.role as Role);
  const isStaff = roles.includes("admin") || roles.includes("staff");
  return { profileId: profile?.id ?? null, isStaff, roles };
}

export const listConversations = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ event_id: z.string().uuid() }).parse(i))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { profileId } = await getCtx(context.userId);
    if (!profileId) return [];
    const { data: rows, error } = await supabaseAdmin
      .from("conversations")
      .select("id, title, agent_id, updated_at, created_at")
      .eq("event_id", data.event_id)
      .eq("owner_profile_id", profileId)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getConversation = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { profileId, isStaff } = await getCtx(context.userId);
    const { data: conv, error } = await supabaseAdmin
      .from("conversations")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error || !conv) throw new Error(error?.message ?? "Conversa não encontrada");
    if (conv.owner_profile_id !== profileId && !isStaff) throw new Error("Forbidden");
    const { data: messages } = await supabaseAdmin
      .from("conversation_messages")
      .select("*")
      .eq("conversation_id", data.id)
      .order("created_at");
    return { conversation: conv, messages: messages ?? [] };
  });

export const createConversation = createServerFn({ method: "POST" })
  .inputValidator((i) =>
    z.object({ event_id: z.string().uuid(), agent_id: z.string().uuid().optional() }).parse(i),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { profileId } = await getCtx(context.userId);
    if (!profileId) throw new Error("Perfil não encontrado");
    let agentId = data.agent_id;
    if (!agentId) {
      const { data: def } = await supabaseAdmin
        .from("agents")
        .select("id")
        .eq("event_id", data.event_id)
        .eq("is_default", true)
        .eq("is_active", true)
        .maybeSingle();
      agentId = def?.id;
    }
    if (!agentId) throw new Error("Nenhum agente disponível para este evento.");
    const { data: conv, error } = await supabaseAdmin
      .from("conversations")
      .insert({ event_id: data.event_id, owner_profile_id: profileId, agent_id: agentId, title: "Nova conversa" })
      .select("id")
      .maybeSingle();
    if (error || !conv) throw new Error(error?.message ?? "Falha ao criar");
    return { id: conv.id };
  });

export const deleteConversation = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { profileId, isStaff } = await getCtx(context.userId);
    const { data: conv } = await supabaseAdmin
      .from("conversations")
      .select("owner_profile_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!conv) throw new Error("Não encontrado");
    if (conv.owner_profile_id !== profileId && !isStaff) throw new Error("Forbidden");
    await supabaseAdmin.from("conversations").delete().eq("id", data.id);
    return { ok: true };
  });

function skillToTool(key: string, name: string, description: string, params: unknown) {
  return {
    type: "function" as const,
    function: {
      name: key,
      description: `${name}: ${description}`,
      parameters: (params as Record<string, unknown>) ?? { type: "object", properties: {} },
    },
  };
}

export const sendChatMessage = createServerFn({ method: "POST" })
  .inputValidator((i) =>
    z
      .object({
        conversation_id: z.string().uuid(),
        user_message: z.string().min(1).max(4000),
      })
      .parse(i),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const ctx = await getCtx(context.userId);
    if (!ctx.profileId) throw new Error("Perfil não encontrado");

    const { data: conv } = await supabaseAdmin
      .from("conversations")
      .select("*")
      .eq("id", data.conversation_id)
      .maybeSingle();
    if (!conv) throw new Error("Conversa não encontrada");
    if (conv.owner_profile_id !== ctx.profileId && !ctx.isStaff) throw new Error("Forbidden");
    if (!conv.agent_id) throw new Error("Conversa sem agente");

    const { data: agent } = await supabaseAdmin
      .from("agents")
      .select("*, agent_skills(skill_id)")
      .eq("id", conv.agent_id)
      .maybeSingle();
    if (!agent || !agent.is_active) throw new Error("Agente inativo");

    // Build skill list
    const skillIds = ((agent.agent_skills as Array<{ skill_id: string }> | null) ?? []).map((s) => s.skill_id);
    let enabledSkills: Array<{ key: string; name: string; description: string; params_schema: unknown; scope: "public" | "staff" }> = [];
    if (skillIds.length > 0) {
      const { data: srows } = await supabaseAdmin
        .from("skills")
        .select("key, name, description, params_schema, scope")
        .in("id", skillIds)
        .eq("is_active", true);
      enabledSkills = (srows ?? []).filter((s) => s.scope === "public" || ctx.isStaff);
    }
    const tools = enabledSkills
      .filter((s) => skillRegistry[s.key])
      .map((s) => skillToTool(s.key, s.name, s.description, s.params_schema));

    // Load history
    const { data: history } = await supabaseAdmin
      .from("conversation_messages")
      .select("role, content, tool_calls, tool_call_id, tool_name")
      .eq("conversation_id", data.conversation_id)
      .order("created_at");

    const messages: ChatMessage[] = [];
    const systemParts: string[] = [];
    systemParts.push(
      agent.system_prompt ||
        "Você é o Assistente do Evento Rodada Peru-Brasil 2026. Responda em PT-BR ou ES conforme o idioma do usuário. Seja objetivo e use as ferramentas disponíveis quando precisar consultar dados.",
    );
    systemParts.push(`Contexto: event_id=${conv.event_id}; profile_id=${ctx.profileId}; role=${ctx.isStaff ? "staff" : "user"}.`);

    // RAG injection (admin/staff only)
    const ragActive = !!agent.rag_enabled && ctx.isStaff;
    if (ragActive) {
      try {
        const { key: apiKey } = await getOpenRouterKey(context.userId);
        const vec = await embed(data.user_message, apiKey);
        const { data: rows } = await supabaseAdmin.rpc("match_rag_chunks", {
          p_event_id: conv.event_id,
          p_query: vec as unknown as string,
          p_top_k: 5,
        });
        if (rows && rows.length > 0) {
          const chunks = (rows as Array<{ content: string }>).map((r, i) => `[${i + 1}] ${r.content}`).join("\n\n");
          systemParts.push(`Contexto do RAG (use quando relevante):\n${chunks}`);
        }
      } catch (e) {
        console.error("[chat] RAG falhou", e);
      }
    }

    messages.push({ role: "system", content: systemParts.join("\n\n") });
    for (const m of history ?? []) {
      messages.push({
        role: m.role as ChatMessage["role"],
        content: m.content,
        tool_calls: (m.tool_calls as ChatMessage["tool_calls"]) ?? undefined,
        tool_call_id: m.tool_call_id ?? undefined,
        name: m.tool_name ?? undefined,
      });
    }
    messages.push({ role: "user", content: data.user_message });

    // Save user message immediately
    await supabaseAdmin.from("conversation_messages").insert({
      conversation_id: data.conversation_id,
      role: "user",
      content: data.user_message,
    });

    const { key: apiKey } = await getOpenRouterKey(context.userId);
    const baseUrl = resolveBaseUrl(agent.base_url_mode);

    // Tool loop
    const MAX_STEPS = 5;
    let finalAssistant: ChatMessage | null = null;
    for (let step = 0; step < MAX_STEPS; step++) {
      const resp = await chatCompletion({
        baseUrl,
        apiKey,
        model: agent.model,
        temperature: agent.temperature,
        max_tokens: agent.max_tokens,
        messages,
        tools: tools.length > 0 ? tools : undefined,
      });
      const choice = resp.choices?.[0]?.message;
      if (!choice) throw new Error("Resposta vazia do modelo");

      if (choice.tool_calls && choice.tool_calls.length > 0) {
        // Persist assistant tool-call request
        await supabaseAdmin.from("conversation_messages").insert({
          conversation_id: data.conversation_id,
          role: "assistant",
          content: choice.content ?? null,
          tool_calls: choice.tool_calls as unknown as Record<string, unknown>,
        });
        messages.push({
          role: "assistant",
          content: choice.content ?? null,
          tool_calls: choice.tool_calls,
        });
        // Execute tools
        for (const tc of choice.tool_calls) {
          let toolResult: unknown;
          try {
            const args = JSON.parse(tc.function.arguments || "{}");
            toolResult = await executeSkill(tc.function.name, {
              supabase: supabaseAdmin,
              userId: context.userId,
              profileId: ctx.profileId,
              isStaff: ctx.isStaff,
            }, args);
          } catch (e) {
            toolResult = { error: (e as Error).message };
          }
          const toolContent = JSON.stringify(toolResult).slice(0, 8000);
          await supabaseAdmin.from("conversation_messages").insert({
            conversation_id: data.conversation_id,
            role: "tool",
            content: toolContent,
            tool_call_id: tc.id,
            tool_name: tc.function.name,
          });
          messages.push({
            role: "tool",
            content: toolContent,
            tool_call_id: tc.id,
            name: tc.function.name,
          });
        }
        continue;
      }

      // Final answer
      finalAssistant = { role: "assistant", content: choice.content ?? "" };
      await supabaseAdmin.from("conversation_messages").insert({
        conversation_id: data.conversation_id,
        role: "assistant",
        content: choice.content ?? "",
      });
      break;
    }

    if (!finalAssistant) {
      const msg = "Limite de passos atingido.";
      await supabaseAdmin.from("conversation_messages").insert({
        conversation_id: data.conversation_id,
        role: "assistant",
        content: msg,
      });
      finalAssistant = { role: "assistant", content: msg };
    }

    // Touch conversation + auto-title from first user message
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (!conv.title || conv.title === "Nova conversa") {
      updates.title = data.user_message.slice(0, 60);
    }
    await supabaseAdmin.from("conversations").update(updates).eq("id", data.conversation_id);

    return { rag_active: ragActive, assistant: finalAssistant.content };
  });