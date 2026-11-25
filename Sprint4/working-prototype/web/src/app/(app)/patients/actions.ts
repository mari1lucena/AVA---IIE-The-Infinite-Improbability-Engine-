"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Update a patient's name and flags. Runs as the signed-in staff member, so RLS
 * (`clinic_id = auth_clinic_id()`) keeps it scoped to their clinic. Checkboxes
 * submit "on" when ticked and nothing when unticked.
 */
export async function updatePatient(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const name = String(formData.get("name") ?? "").trim();
  const primary_doctor_id = String(formData.get("primary_doctor_id") ?? "").trim();
  const is_active = formData.get("is_active") === "on";
  const accepts_short_notice = formData.get("accepts_short_notice") === "on";
  const opted_out = formData.get("opted_out") === "on";

  const supabase = await createClient();
  await supabase
    .from("patients")
    .update({
      ...(name ? { name } : {}),
      primary_doctor_id: primary_doctor_id || null,
      is_active,
      accepts_short_notice,
      opted_out,
      opted_out_at: opted_out ? new Date().toISOString() : null,
    })
    .eq("id", id);

  revalidatePath("/patients");
}

/** Create a patient in the signed-in staff member's clinic. */
export async function addPatient(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  if (!name || !phone) return;

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

  await supabase.from("patients").insert({
    clinic_id: staff.clinic_id,
    name,
    phone,
    is_active: true,
    accepts_short_notice: true,
  });

  revalidatePath("/patients");
}
