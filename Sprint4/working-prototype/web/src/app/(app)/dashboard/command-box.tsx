"use client";

import { useState, useTransition } from "react";
import {
  Wand2,
  ArrowRight,
  Check,
  X,
  AlertTriangle,
  CalendarPlus,
  CalendarX,
  CalendarClock,
  Repeat,
} from "lucide-react";
import {
  planCommand,
  planFromCommand,
  applyCommand,
  type Plan,
  type PlanAction,
  type PlanResponse,
} from "./command-actions";
import type { ReceptionCommand } from "@/lib/reception/parse";

type Ready = {
  plan: Plan;
  command: ReceptionCommand;
  patientId: string | null;
};

const OP_META: Record<
  string,
  { icon: typeof CalendarClock; verb: string }
> = {
  reschedule: { icon: CalendarClock, verb: "Remarcar" },
  book: { icon: CalendarPlus, verb: "Marcar" },
  cancel: { icon: CalendarX, verb: "Cancelar" },
  recurring: { icon: Repeat, verb: "Marcar série" },
};

function problemText(plan: Plan): string {
  const p = plan.patient?.name;
  switch (plan.problem) {
    case "patient_not_found":
      return `Não encontrei nenhum paciente com “${plan.query ?? ""}”.`;
    case "no_patient_name":
      return "Não percebi de que paciente se trata.";
    case "no_current_appt":
      return `${p ?? "O paciente"} não tem nenhuma consulta futura.`;
    case "missing_datetime":
      return "Falta indicar a data ou a hora.";
    case "doctor_not_found":
      return `Não encontrei o médico “${plan.query ?? ""}”.`;
    case "target_in_past":
      return "Essa data/hora já passou.";
    case "incomplete_recurrence":
      return "Faltam dados da repetição (dia da semana, hora, início e fim).";
    case "no_dates":
      return "Não há datas futuras para essa repetição.";
    case "unknown_op":
      return "Não percebi a ação pretendida.";
    default:
      return "Não foi possível interpretar o comando.";
  }
}

function ActionRow({ a }: { a: PlanAction }) {
  const conflict = a.status !== "ok";
  return (
    <div
      className={
        "flex items-center gap-2 rounded-[12px] border px-3 py-2 text-sm " +
        (conflict
          ? "border-amber-500/30 bg-amber-500/5 text-muted"
          : "border-line bg-surface-sunken text-ink")
      }
    >
      {a.kind === "cancel" ? (
        <span className="font-mono tabular-nums line-through decoration-muted/60">
          {a.from_lisbon}
        </span>
      ) : a.kind === "reschedule" ? (
        <>
          <span className="font-mono tabular-nums text-muted line-through decoration-muted/60">
            {a.from_lisbon}
          </span>
          <ArrowRight className="h-3.5 w-3.5 flex-none text-faint" />
          <span className="font-mono font-medium tabular-nums">
            {a.to_lisbon}
          </span>
        </>
      ) : (
        <span className="font-mono font-medium tabular-nums">
          {a.to_lisbon}
        </span>
      )}
      {a.doctor_name && (
        <span className="truncate text-xs text-muted">· {a.doctor_name}</span>
      )}
      <span className="ml-auto flex-none">
        {conflict ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600">
            <AlertTriangle className="h-3.5 w-3.5" /> sem vaga
          </span>
        ) : (
          <Check className="h-4 w-4" style={{ color: "#3d9647" }} />
        )}
      </span>
    </div>
  );
}

