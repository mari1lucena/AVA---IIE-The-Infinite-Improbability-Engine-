"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Reply to a patient as a human staff member. RLS ensures the caller can
 * only write to conversations in their own clinic. The insert is
 * sender_type='staff' (a person, not the AI agent) on the 'mock' channel.
 */
export async function replyAsStaff(conversationId: string, body: string) {
  const text = body.trim();
  if (!text) return { error: "empty" as const };

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "unauthorized" as const };

  // Resolve the staff row so we can stamp sender_id (RLS-scoped).
  const { data: staff } = await supabase
    .from("staff")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  const { error: insertError } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_type: "staff",
    sender_id: staff?.id ?? null,
    body: text,
    channel: "mock",
  });
  if (insertError) return { error: "insert_failed" as const };

  // Bump conversation counters so the list + thread stay fresh.
  const { data: convo } = await supabase
    .from("conversations")
    .select("message_count")
    .eq("id", conversationId)
    .maybeSingle();

  await supabase
    .from("conversations")
    .update({
      message_count: (convo?.message_count ?? 0) + 1,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId);

  revalidatePath(`/conversations/${conversationId}`);
  revalidatePath("/conversations");
  return { error: null };
}
