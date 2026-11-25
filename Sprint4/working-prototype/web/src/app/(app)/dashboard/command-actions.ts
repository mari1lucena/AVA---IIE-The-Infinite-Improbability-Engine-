"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { parseCommand, type ReceptionCommand } from "@/lib/reception/parse";
import type { Json } from "@/lib/database.types";

/**
 * Server actions for the dashboard command box. The LLM parse runs here (in the
 * app, not n8n); all agenda resolution/validation/writing is done by the
 * `reception_plan` / `reception_apply` fat RPCs, called via the service client.
 *
 * Tenant safety: the clinic id is always taken from the signed-in staff member,
 * never from the client. `applyCommand` re-plans server-side from the structured
 * command rather than trusting a plan sent back by the browser, so a tampered
 * payload can't reach another clinic's patients or slots.
 */

export type Alternative = { slot_id: string; time: string; to_lisbon: string };

export type PlanAction = {
  kind: "reschedule" | "book" | "cancel";
  status: "ok" | "no_slot";
  doctor_name?: string | null;
  doctor_auto?: boolean;
  to_lisbon?: string;
  to_label?: string;
  from_lisbon?: string;
  from_label?: string;
  alternatives?: Alternative[];
};

export type Plan = {
  ok: boolean;
  op?: string;
  problem?: string;
  query?: string;
  patient?: { id: string; name: string; opted_out?: boolean };
  doctor?: { id: string; name: string; auto: boolean } | null;
  candidates?: { id: string; name: string; phone: string }[];
  actions?: PlanAction[];
  applicable?: number;
  conflicts?: number;
};

export type PlanResponse =
  | {
      ok: true;
      plan: Plan;
      command: ReceptionCommand;
      patientId: string | null;
    }
  | { ok: false; error: string };

async function staffClinicId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: staff } = await supabase
    .from("staff")
    .select("clinic_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  return staff?.clinic_id ?? null;
}

/** Run reception_plan for an already-normalized command (no LLM call). */
async function runPlan(
  command: ReceptionCommand,
  patientId: string | null,
): Promise<PlanResponse> {
  const clinicId = await staffClinicId();
  if (!clinicId) return { ok: false, error: "Sessão inválida." };

  const svc = createServiceClient();
  const { data, error } = await svc.rpc("reception_plan", {
    p_clinic_id: clinicId,
    p_command: command as unknown as Json,
    p_patient_id: patientId ?? undefined,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, plan: data as Plan, command, patientId };
}

/**
 * Interpret free reception text (LLM parse) and return a preview plan.
 */
export async function planCommand(text: string): Promise<PlanResponse> {
  const { command, error } = await parseCommand(text);
  if (!command) return { ok: false, error: error ?? "Não percebi o comando." };
  if (command.op === "unknown") {
    return {
      ok: false,
      error:
        "Não percebi a ação. Tente algo como “remarcar a Ana para amanhã às 12:00”.",
    };
  }
  return runPlan(command, null);
}

/**
 * Re-plan an existing command without re-parsing — used to disambiguate a
 * patient (pass `patientId`) or to retry at a chosen alternative time (the UI
 * passes the command with `time` overridden).
 */
export async function planFromCommand(
  command: ReceptionCommand,
  patientId: string | null,
): Promise<PlanResponse> {
  return runPlan(command, patientId);
}

/**
 * Apply a previously-previewed command. Re-plans server-side (authoritative),
 * then executes via reception_apply. `notify` sends the patient an SMS.
 */
export async function applyCommand(
  command: ReceptionCommand,
  patientId: string | null,
  notify: boolean,
): Promise<
  | { ok: true; applied: number; notified: boolean; results: unknown }
  | { ok: false; error: string }
> {
  const clinicId = await staffClinicId();
  if (!clinicId) return { ok: false, error: "Sessão inválida." };

  const svc = createServiceClient();
  const { data: plan, error: planErr } = await svc.rpc("reception_plan", {
    p_clinic_id: clinicId,
    p_command: command as unknown as Json,
    p_patient_id: patientId ?? undefined,
  });
  if (planErr) return { ok: false, error: planErr.message };
  if (!plan || (plan as Plan).ok !== true) {
    return { ok: false, error: "O comando já não é aplicável." };
  }

  const { data, error } = await svc.rpc("reception_apply", {
    p_clinic_id: clinicId,
    p_plan: plan as unknown as Json,
    p_notify: notify,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/agenda");
  revalidatePath("/dashboard");

  const r = data as { applied: number; notified: boolean; results: unknown };
  return {
    ok: true,
    applied: r.applied,
    notified: r.notified,
    results: r.results,
  };
}