export function CommandBox({ defaultNotify }: { defaultNotify: boolean }) {
  const [text, setText] = useState("");
  const [ready, setReady] = useState<Ready | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notify, setNotify] = useState(defaultNotify);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function reset() {
    setReady(null);
    setError(null);
    setDone(null);
  }

  function receive(res: PlanResponse) {
    if (!res.ok) {
      setReady(null);
      setError(res.error);
      return;
    }
    setReady({ plan: res.plan, command: res.command, patientId: res.patientId });
    setError(null);
  }

  function interpret() {
    setError(null);
    setDone(null);
    start(async () => receive(await planCommand(text)));
  }

  // Re-plan for a chosen patient (disambiguation) — no LLM call.
  function pickCandidate(patientId: string) {
    if (!ready) return;
    start(async () => receive(await planFromCommand(ready.command, patientId)));
  }

  // Re-plan at a chosen alternative time — override the command's time.
  function pickTime(hhmm: string) {
    if (!ready) return;
    const cmd = { ...ready.command, time: hhmm };
    start(async () => receive(await planFromCommand(cmd, ready.patientId)));
  }

  function confirm() {
    if (!ready) return;
    start(async () => {
      const res = await applyCommand(ready.command, ready.patientId, notify);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const msg =
        res.applied === 0
          ? "Nada foi aplicado (sem vagas)."
          : `${res.applied} alteração${res.applied > 1 ? "ões" : ""} aplicada${
              res.applied > 1 ? "s" : ""
            } à agenda${res.notified ? " · paciente notificado" : ""}.`;
      setReady(null);
      setText("");
      setDone(msg);
    });
  }

  const plan = ready?.plan;
  const op = plan?.op ?? ready?.command.op;
  const meta = (op && OP_META[op]) || OP_META.book;
  const OpIcon = meta.icon;
  const applicable = plan?.applicable ?? 0;
  const conflicts = plan?.conflicts ?? 0;
  // For a single op with no vaga at the exact time, offer the nearest slots.
  const alternatives =
    op !== "recurring" && applicable === 0
      ? (plan?.actions?.[0]?.alternatives ?? [])
      : [];

  return (
    <div className="rounded-[22px] border border-line bg-surface p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <span
          className="grid h-[34px] w-[34px] place-items-center rounded-[14px]"
          style={{
            background: "color-mix(in srgb, #2f7d62 14%, transparent)",
            color: "#2f7d62",
          }}
        >
          <Wand2 className="h-[17px] w-[17px]" strokeWidth={2} />
        </span>
        <div>
          <h3 className="text-lg font-semibold tracking-[-0.03em] text-ink">
            Comando de agenda
          </h3>
          <p className="text-xs text-muted">
            Escreva o que quer fazer. Confirma antes de aplicar.
          </p>
        </div>
      </div>

      <div className="mt-4">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") interpret();
          }}
          rows={2}
          placeholder="ex.: Remarcar a Ana para amanhã às 12:00"
          className="w-full resize-y rounded-[12px] border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-muted/60 focus:border-line-strong focus:outline-none"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            onClick={() => interpret()}
            disabled={pending || text.trim() === ""}
            className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            style={{ background: "#2f7d62" }}
          >
            <Wand2 className="h-4 w-4" />
            {pending && !ready ? "A interpretar…" : "Interpretar"}
          </button>
          {(ready || error || done) && (
            <button
              onClick={reset}
              className="rounded-[10px] px-2.5 py-1.5 text-sm text-muted hover:bg-surface-alt hover:text-ink"
            >
              Limpar
            </button>
          )}
          {!ready && !error && !done && (
            <span className="text-xs text-faint">⌘/Ctrl + Enter</span>
          )}
        </div>
      </div>

      {/* Success */}
      {done && (
        <div className="mt-4 flex items-start gap-2 rounded-[12px] border border-success/30 bg-success-bg px-3 py-2.5 text-sm text-success-fg">
          <Check className="mt-0.5 h-4 w-4 flex-none" />
          <span>{done}</span>
        </div>
      )}

      {/* Error / not interpretable */}
      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-[12px] border border-danger/30 bg-danger-bg px-3 py-2.5 text-sm text-danger-fg">
          <X className="mt-0.5 h-4 w-4 flex-none" />
          <span>{error}</span>
        </div>
      )}

      {/* Problem plan (patient not found, ambiguous, no appt, …) */}
      {plan && !plan.ok && (
        <div className="mt-4 rounded-[14px] border border-line bg-surface-sunken p-4">
          <p className="text-sm text-ink">{problemText(plan)}</p>
          {plan.problem === "ambiguous_patient" && plan.candidates && (
            <div className="mt-3 flex flex-wrap gap-2">
              {plan.candidates.map((c) => (
                <button
                  key={c.id}
                  onClick={() => pickCandidate(c.id)}
                  disabled={pending}
                  className="rounded-[10px] border border-line bg-surface px-3 py-1.5 text-sm text-ink hover:border-line-strong disabled:opacity-50"
                >
                  {c.name}
                  <span className="ml-1.5 font-mono text-xs text-faint">
                    {c.phone}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Preview — "Vou aplicar" */}
      {plan && plan.ok && (
        <div className="mt-4 rounded-[14px] border border-line bg-surface-sunken p-4">
          <div className="flex items-center gap-2">
            <OpIcon className="h-4 w-4 text-ink" />
            <span className="text-sm font-semibold text-ink">
              {meta.verb} · {plan.patient?.name}
            </span>
            {op === "recurring" && (
              <span className="ml-auto font-mono text-xs text-muted">
                {applicable} marcada{applicable !== 1 ? "s" : ""}
                {conflicts > 0 ? ` · ${conflicts} sem vaga` : ""}
              </span>
            )}
          </div>

          {plan.doctor?.auto && (
            <p className="mt-1 text-xs text-muted">
              Médico atribuído automaticamente: {plan.doctor.name}
            </p>
          )}

          <div
            className={
              "mt-3 flex flex-col gap-1.5 " +
              (op === "recurring"
                ? "max-h-56 overflow-y-auto pr-1"
                : "")
            }
          >
            {plan.actions?.map((a, i) => (
              <ActionRow key={i} a={a} />
            ))}
          </div>

          {/* No vaga at the exact time — offer the nearest real slots */}
          {alternatives.length > 0 && (
            <div className="mt-3 rounded-[12px] border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="text-xs text-muted">
                Sem vaga a essa hora. Horários mais próximos disponíveis:
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {alternatives.map((alt) => (
                  <button
                    key={alt.slot_id}
                    onClick={() => pickTime(alt.time)}
                    disabled={pending}
                    className="rounded-[10px] border border-line bg-surface px-3 py-1.5 font-mono text-sm font-medium tabular-nums text-ink hover:border-line-strong disabled:opacity-50"
                  >
                    {alt.time}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Notify + confirm */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={notify}
                onChange={(e) => setNotify(e.target.checked)}
                disabled={plan.patient?.opted_out}
                className="h-4 w-4 accent-brand-solid"
              />
              Notificar o paciente por SMS
              {plan.patient?.opted_out && (
                <span className="text-xs text-faint">
                  (paciente com opt-out — não será notificado)
                </span>
              )}
            </label>

            <div className="flex items-center gap-2">
              <button
                onClick={reset}
                className="rounded-[10px] px-3 py-1.5 text-sm text-muted hover:bg-surface-alt hover:text-ink"
              >
                Cancelar
              </button>
              <button
                onClick={confirm}
                disabled={pending || applicable === 0}
                className="inline-flex items-center gap-1.5 rounded-[10px] px-3.5 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                style={{ background: "#2f7d62" }}
              >
                <Check className="h-4 w-4" />
                {pending ? "A aplicar…" : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
