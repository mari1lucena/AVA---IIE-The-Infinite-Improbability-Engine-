import Link from "next/link";
import { MessageSquare, Check, RotateCcw, AlertCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { resolveEscalation, reopenEscalation } from "./actions";
import { PageHeading } from "@/components/page-heading";

type EscalationRow = {
  id: string;
  category: string;
  description: string;
  priority: string;
  status: string;
  created_at: string | null;
  conversation_id: string | null;
  patient: { name: string } | null;
};

const CATEGORY: Record<string, { label: string; cls: string; bar: string }> = {
  booking_request: {
    label: "Marcação",
    cls: "bg-success-bg text-success-fg",
    bar: "var(--green-500)",
  },
  insurance_issue: {
    label: "Seguro",
    cls: "bg-warning-bg text-warning-fg",
    bar: "var(--amber-400)",
  },
  complaint: {
    label: "Reclamação",
    cls: "bg-danger-bg text-danger-fg",
    bar: "var(--rose-500)",
  },
  conversation_takeover: {
    label: "Atendimento",
    cls: "bg-teal-bg text-teal-fg",
    bar: "var(--teal-500)",
  },
};

function when(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function EscalationsPage() {
  const supabase = await createClient();
  // RLS scopes to the caller's clinic. Pending first, then most recent.
  const { data } = await supabase
    .from("escalation_queue")
    .select(
      "id, category, description, priority, status, created_at, conversation_id, patient:patients!escalation_queue_patient_id_fkey(name)",
    )
    .order("status", { ascending: true }) // 'pending' before 'resolved'
    .order("created_at", { ascending: false });

  const rows = (data ?? []) as unknown as EscalationRow[];
  const pending = rows.filter((r) => r.status === "pending");

  return (
    <div className="flex h-full flex-col p-8">
      <PageHeading
        eyebrow="Receção"
        title="Ajuda humana"
        icon={AlertCircle}
        accent="amber"
        right={
          <span className="text-sm text-muted">
            <span className="font-mono tabular-nums">{pending.length}</span> por
            resolver
          </span>
        }
      />

      <div className="min-h-0 flex-1 space-y-2 overflow-auto">
        {rows.length === 0 && (
          <p className="rounded-[22px] border border-line bg-surface px-4 py-10 text-center text-sm text-faint shadow-sm">
            Sem escalações. Tudo tratado pelo assistente.
          </p>
        )}

        {rows.map((r) => {
          const cat = CATEGORY[r.category] ?? {
            label: r.category,
            cls: "bg-surface-sunken text-muted",
          };
          const resolved = r.status === "resolved";
          return (
            <div
              key={r.id}
              className={`flex items-stretch gap-4 rounded-[22px] border border-line bg-surface p-4 shadow-sm ${
                resolved ? "opacity-60" : ""
              }`}
            >
              <span
                className="w-1 flex-none self-stretch rounded-full"
                style={{ background: cat.bar }}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">
                    {r.patient?.name ?? "Paciente"}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cat.cls}`}
                  >
                    {cat.label}
                  </span>
                  {r.priority === "high" && (
                    <span className="rounded-full bg-danger-bg px-2 py-0.5 text-[11px] font-semibold text-danger-fg">
                      Prioridade alta
                    </span>
                  )}
                  {resolved && (
                    <span className="rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-semibold text-success-fg">
                      Resolvida
                    </span>
                  )}
                  <span className="ml-auto text-xs tabular-nums text-faint">
                    {when(r.created_at)}
                  </span>
                </div>
                <p className="text-sm text-muted">{r.description}</p>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-2">
                {r.conversation_id && (
                  <Link
                    href={`/conversations/${r.conversation_id}`}
                    className="flex items-center gap-1.5 rounded-[12px] border border-line bg-surface px-2.5 py-1 text-xs font-medium text-muted hover:bg-surface-alt"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    Ver conversa
                  </Link>
                )}
                {resolved ? (
                  <form action={reopenEscalation}>
                    <input type="hidden" name="id" value={r.id} />
                    <button
                      type="submit"
                      className="flex items-center gap-1.5 rounded-[12px] border border-line bg-surface px-2.5 py-1 text-xs font-medium text-muted hover:bg-surface-alt"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Reabrir
                    </button>
                  </form>
                ) : (
                  <form action={resolveEscalation}>
                    <input type="hidden" name="id" value={r.id} />
                    <button
                      type="submit"
                      className="flex items-center gap-1.5 rounded-[12px] bg-brand-solid px-2.5 py-1 text-xs font-medium text-brand-on hover:bg-brand-solid-hover"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Resolver
                    </button>
                  </form>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
