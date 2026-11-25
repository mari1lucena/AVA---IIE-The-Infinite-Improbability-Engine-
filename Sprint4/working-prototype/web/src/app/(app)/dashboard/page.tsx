import type { ComponentType } from "react";
import Link from "next/link";
import {
  CalendarCheck,
  CalendarClock,
  AlertCircle,
  ListChecks,
  ArrowRight,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { DashboardHero } from "./dashboard-hero";
import { CountUp } from "./count-up";
import { CommandBox } from "./command-box";

// Local day boundaries as ISO timestamps for "today" filtering.
function todayRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

// Local month boundaries as ISO timestamps, for the "recovered" metric.
function monthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

// II Design System metric accents — one fixed accent per counter.
// (semantic.css: appointments/green, open slots/mint, escalations/amber,
// waiting list/teal). Saturated values that read on both themes.
const ACCENT = {
  green: "#2f7d62", // --metric-appointments / --green-600
  mint: "#3d9647", // --metric-open-slots  / --mint-600
  amber: "#c98a25", // --metric-escalations / --amber-500
  teal: "#3c9ca8", // --metric-waiting-list / --teal-500
} as const;

type Accent = (typeof ACCENT)[keyof typeof ACCENT];

// The II StatCard: mono numerals, soft accent icon tile, one filled hero.
function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  accent,
  filled = false,
}: {
  label: string;
  value: number;
  hint: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  accent: Accent;
  filled?: boolean;
}) {
  const tile = filled
    ? "rgb(255 255 255 / 0.18)"
    : `color-mix(in srgb, ${accent} 14%, transparent)`;
  return (
    <div
      className={
        (filled
          ? "rounded-[22px] p-5 shadow-md"
          : "rounded-[22px] border border-line bg-surface p-5 shadow-sm") +
        " h-full transition-transform duration-200 hover:-translate-y-1"
      }
      style={filled ? { background: accent } : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <p
          className="text-xs font-medium"
          style={{ color: filled ? "rgb(255 255 255 / 0.82)" : "var(--muted)" }}
        >
          {label}
        </p>
        <span
          className="grid h-[34px] w-[34px] place-items-center rounded-[14px]"
          style={{ background: tile, color: filled ? "#fff" : accent }}
        >
          <Icon className="h-[17px] w-[17px]" strokeWidth={2} />
        </span>
      </div>
      <p
        className="mt-4 font-mono text-[32px] font-medium leading-none tracking-[-0.03em] tabular-nums"
        style={{ color: filled ? "#fff" : "var(--ink)" }}
      >
        <CountUp value={value} />
      </p>
      <p
        className="mt-1.5 text-xs"
        style={{ color: filled ? "rgb(255 255 255 / 0.75)" : "var(--faint)" }}
      >
        {hint}
      </p>
    </div>
  );
}

// A translucent stat tile inside the green focal card.
function GlassStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex-1 rounded-[14px] bg-white/15 p-3">
      <div className="font-mono text-[22px] font-medium leading-none tracking-[-0.03em] tabular-nums">
        <CountUp value={value} />
      </div>
      <div className="mt-1.5 text-[11px] leading-snug text-white/85">{label}</div>
    </div>
  );
}

