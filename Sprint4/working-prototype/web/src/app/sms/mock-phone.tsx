"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type RosterEntry = { name: string; phone: string };

type ThreadMessage = {
  id: string;
  sender_type: "agent" | "patient" | "staff";
  body: string;
  sent_at: string;
};

type Thread = {
  conversation_id: string | null;
  patient_name: string | null;
  messages: ThreadMessage[];
};

const POLL_MS = 2500;

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MockPhone({
  clinicSlug,
  roster,
}: {
  clinicSlug: string;
  roster: RosterEntry[];
}) {
  const supabase = createClient();
  // "pick" is the dropdown value: a roster phone, or "__new__" for a custom number.
  const [pick, setPick] = useState<string>(roster[0]?.phone ?? "__new__");
  const [customPhone, setCustomPhone] = useState("");
  const phone = pick === "__new__" ? customPhone.trim() : pick;
  const [thread, setThread] = useState<Thread | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const activePatient = roster.find((p) => p.phone === phone);

  const loadThread = useCallback(async () => {
    if (!phone) return;
    const { data } = await supabase.rpc("mock_sms_thread", {
      p_clinic_slug: clinicSlug,
      p_phone: phone,
    });
    setThread((data as Thread | null) ?? { conversation_id: null, patient_name: null, messages: [] });
  }, [supabase, clinicSlug, phone]);

  // Poll the thread for the selected patient (picks up agent/staff replies).
  useEffect(() => {
    setThread(null);
    loadThread();
    const id = setInterval(loadThread, POLL_MS);
    return () => clearInterval(id);
  }, [loadThread]);

  // Keep the newest message in view.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [thread]);

  async function send() {
    const body = draft.trim();
    if (!body || sending || !phone) return;
    setSending(true);
    setDraft("");
    // Optimistic bubble while the RPC round-trips.
    setThread((prev) => ({
      conversation_id: prev?.conversation_id ?? null,
      patient_name: prev?.patient_name ?? activePatient?.name ?? null,
      messages: [
        ...(prev?.messages ?? []),
        {
          id: `optimistic-${Date.now()}`,
          sender_type: "patient",
          body,
          sent_at: new Date().toISOString(),
        },
      ],
    }));
    const { error } = await supabase.rpc("mock_sms_inbound", {
      p_clinic_slug: clinicSlug,
      p_phone: phone,
      p_body: body,
    });
    if (error) setDraft(body); // put it back so nothing is lost
    await loadThread();
    setSending(false);
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      {/* Patient picker — choose a known patient, or a brand-new number. */}
      <label className="flex flex-col gap-1 text-xs text-[#9aaaa4]">
        A escrever como
        <select
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          className="rounded-[14px] border border-[#2e453c] bg-[#1d2f28] px-3 py-2 text-sm text-[#eef4f1]"
        >
          {roster.map((p) => (
            <option key={p.phone} value={p.phone}>
              {p.name} · {p.phone}
            </option>
          ))}
          <option value="__new__">➕ Novo número (não registado)</option>
        </select>
      </label>

      {/* Custom number — texting from here creates a new patient profile. */}
      {pick === "__new__" && (
        <label className="flex flex-col gap-1 text-xs text-[#9aaaa4]">
          Número novo
          <input
            value={customPhone}
            onChange={(e) => setCustomPhone(e.target.value)}
            placeholder="+3519xxxxxxxx"
            inputMode="tel"
            className="rounded-[14px] border border-[#2e453c] bg-[#1d2f28] px-3 py-2 text-sm text-[#eef4f1] placeholder:text-[#63736d]"
          />
          <span className="text-[11px] text-[#7b8b85]">
            A primeira mensagem cria um perfil automaticamente.
          </span>
        </label>
      )}

      {/* Phone frame */}
      <div className="flex h-[32rem] flex-col overflow-hidden rounded-[28px] border border-[#2e453c] bg-[#101a17] shadow-xl">
        {/* Header — the clinic you're texting */}
        <div className="flex items-center gap-3 border-b border-[#2e453c] bg-[#16241f] px-4 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#2f7d62] text-sm font-semibold text-white">
            C
          </div>
          <div className="leading-tight">
            <p className="text-sm font-medium text-[#eef4f1]">Clínica Sousa</p>
            <p className="text-xs tabular-nums text-[#7b8b85]">
              {phone || "novo número — escreva acima"}
            </p>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-4">
          {thread === null ? (
            <p className="mt-8 text-center text-xs text-[#7b8b85]">A carregar…</p>
          ) : thread.messages.length === 0 ? (
            <p className="mt-8 text-center text-xs text-[#7b8b85]">
              Sem mensagens. Escreve para começar.
            </p>
          ) : (
            thread.messages.map((m) => {
              const mine = m.sender_type === "patient";
              return (
                <div
                  key={m.id}
                  className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
                >
                  {!mine && (
                    <span className="mb-0.5 px-1 text-[10px] uppercase tracking-wide text-[#7b8b85]">
                      {m.sender_type === "agent" ? "Assistente" : "Recepção"}
                    </span>
                  )}
                  <div
                    className={`max-w-[80%] rounded-[20px] px-3 py-2 text-sm ${
                      mine
                        ? "rounded-br-md bg-[#2f7d62] text-white"
                        : "rounded-bl-md bg-[#1d2f28] text-[#eef4f1]"
                    }`}
                  >
                    {m.body}
                  </div>
                  <span className="mt-0.5 px-1 text-[10px] tabular-nums text-[#63736d]">
                    {timeLabel(m.sent_at)}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Composer */}
        <div className="flex items-center gap-2 border-t border-[#2e453c] bg-[#16241f] px-3 py-3">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
            }}
            placeholder="Mensagem…"
            className="flex-1 rounded-full border border-[#2e453c] bg-[#1d2f28] px-4 py-2 text-sm text-[#eef4f1] placeholder:text-[#63736d] focus:border-[#3a8e6e] focus:outline-none"
          />
          <button
            onClick={send}
            disabled={sending || !draft.trim() || !phone}
            className="rounded-full bg-[#2f7d62] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}
