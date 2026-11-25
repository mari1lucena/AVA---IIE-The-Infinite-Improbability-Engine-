"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { replyAsStaff } from "@/app/(app)/conversations/actions";

type Message = {
  id: string;
  sender_type: string;
  body: string;
  sent_at: string | null;
};

const POLL_MS = 2500;

function timeLabel(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const SENDER: Record<string, string> = {
  patient: "Paciente",
  agent: "Assistente",
  staff: "Equipa",
};

export function StaffThread({
  conversationId,
  initialMessages,
}: {
  conversationId: string;
  initialMessages: Message[];
}) {
  const supabase = createClient();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("messages")
      .select("id, sender_type, body, sent_at")
      .eq("conversation_id", conversationId)
      .order("sent_at", { ascending: true });
    if (data) setMessages(data);
  }, [supabase, conversationId]);

  // Poll for patient/agent replies landing from the other side.
  useEffect(() => {
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  function send() {
    const body = draft.trim();
    if (!body || pending) return;
    setDraft("");
    startTransition(async () => {
      const res = await replyAsStaff(conversationId, body);
      if (res.error) setDraft(body);
      await load();
    });
  }

  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col bg-canvas">
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-6">
        {messages.length === 0 ? (
          <p className="mt-8 text-center text-sm text-faint">
            Sem mensagens nesta conversa.
          </p>
        ) : (
          messages.map((m) => {
            const isStaffOrAgent =
              m.sender_type === "staff" || m.sender_type === "agent";
            return (
              <div
                key={m.id}
                className={`flex flex-col ${
                  isStaffOrAgent ? "items-end" : "items-start"
                }`}
              >
                <span className="mb-0.5 px-1 text-[10px] uppercase tracking-wide text-faint">
                  {SENDER[m.sender_type] ?? m.sender_type}
                </span>
                <div
                  className={`max-w-[70%] rounded-[20px] px-3.5 py-2 text-sm ${
                    m.sender_type === "staff"
                      ? "rounded-br-md bg-brand-solid text-brand-on"
                      : m.sender_type === "agent"
                        ? "rounded-br-md bg-brand-subtle text-ink"
                        : "rounded-bl-md bg-surface text-ink shadow-sm ring-1 ring-line"
                  }`}
                >
                  {m.body}
                </div>
                <span className="mt-0.5 px-1 text-[10px] tabular-nums text-faint">
                  {timeLabel(m.sent_at)}
                </span>
              </div>
            );
          })
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-line bg-surface px-4 py-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
          placeholder="Responder como equipa…"
          className="flex-1 rounded-full border border-line bg-surface px-4 py-2 text-sm text-ink placeholder:text-faint focus:border-brand focus:outline-none"
        />
        <button
          onClick={send}
          disabled={pending || !draft.trim()}
          className="rounded-full bg-brand-solid px-4 py-2 text-sm font-medium text-white hover:bg-brand-solid-hover disabled:opacity-40"
        >
          Enviar
        </button>
      </div>
    </div>
  );
}
