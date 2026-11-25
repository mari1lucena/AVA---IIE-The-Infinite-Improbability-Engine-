"use client";

import { useRef } from "react";
import { updateReceptionNotify } from "./actions";

/**
 * Single toggle: whether reception-initiated changes made through the dashboard
 * command box notify the patient by SMS. Auto-saves on change.
 */
export function ReceptionSettingsForm({ defaultOn }: { defaultOn: boolean }) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={updateReceptionNotify}>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="notify_patient_on_reception_change"
          defaultChecked={defaultOn}
          onChange={() => ref.current?.requestSubmit()}
          className="mt-0.5 h-4 w-4 accent-brand-solid"
        />
        <span>
          <span className="text-sm font-medium text-ink">
            Notificar o paciente por SMS
          </span>
          <span className="mt-0.5 block text-xs text-muted">
            Quando remarca, marca ou cancela uma consulta pelo comando de agenda,
            envia automaticamente uma confirmação por SMS ao paciente. Pode
            desligar por comando. Pacientes com opt-out nunca são notificados.
          </span>
        </span>
      </label>
    </form>
  );
}
