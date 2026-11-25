"use client";

import { useFormStatus } from "react-dom";
import { Check } from "lucide-react";
import { updateAgentSettings, resetAgentSettings } from "./actions";

export type AgentSettings = {
  agent_name: string | null;
  agent_tone: string;
  agent_language: string;
  agent_signature: string | null;
  agent_use_emoji: boolean;
  agent_custom_instructions: string | null;
};

const FIELD =
  "w-full rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-muted/60 focus:border-line-strong focus:outline-none";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex items-center gap-1.5 rounded-[8px] border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-alt disabled:opacity-60"
    >
      <Check className="h-4 w-4" />
      {pending ? "A guardar…" : "Guardar"}
    </button>
  );
}

/**
 * Edits how the agent presents itself and a few low-risk behaviour knobs. Saved
 * on the clinic and read by the n8n agent via `agent_context`. All defaults keep
 * today's behaviour (no name, formal você, Portuguese, no emojis).
 */
export function AgentSettingsForm({ defaults }: { defaults: AgentSettings }) {
  return (
    <form action={updateAgentSettings} className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-ink">Nome do agente</span>
          <span className="mt-0.5 block text-xs text-muted">
            Como o agente assina as mensagens. Deixe vazio para não usar nome.
          </span>
          <input
            name="agent_name"
            defaultValue={defaults.agent_name ?? ""}
            placeholder="ex.: Sofia"
            className={`mt-2 ${FIELD}`}
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-ink">Assinatura</span>
          <span className="mt-0.5 block text-xs text-muted">
            Linha de fecho opcional no fim das mensagens.
          </span>
          <input
            name="agent_signature"
            defaultValue={defaults.agent_signature ?? ""}
            placeholder="ex.: Receção — Clínica Sousa"
            className={`mt-2 ${FIELD}`}
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-ink">Tratamento</span>
          <span className="mt-0.5 block text-xs text-muted">
            Como o agente trata o paciente.
          </span>
          <select
            name="agent_tone"
            defaultValue={defaults.agent_tone}
            className={`mt-2 ${FIELD}`}
          >
            <option value="formal">Formal (você)</option>
            <option value="informal">Informal (tu)</option>
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-ink">Idioma</span>
          <span className="mt-0.5 block text-xs text-muted">
            Idioma das respostas do agente.
          </span>
          <select
            name="agent_language"
            defaultValue={defaults.agent_language}
            className={`mt-2 ${FIELD}`}
          >
            <option value="pt">Sempre português europeu</option>
            <option value="mirror">Responder no idioma do paciente</option>
          </select>
        </label>
      </div>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="agent_use_emoji"
          defaultChecked={defaults.agent_use_emoji}
          className="mt-0.5 h-4 w-4 accent-brand-solid"
        />
        <span>
          <span className="text-sm font-medium text-ink">Permitir emojis</span>
          <span className="mt-0.5 block text-xs text-muted">
            Deixa o agente usar emojis, com moderação. Desligado por defeito.
          </span>
        </span>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-ink">Instruções adicionais</span>
        <span className="mt-0.5 block text-xs text-muted">
          Orientações livres para o agente (ex.: mencionar o parque de
          estacionamento, pedir para chegar 10 min antes). Não altera as regras de
          marcação nem de segurança.
        </span>
        <textarea
          name="agent_custom_instructions"
          defaultValue={defaults.agent_custom_instructions ?? ""}
          rows={3}
          placeholder="ex.: Lembrar os pacientes de trazer exames anteriores."
          className={`mt-2 ${FIELD} resize-y`}
        />
      </label>

      <div className="flex items-center justify-between gap-3">
        <button
          type="submit"
          formAction={resetAgentSettings}
          onClick={(e) => {
            if (
              !window.confirm(
                "Repor as predefinições do agente? As suas personalizações serão apagadas.",
              )
            )
              e.preventDefault();
          }}
          className="rounded-[8px] px-3 py-1.5 text-sm font-medium text-muted hover:bg-surface-alt hover:text-ink"
        >
          Repor predefinições
        </button>
        <SubmitButton />
      </div>
    </form>
  );
}
