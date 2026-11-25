import "server-only";

/**
 * Natural-language reception command → normalized command JSON.
 *
 * The dashboard command box lets a receptionist type a plain instruction
 * ("remarcar António Silva para amanhã às 12:00", "Pedro Silva todas as
 * sextas às 14:00 durante 2 meses", "cancelar a consulta da Ana"). This turns
 * that free text into the structured shape the `reception_plan` RPC consumes.
 *
 * The LLM ONLY parses — it never touches the database. All resolution,
 * conflict-checking and writing happen deterministically in the Postgres fat
 * RPCs (reception_plan / reception_apply). Groq is primary; Gemini is the
 * fallback when Groq is unavailable (same two providers the SMS agent uses).
 */

export type Recurrence = {
  weekday: number; // ISO 1=Mon .. 7=Sun
  time: string; // "HH:MM"
  start_date: string; // "YYYY-MM-DD"
  end_date: string; // "YYYY-MM-DD"
};

export type ReceptionCommand = {
  op: "reschedule" | "book" | "cancel" | "recurring" | "unknown";
  patient_name: string | null;
  doctor_name: string | null;
  date: string | null; // "YYYY-MM-DD" (absolute, relative dates resolved)
  time: string | null; // "HH:MM" 24h
  recurrence: Recurrence | null;
};

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
// gpt-oss-120b is what this Groq account actually serves (Llama models were
// decommissioned — a 404 model_not_found, not a quota issue). Override with
// GROQ_MODEL if the account's model list changes; check the /models endpoint.
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

/** Today in Europe/Lisbon, so the model can resolve "amanhã", "sexta", etc. */
function lisbonToday(): { date: string; weekday: number; label: string } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  const date = `${y}-${m}-${d}`;
  // ISO weekday (1=Mon..7=Sun) from a noon-UTC anchor of that Lisbon date.
  const js = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  const weekday = js === 0 ? 7 : js;
  const label = new Intl.DateTimeFormat("pt-PT", {
    timeZone: "Europe/Lisbon",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
  return { date, weekday, label };
}

function systemPrompt(): string {
  const t = lisbonToday();
  return `És um interpretador de comandos de receção de uma clínica. Recebes uma instrução escrita por um rececionista (em português europeu ou inglês) e devolves APENAS um objeto JSON com a intenção, sem texto à volta.

Hoje é ${t.label} (${t.date}, dia da semana ISO ${t.weekday}, onde 1=segunda … 7=domingo), fuso Europe/Lisbon.

Campos do JSON:
- "op": um de "reschedule" (remarcar/mudar uma consulta existente), "book" (marcar UMA nova consulta), "cancel" (cancelar/desmarcar), "recurring" (marcar uma série repetida), ou "unknown" se não perceberes.
- "patient_name": nome do paciente tal como escrito, ou null.
- "doctor_name": nome/apelido do médico se for mencionado (ex.: "Dr. Sousa", "Lima"), senão null.
- "date": data absoluta "YYYY-MM-DD" para op reschedule/book. Resolve datas relativas a partir de hoje ("amanhã", "sexta", "próxima terça", "dia 20"). null se não indicada.
- "time": hora "HH:MM" em formato 24h (ex.: "14:00"). Converte "2 da tarde"→"14:00", "meio-dia"→"12:00". null se não indicada.
- "recurrence": só para op "recurring", um objeto { "weekday": 1-7 ISO, "time": "HH:MM", "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD" }. Para "todas as sextas às 14:00 durante 2 meses": weekday=5, time="14:00", start_date=a próxima sexta a partir de hoje (inclusive), end_date=start_date + 2 meses. Para "durante 8 semanas" soma 8 semanas. Senão null.

Regras:
- Devolve SEMPRE JSON válido, apenas o objeto.
- Não inventes nomes nem horas que não estejam na instrução.
- Se faltar informação essencial (ex.: reschedule sem hora), deixa esse campo a null — não adivinhes.`;
}

const EXPECT_KEYS: (keyof ReceptionCommand)[] = [
  "op",
  "patient_name",
  "doctor_name",
  "date",
  "time",
  "recurrence",
];

function normalize(raw: unknown): ReceptionCommand | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const op = String(o.op ?? "unknown");
  const valid = ["reschedule", "book", "cancel", "recurring", "unknown"];
  const cmd: ReceptionCommand = {
    op: (valid.includes(op) ? op : "unknown") as ReceptionCommand["op"],
    patient_name: strOrNull(o.patient_name),
    doctor_name: strOrNull(o.doctor_name),
    date: strOrNull(o.date),
    time: strOrNull(o.time),
    recurrence: null,
  };
  const rec = o.recurrence;
  if (rec && typeof rec === "object") {
    const r = rec as Record<string, unknown>;
    const wd = Number(r.weekday);
    if (wd >= 1 && wd <= 7 && r.time && r.start_date && r.end_date) {
      cmd.recurrence = {
        weekday: wd,
        time: String(r.time),
        start_date: String(r.start_date),
        end_date: String(r.end_date),
      };
    }
  }
  void EXPECT_KEYS;
  return cmd;
}

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" || s.toLowerCase() === "null" ? null : s;
}

async function callGroq(text: string): Promise<ReceptionCommand | null> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt() },
        { role: "user", content: text },
      ],
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`groq ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  return normalize(JSON.parse(content));
}

async function callGemini(text: string): Promise<ReceptionCommand | null> {
  const key =
    process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!key) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt() }] },
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
      },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return normalize(JSON.parse(content));
}

/**
 * Parse free reception text into a normalized command. Groq first, Gemini on
 * failure. Returns { command } on success or { error } when both providers
 * fail or no key is configured.
 */
export async function parseCommand(
  text: string,
): Promise<{ command: ReceptionCommand | null; error?: string }> {
  const clean = text.trim();
  if (!clean) return { command: null, error: "empty" };

  const haveGroq = Boolean(process.env.GROQ_API_KEY);
  const haveGemini = Boolean(
    process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  );
  if (!haveGroq && !haveGemini) {
    return {
      command: null,
      error:
        "Nenhum modelo configurado. Defina GROQ_API_KEY (ou GEMINI_API_KEY) em .env.local.",
    };
  }

  const errors: string[] = [];
  for (const provider of [callGroq, callGemini]) {
    try {
      const command = await provider(clean);
      if (command) return { command };
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return {
    command: null,
    error: `Falha ao interpretar o comando. ${errors.join(" | ")}`,
  };
}