// A task row with an II slot-status dot.
function TaskRow({
  dot,
  label,
  value,
  href,
  delay,
}: {
  dot: string;
  label: string;
  value: string;
  href?: string;
  delay?: string;
}) {
  const inner = (
    <div
      className="ii-rise flex items-center gap-3 border-b border-line-subtle py-3 last:border-b-0"
      style={delay ? { ["--d" as string]: delay } : undefined}
    >
      <span
        className="h-2 w-2 flex-none rounded-full"
        style={{ background: dot }}
      />
      <span className="min-w-0 flex-1 truncate text-sm text-muted group-hover:text-ink">
        {label}
      </span>
      <span className="whitespace-nowrap font-mono text-xs font-medium tabular-nums text-faint">
        {value}
      </span>
    </div>
  );
  return href ? (
    <Link href={href} className="group block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const { start, end } = todayRange();
  const { start: monthStart, end: monthEnd } = monthRange();

  // RLS scopes every query below to the caller's own clinic.
  const [
    clinic,
    booked,
    open,
    escalations,
    waiting,
    recovered,
    agentMsgs,
    patientMsgs,
    activeConvos,
  ] = await Promise.all([
    supabase
      .from("clinics")
      .select("name, notify_patient_on_reception_change")
      .limit(1)
      .maybeSingle(),
    supabase
      .from("slots")
      .select("*", { count: "exact", head: true })
      .gte("start_time", start)
      .lt("start_time", end)
      .in("status", ["booked", "pending_confirmation", "completed"]),
    supabase
      .from("slots")
      .select("*", { count: "exact", head: true })
      .gte("start_time", start)
      .lt("start_time", end)
      .eq("status", "available"),
    supabase
      .from("escalation_queue")
      .select("*", { count: "exact", head: true })
      .in("status", ["pending", "in_progress"]),
    supabase
      .from("waiting_list")
      .select("*", { count: "exact", head: true })
      .eq("status", "active"),
    // "Recovered": a patient who tried to cancel, got nudged to reschedule
    // instead, and ended up still booked (had_cancel_nudge=true, i.e. the
    // agent asked; resolution_outcome='rebooked', i.e. it actually landed a
    // new slot rather than going through with the cancellation).
    supabase
      .from("conversations")
      .select("*", { count: "exact", head: true })
      .eq("had_cancel_nudge", true)
      .eq("resolution_outcome", "rebooked")
      .gte("resolved_at", monthStart)
      .lt("resolved_at", monthEnd),
    // Assistant activity today.
    supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("sender_type", "agent")
      .gte("sent_at", start)
      .lt("sent_at", end),
    supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("sender_type", "patient")
      .gte("sent_at", start)
      .lt("sent_at", end),
    supabase
      .from("conversations")
      .select("*", { count: "exact", head: true })
      .eq("status", "active"),
  ]);

  const bookedN = booked.count ?? 0;
  const openN = open.count ?? 0;
  const escalationsN = escalations.count ?? 0;
  const waitingN = waiting.count ?? 0;
  const recoveredN = recovered.count ?? 0;
  const agentMsgsN = agentMsgs.count ?? 0;
  const patientMsgsN = patientMsgs.count ?? 0;
  const activeConvosN = activeConvos.count ?? 0;
  const clinicName = clinic.data?.name ?? "Clínica";
  const notifyDefault =
    clinic.data?.notify_patient_on_reception_change ?? true;

  const cards = [
    {
      label: "Consultas hoje",
      value: bookedN,
      hint: "Marcadas e confirmadas",
      icon: CalendarCheck,
      accent: ACCENT.green,
      filled: true,
    },
    {
      label: "Vagas por preencher",
      value: openN,
      hint: "Cascata a correr",
      icon: CalendarClock,
      accent: ACCENT.mint,
    },
    {
      label: "Escalações pendentes",
      value: escalationsN,
      hint: "A aguardar equipa",
      icon: AlertCircle,
      accent: ACCENT.amber,
    },
    {
      label: "Lista de espera",
      value: waitingN,
      hint: "Pacientes ativos",
      icon: ListChecks,
      accent: ACCENT.teal,
    },
  ];

  return (
    <div className="mx-auto max-w-[1080px] p-8">
      {/* Hero — the clinic's identity, 3D mark + live proposition */}
      <DashboardHero clinicName={clinicName} />

      {/* Command box — natural-language agenda changes with a confirm step */}
      <div
        className="ii-rise mb-4"
        style={{ ["--d" as string]: "0.45s" }}
      >
        <CommandBox defaultNotify={notifyDefault} />
      </div>

      {/* Metric row — one fixed accent per counter, mono numerals */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c, i) => (
          <div
            key={c.label}
            className="ii-rise"
            style={{ ["--d" as string]: `${0.5 + i * 0.07}s` }}
          >
            <StatCard {...c} />
          </div>
        ))}
      </div>

      {/* Row 2 — green focal card + tasks card */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Focal: the signature "recovered" metric — the number that didn't
            exist before, with today's live assistant activity around it. */}
        <div
          className="ii-rise rounded-[22px] p-5 text-white shadow-md transition-transform duration-200 hover:-translate-y-1"
          style={{ background: ACCENT.green, ["--d" as string]: "0.8s" }}
        >
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
            </span>
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-white/85">
              Recuperação ativa
            </span>
            <span className="ml-auto font-mono text-[11px] text-white/70">
              cascata a correr
            </span>
          </div>

          <p className="mt-5 font-mono text-[44px] font-medium leading-none tracking-[-0.03em] tabular-nums">
            <CountUp value={recoveredN} />
          </p>
          <p className="mt-1.5 text-sm text-white/90">
            Consultas recuperadas este mês
          </p>

          <div className="mt-5 flex gap-3">
            <GlassStat value={agentMsgsN} label="Mensagens do assistente hoje" />
            <GlassStat value={activeConvosN} label="Conversas ativas" />
            <GlassStat value={escalationsN} label="Escalações" />
          </div>

          <p className="mt-4 text-sm leading-relaxed text-white/90">
            Pacientes que iam cancelar e remarcaram — receita que, até agora,
            ninguém via.
          </p>
        </div>

        {/* Tasks: everything that needs a person, with II status dots */}
        <div
          className="ii-rise rounded-[22px] border border-line bg-surface p-5 shadow-sm transition-transform duration-200 hover:-translate-y-1"
          style={{ ["--d" as string]: "0.88s" }}
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-lg font-semibold tracking-[-0.03em] text-ink">
              A precisar de atenção
            </h3>
            <Link
              href="/conversations"
              className="inline-flex items-center gap-1 rounded-[14px] px-2 py-1 text-sm text-muted transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              Conversas
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="mt-2 flex flex-col">
            <TaskRow
              dot="#e0a53c"
              label="Escalações pendentes"
              value={String(escalationsN)}
              href="/escalations"
              delay="0.98s"
            />
            <TaskRow
              dot="#4fb356"
              label="Vagas por preencher hoje"
              value={String(openN)}
              href="/agenda"
              delay="1.04s"
            />
            <TaskRow
              dot="#4faab8"
              label="Lista de espera"
              value={String(waitingN)}
              delay="1.10s"
            />
            <TaskRow
              dot="#57a88a"
              label="Mensagens de pacientes hoje"
              value={String(patientMsgsN)}
              href="/conversations"
              delay="1.16s"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
