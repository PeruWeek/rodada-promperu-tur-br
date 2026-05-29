import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptSecret } from "./crypto.server";

export type BaseUrlMode = "api" | "free";

export function resolveBaseUrl(mode: BaseUrlMode): string {
  return mode === "api"
    ? "https://openrouter.ai/api/v1"
    : "https://openrouter.ai/openrouter/free";
}

export async function getOpenRouterKey(userId: string): Promise<{ key: string; source: "user" | "app" }> {
  const { data } = await supabaseAdmin
    .from("user_llm_credentials")
    .select("api_key_encrypted")
    .eq("user_id", userId)
    .maybeSingle();
  if (data?.api_key_encrypted) {
    try {
      return { key: decryptSecret(data.api_key_encrypted), source: "user" };
    } catch (e) {
      console.error("[openrouter] failed to decrypt user key", e);
    }
  }
  const app = process.env.OPENROUTER_API_KEY_APP;
  if (!app) throw new Error("Nenhuma chave OpenRouter configurada. Configure suas credenciais ou peça ao admin.");
  return { key: app, source: "app" };
}

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
};

export type ChatCompletionResponse = {
  choices: Array<{
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason?: string;
  }>;
};

export async function chatCompletion(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number | null;
  max_tokens?: number | null;
  messages: ChatMessage[];
  tools?: Array<{
    type: "function";
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }>;
}): Promise<ChatCompletionResponse> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
  };
  if (typeof opts.temperature === "number") body.temperature = opts.temperature;
  if (typeof opts.max_tokens === "number") body.max_tokens = opts.max_tokens;
  if (opts.tools && opts.tools.length > 0) body.tools = opts.tools;

  const res = await fetch(`${opts.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
      "HTTP-Referer": "https://rsvp.promperu.tur.br",
      "X-Title": "Rodada Peru - Assistente",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 500)}`);
  }
  return (await res.json()) as ChatCompletionResponse;
}

export async function embed(text: string, apiKey: string): Promise<number[]> {
  const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://rsvp.promperu.tur.br",
      "X-Title": "Rodada Peru - RAG",
    },
    body: JSON.stringify({ model: "baai/bge-m3", input: text }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Embedding ${res.status}: ${t.slice(0, 300)}`);
  }
  const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
  const vec = json.data?.[0]?.embedding;
  if (!Array.isArray(vec) || vec.length !== 1024) {
    throw new Error(`Embedding inválido (esperado 1024 dims, recebeu ${vec?.length ?? 0}).`);
  }
  return vec;
}