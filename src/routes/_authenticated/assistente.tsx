import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Send, Plus, Trash2, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useProfile, hasRole } from "@/hooks/use-profile";
import {
  listConversations,
  createConversation,
  getConversation,
  sendChatMessage,
  deleteConversation,
} from "@/lib/llm.functions";
import { listAgents } from "@/lib/agents.functions";

export const Route = createFileRoute("/_authenticated/assistente")({ component: Page });

function Page() {
  const qc = useQueryClient();
  const { data: profile } = useProfile();
  const isStaff = hasRole(profile?.roles, "admin", "staff");

  const listConvFn = useServerFn(listConversations);
  const createConvFn = useServerFn(createConversation);
  const getConvFn = useServerFn(getConversation);
  const sendFn = useServerFn(sendChatMessage);
  const delConvFn = useServerFn(deleteConversation);
  const listAgentsFn = useServerFn(listAgents);

  const [eventId, setEventId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.from("events").select("id").limit(1).maybeSingle().then(({ data }) => {
      if (data) setEventId(data.id);
    });
  }, []);

  const { data: convs } = useQuery({
    queryKey: ["convs", eventId],
    enabled: !!eventId,
    queryFn: () => listConvFn({ data: { event_id: eventId! } }),
  });

  const { data: agents } = useQuery({
    queryKey: ["agents-list", eventId],
    enabled: !!eventId && isStaff,
    queryFn: () => listAgentsFn({ data: { event_id: eventId! } }),
  });

  const { data: active } = useQuery({
    queryKey: ["conv", activeId],
    enabled: !!activeId,
    queryFn: () => getConvFn({ data: { id: activeId! } }),
  });

  const activeAgent = agents?.find((a) => a.id === active?.conversation.agent_id);
  const ragActive = isStaff && !!activeAgent?.rag_enabled;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [active?.messages.length]);

  const newConv = useMutation({
    mutationFn: async () => createConvFn({ data: { event_id: eventId!, agent_id: agentId ?? undefined } }),
    onSuccess: (r) => {
      setActiveId(r.id);
      qc.invalidateQueries({ queryKey: ["convs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const send = useMutation({
    mutationFn: async (msg: string) => sendFn({ data: { conversation_id: activeId!, user_message: msg } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conv", activeId] });
      qc.invalidateQueries({ queryKey: ["convs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeConv = useMutation({
    mutationFn: async (id: string) => delConvFn({ data: { id } }),
    onSuccess: () => {
      setActiveId(null);
      qc.invalidateQueries({ queryKey: ["convs"] });
    },
  });

  const handleSend = () => {
    if (!input.trim() || !activeId) return;
    const msg = input.trim();
    setInput("");
    send.mutate(msg);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 grid gap-4 md:grid-cols-[260px_1fr] h-[calc(100vh-8rem)]">
      <Card className="p-3 flex flex-col gap-2 overflow-hidden">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm">Conversas</h2>
          <Button size="sm" variant="ghost" onClick={() => newConv.mutate()} disabled={!eventId}>
            <Plus size={16} />
          </Button>
        </div>
        {isStaff && agents && agents.length > 0 && (
          <select
            className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
            value={agentId ?? ""}
            onChange={(e) => setAgentId(e.target.value || null)}
          >
            <option value="">Agente default</option>
            {agents.filter((a) => a.is_active).map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        )}
        <div className="flex-1 overflow-auto space-y-1">
          {(convs ?? []).map((c) => (
            <div
              key={c.id}
              className={`flex items-center gap-1 rounded px-2 py-1.5 text-sm cursor-pointer hover:bg-muted ${activeId === c.id ? "bg-muted" : ""}`}
              onClick={() => setActiveId(c.id)}
            >
              <span className="flex-1 truncate">{c.title || "Sem título"}</span>
              <button
                onClick={(e) => { e.stopPropagation(); removeConv.mutate(c.id); }}
                className="opacity-60 hover:opacity-100"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {(convs ?? []).length === 0 && (
            <p className="text-xs text-muted-foreground px-2 py-4">Nenhuma conversa ainda.</p>
          )}
        </div>
      </Card>

      <Card className="flex flex-col overflow-hidden">
        <div className="border-b border-border px-4 py-2 flex items-center gap-2">
          <Sparkles size={16} className="text-primary" />
          <span className="font-semibold text-sm">Assistente do Evento</span>
          {ragActive && <Badge variant="secondary" className="text-xs">RAG ativo</Badge>}
          {activeAgent && <span className="text-xs text-muted-foreground ml-auto">{activeAgent.name}</span>}
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-4">
          {!activeId && (
            <div className="text-center text-muted-foreground py-12">
              <p>Selecione ou crie uma conversa para começar.</p>
            </div>
          )}
          {active?.messages.filter((m) => m.role !== "system").map((m) => (
            <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
              {m.role === "user" ? (
                <div className="max-w-[80%] rounded-2xl bg-primary text-primary-foreground px-4 py-2 text-sm">
                  {m.content}
                </div>
              ) : m.role === "tool" ? (
                <details className="text-xs text-muted-foreground border border-border rounded p-2">
                  <summary className="cursor-pointer">🔧 {m.tool_name}</summary>
                  <pre className="mt-2 overflow-auto text-[10px]">{m.content}</pre>
                </details>
              ) : (
                <div className="max-w-[85%] text-sm prose prose-sm dark:prose-invert">
                  <ReactMarkdown>{m.content || ""}</ReactMarkdown>
                  {m.tool_calls && (
                    <p className="text-xs text-muted-foreground mt-1">↳ chamando ferramentas…</p>
                  )}
                </div>
              )}
            </div>
          ))}
          {send.isPending && (
            <p className="text-xs text-muted-foreground animate-pulse">Pensando…</p>
          )}
          <div ref={bottomRef} />
        </div>

        {activeId && (
          <div className="border-t border-border p-3 flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Pergunte algo…"
              rows={2}
              className="resize-none"
            />
            <Button onClick={handleSend} disabled={!input.trim() || send.isPending}>
              <Send size={16} />
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}