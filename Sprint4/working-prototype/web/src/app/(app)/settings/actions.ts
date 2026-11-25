"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Update the clinic's agent presentation/behaviour settings. Runs as the
 * signed-in staff member; RLS (`clinic_isolation`: id = auth_clinic_id()) keeps
 * the write scoped to their own clinic. The n8n agent reads these back through
 * `agent_context` and folds them into its system prompt.
 */
export async function updateAgentSettings(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: staff } = await supabase
    .from("staff")
    .select("clinic_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!staff) return;

  const agent_name = String(formData.get("agent_name") ?? "").trim();
  const tone = String(formData.get("agent_tone") ?? "formal");
  const language = String(formData.get("agent_language") ?? "pt");
  const agent_signature = String(formData.get("agent_signature") ?? "").trim();
  const agent_use_emoji = formData.get("agent_use_emoji") === "on";
  const agent_custom_instructions = String(
    formData.get("agent_custom_instructions") ?? "",
  ).trim();

  await supabase
    .from("clinics")
    .update({
      agent_name: agent_name || null,
      agent_tone: tone === "informal" ? "informal" : "formal",
      agent_language: language === "mirror" ? "mirror" : "pt",
      agent_signature: agent_signature || null,
      agent_use_emoji,
      agent_custom_instructions: agent_custom_instructions || null,
    })
    .eq("id", staff.clinic_id);

  revalidatePath("/settings");
}

/**
 * Toggle whether reception-initiated changes (via the dashboard command box)
 * notify the patient by SMS. Scoped to the staff member's own clinic by RLS.
 */
export async function updateReceptionNotify(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: staff } = await supabase
    .from("staff")
    .select("clinic_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!staff) return;

  await supabase
    .from("clinics")
    .update({
      notify_patient_on_reception_change:
        formData.get("notify_patient_on_reception_change") === "on",
    })
    .eq("id", staff.clinic_id);

  revalidatePath("/settings");
  revalidatePath("/dashboard");
}

/** Reset the clinic's agent settings back to their defaults. */
export async function resetAgentSettings() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: staff } = await supabase
    .from("staff")
    .select("clinic_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!staff) return;

  await supabase
    .from("clinics")
    .update({
      agent_name: null,
      agent_tone: "formal",
      agent_language: "pt",
      agent_signature: null,
      agent_use_emoji: false,
      agent_custom_instructions: null,
    })
    .eq("id", staff.clinic_id);

  revalidatePath("/settings");
}
