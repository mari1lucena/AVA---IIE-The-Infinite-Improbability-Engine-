"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** Mark an escalation resolved. RLS scopes to the caller's clinic. */
export async function resolveEscalation(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase
    .from("escalation_queue")
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath("/escalations");
}

/** Reopen a resolved escalation. */
export async function reopenEscalation(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase
    .from("escalation_queue")
    .update({ status: "pending", resolved_at: null })
    .eq("id", id);
  revalidatePath("/escalations");
}
