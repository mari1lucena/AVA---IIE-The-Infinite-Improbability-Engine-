import Link from "next/link";
import { MessageSquare, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeading } from "@/components/page-heading";

const STATUS_LABEL: Record<
  string,
  { text: string; className: string; bar: string }
> = {
  active: {
    text: "Ativa",
    className: "bg-success-bg text-success-fg",
    bar: "var(--green-500)",
  },
  escalated: {
    text: "Escalada",
    className: "bg-warning-bg text-warning-fg",
    bar: "var(--amber-400)",
  },
  resolved: {
    text: "Resolvida",
    className: "bg-surface-sunken text-muted",
    bar: "var(--line-strong)",
  },
};

function timeAgo(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function ConversationsPage() {
  const supabase = await createClient();

  // RLS scopes to the caller's clinic.
  const { data } = await supabase
    .from("conversations")
    .select("id, status, conversation_type, message_count, last_message_at, patients(name, phone)")
    .order("last_message_at", { ascending: false, nullsFirst: false });

  const conversations = data ?? [];
  const total = conversations.length;
  const activeN = conversations.filter((c) => c.status === "active").length;
  const escalatedN = conversations.filter(
    (c) => c.status === "escalated",
  ).length;

  return (
    <div className="mx-auto max-w-[1080px] p-8">
      <PageHeading
        eyebrow="Receção"
        title="Conversas"
        icon={MessageSquare}
        accent="green"
        subtitle="Mensagens com pacientes — o assistente responde, a equipa intervém quando necessário."
        right={
          total > 0 ? (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success-bg px-3 py-1 text-xs font-semibold text-success-fg">
                <span className="tabular-nums">{activeN}</span> ativas
              </span>
              {escalatedN > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-bg px-3 py-1 text-xs font-semibold text-warning-fg">
                  <span className="tabular-nums">{escalatedN}</span> escaladas
                </span>
              )}
              <span className="text-sm text-muted">
                <span className="font-mono tabular-nums">{total}</span> no total
              </span>
            </div>
          ) : undefined
        }
      />

      {conversations.length === 0 ? (
        <div className="ii-rise flex flex-col items-center gap-2 rounded-[22px] border border-dashed border-line-strong bg-surface py-16 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-surface-sunken text-faint">
            <MessageSquare className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <p className="text-sm font-medium text-muted">Ainda não há conversas</p>
          <p className="text-xs text-faint">
            Assim que um paciente escrever, a conversa aparece aqui.
          </p>
        </div>
      ) : (
        <div
          className="ii-rise overflow-hidden rounded-[22px] border border-line bg-surface shadow-sm"
          style={{ ["--d" as string]: "0.06s" }}
        >
          <ul className="divide-y divide-line-subtle">
            {conversations.map((c, i) => {
              const patient = c.patients as { name: string; phone: string } | null;
              const badge = STATUS_LABEL[c.status] ?? {
                text: c.status,
                className: "bg-surface-sunken text-muted",
              };
              return (
                <li
                  key={c.id}
                  className="ii-rise"
                  style={{ ["--d" as string]: `${0.1 + Math.min(i, 16) * 0.03}s` }}
                >
                  <Link
                    href={`/conversations/${c.id}`}
                    className="group flex items-center justify-between gap-4 py-4 pl-4 pr-5 transition-colors hover:bg-surface-alt"
                  >
                    <span
                      className="h-9 w-1 flex-none rounded-full"
                      style={{ background: badge.bar }}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">
                        {patient?.name ?? "Paciente desconhecido"}
                      </p>
                      <p className="truncate text-xs text-muted">
                        <span className="tabular-nums">{patient?.phone}</span> ·{" "}
                        <span className="font-mono tabular-nums">
                          {c.message_count ?? 0}
                        </span>{" "}
                        mensagens
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-xs tabular-nums text-faint">
                        {timeAgo(c.last_message_at)}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge.className}`}
                      >
                        {badge.text}
                      </span>
                      <ChevronRight className="h-4 w-4 text-faint transition-transform group-hover:translate-x-0.5" />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
