import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { embed, getOpenRouterKey } from "./llm/openrouter.server";

async function assertStaff(userId: string) {
  const { data } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
  const ok = (data ?? []).some((r) => r.role === "admin" || r.role === "staff");
  if (!ok) throw new Error("Forbidden: RAG é restrito a admin/staff");
}

function chunkText(text: string, size = 800, overlap = 100): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= size) return [clean];
  const out: string[] = [];
  let i = 0;
  while (i < clean.length) {
    out.push(clean.slice(i, i + size));
    i += size - overlap;
  }
  return out;
}

export const listRagDocuments = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ event_id: z.string().uuid() }).parse(i))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertStaff(context.userId);
    const { data: docs, error } = await supabaseAdmin
      .from("rag_documents")
      .select("id, title, source_url, mime, created_at, updated_at")
      .eq("event_id", data.event_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const ids = (docs ?? []).map((d) => d.id);
    const counts: Record<string, number> = {};
    if (ids.length > 0) {
      const { data: chunks } = await supabaseAdmin
        .from("rag_chunks")
        .select("document_id")
        .in("document_id", ids);
      for (const c of chunks ?? []) {
        counts[c.document_id] = (counts[c.document_id] ?? 0) + 1;
      }
    }
    return (docs ?? []).map((d) => ({ ...d, chunk_count: counts[d.id] ?? 0 }));
  });

export const ingestRagText = createServerFn({ method: "POST" })
  .inputValidator((i) =>
    z
      .object({
        event_id: z.string().uuid(),
        title: z.string().min(1).max(300),
        source_url: z.string().url().max(500).optional().or(z.literal("")),
        text: z.string().min(20).max(200_000),
      })
      .parse(i),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertStaff(context.userId);
    const { key } = await getOpenRouterKey(context.userId);
    const { data: doc, error } = await supabaseAdmin
      .from("rag_documents")
      .insert({
        event_id: data.event_id,
        title: data.title,
        source_url: data.source_url || null,
        mime: "text/plain",
        raw_text: data.text,
      })
      .select("id")
      .maybeSingle();
    if (error || !doc) throw new Error(error?.message ?? "Falha ao criar documento");

    const chunks = chunkText(data.text);
    let chunkIndex = 0;
    for (const c of chunks) {
      const vec = await embed(c, key);
      const { error: e2 } = await supabaseAdmin.from("rag_chunks").insert({
        document_id: doc.id,
        event_id: data.event_id,
        chunk_index: chunkIndex++,
        content: c,
        metadata: { title: data.title },
        embedding: vec as unknown as string,
      });
      if (e2) throw new Error(e2.message);
    }
    return { document_id: doc.id, chunks: chunks.length };
  });

export const deleteRagDocument = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertStaff(context.userId);
    const { error } = await supabaseAdmin.from("rag_documents").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const ragSearch = createServerFn({ method: "POST" })
  .inputValidator((i) =>
    z
      .object({
        event_id: z.string().uuid(),
        query: z.string().min(1).max(2000),
        top_k: z.number().int().min(1).max(20).default(5),
      })
      .parse(i),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertStaff(context.userId);
    const { key } = await getOpenRouterKey(context.userId);
    const vec = await embed(data.query, key);
    const { data: rows, error } = await supabaseAdmin.rpc("match_rag_chunks", {
      p_event_id: data.event_id,
      p_query: vec as unknown as string,
      p_top_k: data.top_k,
    });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });