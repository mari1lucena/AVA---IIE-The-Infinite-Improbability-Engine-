import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { StaffThread } from "@/components/staff-thread";

export default async function ConversationPage({
  params,
}: PageProps<"/conversations/[id]">) {
  const { id } = await params;
  const supabase = await createClient();

  // RLS scopes to the caller's clinic — a foreign id simply returns null.
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, status, patients(name, phone)")
    .eq("id", id)
    .maybeSingle();

  if (!conversation) notFound();

  const patient = conversation.patients as { name: string; phone: string } | null;

  const { data: messages } = await supabase
    .from("messages")
    .select("id, sender_type, body, sent_at")
    .eq("conversation_id", id)
    .order("sent_at", { ascending: true });

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line bg-surface px-6">
        <Link
          href="/conversations"
          className="text-faint transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">
            {patient?.name ?? "Paciente"}
          </p>
          <p className="truncate text-xs tabular-nums text-muted">
            {patient?.phone}
          </p>
        </div>
      </header>

      <StaffThread conversationId={id} initialMessages={messages ?? []} />
    </div>
  );
}
