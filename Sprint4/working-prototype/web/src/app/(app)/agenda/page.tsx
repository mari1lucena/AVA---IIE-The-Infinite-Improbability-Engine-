import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Upload,
  Plus,
  CalendarX2,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeading } from "@/components/page-heading";
import { MiniStat, STAT_ACCENT } from "@/components/mini-stat";

// Dev-only maintenance tools (e.g. "Repor demo") are hidden by default so the
// app is clean for screenshots/demos. Set NEXT_PUBLIC_SHOW_DEMO_TOOLS=1 to
// bring them back.
const SHOW_DEMO_TOOLS = process.env.NEXT_PUBLIC_SHOW_DEMO_TOOLS === "1";
import { RealtimeRefresher } from "./realtime-refresher";
import { MonthCalendar } from "./month-calendar";
import { cancelSlot, createSlot, importAgendaCsv, resetDemo } from "./actions";
import { GoogleCalendarAgendaStatus } from "./google-calendar-control";
import { isGoogleConfigured } from "@/lib/google/oauth";
import { CommandBox } from "../dashboard/command-box";

const TZ = "Europe/Lisbon";
const START_HOUR = 8;
const END_HOUR = 20;
const HOUR_PX = 96; // pixels per hour → a 30-min slot is 48px tall (DS grid)

// --- timezone helpers (server runs in Node; Intl handles the TZ math) -------
function tzParts(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
    hm: `${p.hour}:${p.minute}`,
  };
}

function shiftDate(dateStr: string, delta: number) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function humanDay(dateStr: string) {
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString("pt-PT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

// --- status → the II Design System slot styling -----------------------------
// The whole block is tinted by status (no left accent bar); open slots are
// hollow (no fill, a quiet continuous outline), a live cascade offer gets a
// slow pulse, a cancelled slot is struck through. Colors resolve from the
// --slot-* tokens (globals.css).
type SlotMeta = {
  label: string;
  key: string; // maps to --slot-<key>-*
  pulse?: boolean;
  strike?: boolean;
};
const SLOT: Record<string, SlotMeta> = {
  booked: { label: "Marcada", key: "booked" },
  confirmed: { label: "Confirmada", key: "confirmed" },
  pending_confirmation: { label: "Por confirmar", key: "pending" },
  offered: { label: "A oferecer", key: "offered", pulse: true },
  available: { label: "Vaga", key: "available" },
  completed: { label: "Concluída", key: "completed" },
  no_show: { label: "Faltou", key: "noshow" },
  cancelled: { label: "Cancelada", key: "cancelled", strike: true },
};
const LEGEND = [
  "confirmed",
  "booked",
  "pending_confirmation",
  "offered",
  "available",
] as const;
function slotFill(key: string): React.CSSProperties {
  return {
    background: `var(--slot-${key}-bg)`,
    borderColor: `var(--slot-${key}-border)`,
    color: `var(--slot-${key}-text)`,
  };
}
const CANCELLABLE = new Set([
  "booked",
  "confirmed",
  "pending_confirmation",
  "offered",
]);

const ACCENT = STAT_ACCENT;

type SlotRow = {
  id: string;
  start_time: string;
  end_time: string;
  status: string;
  doctor_id: string | null;
  doctor_name: string | null;
  cascade_level: number | null;
  refilled_from: string | null;
  notes: string | null;
  patient: { name: string } | null;
};

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{
    date?: string;
    month?: string;
    imported?: string;
    skipped?: string;
    import_error?: string;
    google?: string;
    reason?: string;
    doctor?: string;
    slot_error?: string;
  }>;
}) {
  const sp = await searchParams;
  const today = tzParts(new Date()).date;
  const date = sp?.date ?? today;
  const month = sp?.month ?? date.slice(0, 7);
  const doctorFilter = sp?.doctor ?? null; // null = show all doctors
  const doctorQ = doctorFilter ? `&doctor=${doctorFilter}` : ""; // keep filter across day nav

  const supabase = await createClient();
  // RLS scopes to the caller's clinic. Small dataset → fetch and filter by the
  // slot's Lisbon calendar date (robust across DST vs. hand-rolled UTC bounds).
  const { data } = await supabase
    .from("slots")
    .select(
      "id, start_time, end_time, status, doctor_id, doctor_name, cascade_level, refilled_from, notes, patient:patients!slots_patient_id_fkey(name)",
    )
    .order("start_time", { ascending: true });

  const slots = ((data ?? []) as unknown as SlotRow[]).filter(
    (s) =>
      tzParts(new Date(s.start_time)).date === date &&
      s.status !== "cancelled" &&
      (!doctorFilter || s.doctor_id === doctorFilter),
  );

  // Column packing so overlapping appointments (e.g. two doctors at the same
  // time) render side by side instead of stacking. Group transitively
  // overlapping slots into a cluster, greedily assign each a column, and give
  // every slot in the cluster a width of 1/columns.
  const layout = new Map<string, { col: number; cols: number }>();
  {
    let cluster: SlotRow[] = [];
    let clusterEnd = -Infinity;
    const flush = () => {
      const colEnds: number[] = []; // last end-minute per column
      const colOf = new Map<string, number>();
      for (const s of cluster) {
        const st = tzParts(new Date(s.start_time)).minutes;
        const en = tzParts(new Date(s.end_time)).minutes;
        let placed = colEnds.findIndex((e) => e <= st);
        if (placed === -1) {
          colEnds.push(en);
          placed = colEnds.length - 1;
        } else {
          colEnds[placed] = en;
        }
        colOf.set(s.id, placed);
      }
      for (const s of cluster)
        layout.set(s.id, { col: colOf.get(s.id) ?? 0, cols: colEnds.length });
      cluster = [];
      clusterEnd = -Infinity;
    };
    for (const s of slots) {
      const st = tzParts(new Date(s.start_time)).minutes;
      const en = tzParts(new Date(s.end_time)).minutes;
      if (cluster.length && st >= clusterEnd) flush();
      cluster.push(s);
      clusterEnd = Math.max(clusterEnd, en);
    }
    flush();
  }

  // Patients for the "new appointment" picker (RLS scopes to this clinic).
  const { data: patientsData } = await supabase
    .from("patients")
    .select("id, name")
    .eq("is_active", true)
    .order("name", { ascending: true });
  const patients = (patientsData ?? []) as { id: string; name: string }[];

  // Doctors for the per-doctor agenda filter (RLS scopes to this clinic).
  const { data: doctorsData } = await supabase
    .from("doctors")
    .select("id, name")
    .eq("is_active", true)
    .order("name", { ascending: true });
  const doctors = (doctorsData ?? []) as { id: string; name: string }[];

  // Google Calendar connection state (RLS scopes clinics to the caller's clinic).
  const gConfigured = isGoogleConfigured();
  const { data: clinicRow } = await supabase
    .from("clinics")
    .select(
      "google_connected_email, google_refresh_token, notify_patient_on_reception_change",
    )
    .limit(1)
    .maybeSingle();
  const gConnected = Boolean(clinicRow?.google_refresh_token);
  const notifyDefault =
    clinicRow?.notify_patient_on_reception_change ?? true;
  // Real-time push is per-doctor now — "watching" if any doctor has a channel.
  const { count: watchCount } = await supabase
    .from("doctors")
    .select("id", { count: "exact", head: true })
    .not("google_channel_id", "is", null);
  const gWatching = (watchCount ?? 0) > 0;

  const nowMin = date === today ? tzParts(new Date()).minutes : null;
  const nowLabel = nowMin !== null ? tzParts(new Date()).hm : "";
  const hours = Array.from(
    { length: END_HOUR - START_HOUR + 1 },
    (_, i) => START_HOUR + i,
  );
  const gridHeight = (END_HOUR - START_HOUR) * HOUR_PX;

  const topFor = (min: number) => ((min - START_HOUR * 60) / 60) * HOUR_PX;

  const dayLabel = humanDay(date);
  const openCount = slots.filter((s) => s.status === "available").length;
  const apptCount = slots.length - openCount;
  const confirmedCount = slots.filter((s) => s.status === "confirmed").length;
  const pendingCount = slots.filter(
    (s) => s.status === "pending_confirmation",
  ).length;

  const dayStats = [
    {
      label: "Marcações",
      value: apptCount,
      hint: "Marcadas e confirmadas",
      icon: CalendarCheck,
      accent: ACCENT.green,
      filled: true,
    },
    {
      label: "Confirmadas",
      value: confirmedCount,
      hint: "Prontas para hoje",
      icon: CheckCircle2,
      accent: ACCENT.mint,
    },
    {
      label: "Por confirmar",
      value: pendingCount,
      hint: "A aguardar resposta",
      icon: Clock,
      accent: ACCENT.amber,
    },
    {
      label: "Vagas",
      value: openCount,
      hint: "Livres neste dia",
      icon: CalendarClock,
      accent: ACCENT.teal,
    },
  ];

  return (
    <div className="flex h-full flex-col p-8">
      <RealtimeRefresher />

      <PageHeading
        eyebrow="Receção"
        title="Agenda"
        icon={CalendarDays}
        accent="green"
        subtitle={
          <>
            {doctors.length} médico{doctors.length === 1 ? "" : "s"} · fuso de
            Lisboa
          </>
        }
        right={
          <div className="flex flex-wrap items-center gap-2">
            <GoogleCalendarAgendaStatus
              configured={gConfigured}
              connected={gConnected}
              watching={gWatching}
            />

          <details className="group relative">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-[14px] border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:border-line-strong hover:bg-surface-alt">
              <Upload className="h-4 w-4" />
              Importar CSV
            </summary>
            <form
              action={importAgendaCsv}
              className="absolute right-0 top-full z-30 mt-2 w-96 space-y-3 rounded-[18px] border border-line bg-surface p-4 text-sm shadow-[var(--shadow-lg)]"
            >
              <div>
                <label className="mb-1 block font-medium text-muted">
                  Ficheiro .csv
                </label>
                <input
                  type="file"
                  name="csv"
                  accept=".csv,text/csv"
                  required
                  className="w-full text-ink file:mr-3 file:rounded-[8px] file:border-0 file:bg-brand-solid file:px-3 file:py-1.5 file:text-brand-on"
                />
              </div>
              <p className="text-[11px] leading-tight text-faint">
                Colunas esperadas (cabeçalho obrigatório):{" "}
                <code className="rounded bg-surface-sunken px-1 py-0.5">
                  data,hora,duracao,medico,paciente
                </code>
                . <code>data</code> em AAAA-MM-DD ou DD/MM/AAAA,{" "}
                <code>hora</code> em HH:MM. <code>duracao</code> (min),{" "}
                <code>medico</code> e <code>paciente</code> são opcionais —{" "}
                <code>paciente</code> em branco cria uma vaga aberta.
              </p>
              <button
                type="submit"
                className="w-full rounded-[12px] bg-brand-solid px-3 py-2 font-medium text-brand-on shadow-[var(--shadow-green)] hover:bg-brand-solid-hover"
              >
                Importar
              </button>
            </form>
          </details>

            {SHOW_DEMO_TOOLS && (
              <form action={resetDemo}>
                <button
                  type="submit"
                  className="rounded-[14px] border border-warning/40 bg-warning-bg px-3.5 py-2 text-sm font-medium text-warning-fg transition-opacity hover:opacity-90"
                  title="Repõe os dados de demonstração (Ana, Bruno, Carla) e limpa conversas"
                >
                  Repor demo
                </button>
              </form>
            )}
          </div>
        }
      />

      {(sp?.imported !== undefined || sp?.import_error) && (
        <div
          className={`mb-4 rounded-[14px] border px-4 py-2.5 text-sm ${
            sp?.import_error
              ? "border-danger/30 bg-danger-bg text-danger-fg"
              : "border-success/30 bg-success-bg text-success-fg"
          }`}
        >
          {sp?.import_error
            ? `Importação falhou: ${sp.import_error}`
            : `Importação concluída — ${sp?.imported ?? 0} marcações criadas` +
              (Number(sp?.skipped) > 0
                ? `, ${sp?.skipped} linhas ignoradas (data/hora inválida).`
                : ".")}
        </div>
      )}

      {sp?.slot_error && (
        <div className="mb-4 rounded-[14px] border border-danger/30 bg-danger-bg px-4 py-2.5 text-sm text-danger-fg">
          {sp.slot_error}
        </div>
      )}

      {sp?.google && (
        <div
          className={`mb-4 rounded-[14px] border px-4 py-2.5 text-sm ${
            sp.google === "error" || sp.google === "not_configured"
              ? "border-danger/30 bg-danger-bg text-danger-fg"
              : "border-success/30 bg-success-bg text-success-fg"
          }`}
        >
          {sp.google === "connected"
            ? "Google Calendar ligado — a agenda começou a sincronizar."
            : sp.google === "synced"
              ? "Sincronização com o Google Calendar concluída."
              : sp.google === "disconnected"
                ? "Google Calendar desligado desta clínica."
                : sp.google === "not_configured"
                  ? "Faltam as credenciais OAuth do Google (ver docs/GOOGLE_CALENDAR_SETUP.md)."
                  : `Erro na ligação ao Google Calendar${sp.reason ? `: ${sp.reason}` : "."}`}
        </div>
      )}

      {/* natural-language command box — edits the agenda with a confirm step */}
      <div className="ii-rise mb-4" style={{ ["--d" as string]: "0.02s" }}>
        <CommandBox defaultNotify={notifyDefault} />
      </div>

      {/* day summary — colored metric strip (mirrors the dashboard StatCards) */}
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {dayStats.map((s, i) => (
          <MiniStat key={s.label} {...s} delay={`${0.04 + i * 0.05}s`} />
        ))}
      </div>

      {/* mini calendar + doctor filter (left) · day timeline (right) */}
      <div className="flex min-h-0 flex-1 flex-col gap-6 lg:flex-row">
        <aside className="flex w-72 shrink-0 flex-col gap-4 lg:sticky lg:top-8 lg:self-start">
          <div className="ii-rise" style={{ ["--d" as string]: "0.04s" }}>
            <MonthCalendar month={month} selectedDate={date} />
          </div>

          {doctors.length > 0 && (
            <div
              className="ii-rise w-full max-w-[280px] rounded-[22px] border border-line bg-surface p-2 shadow-sm"
              style={{ ["--d" as string]: "0.1s" }}
            >
              <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
                Médicos
              </p>
              <Link
                href={`/agenda?date=${date}&month=${month}`}
                className={`flex items-center gap-2 rounded-[12px] px-2.5 py-1.5 text-sm transition-colors ${
                  !doctorFilter
                    ? "bg-brand-subtle font-medium text-ink"
                    : "text-muted hover:bg-surface-alt hover:text-ink"
                }`}
              >
                Todos os médicos
              </Link>
              {doctors.map((d) => {
                const active = doctorFilter === d.id;
                return (
                  <Link
                    key={d.id}
                    href={`/agenda?date=${date}&month=${month}&doctor=${d.id}`}
                    className={`flex items-center gap-2 rounded-[12px] px-2.5 py-1.5 text-sm transition-colors ${
                      active
                        ? "bg-brand-subtle font-medium text-ink"
                        : "text-muted hover:bg-surface-alt hover:text-ink"
                    }`}
                  >
                    {d.name}
                  </Link>
                );
              })}
            </div>
          )}
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* day nav + new appointment */}
          <div
            className="ii-rise mb-4 flex flex-wrap items-center justify-between gap-3"
            style={{ ["--d" as string]: "0.12s" }}
          >
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-0.5 rounded-[14px] border border-line bg-surface p-1 shadow-sm">
                <Link
                  href={`/agenda?date=${shiftDate(date, -1)}&month=${shiftDate(date, -1).slice(0, 7)}${doctorQ}`}
                  className="rounded-[10px] p-1.5 text-muted transition-colors hover:bg-surface-alt hover:text-ink"
                  aria-label="Dia anterior"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Link>
                <Link
                  href={`/agenda?date=${today}&month=${today.slice(0, 7)}${doctorQ}`}
                  className={`rounded-[10px] px-2.5 py-1 text-sm font-medium transition-colors ${
                    date === today
                      ? "bg-brand-subtle text-ink"
                      : "text-muted hover:bg-surface-alt hover:text-ink"
                  }`}
                >
                  Hoje
                </Link>
                <Link
                  href={`/agenda?date=${shiftDate(date, 1)}&month=${shiftDate(date, 1).slice(0, 7)}${doctorQ}`}
                  className="rounded-[10px] p-1.5 text-muted transition-colors hover:bg-surface-alt hover:text-ink"
                  aria-label="Dia seguinte"
                >
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
              <h2 className="px-1 text-lg font-semibold capitalize tracking-[-0.02em] text-ink">
                {dayLabel}
              </h2>
            </div>

            {/* new appointment — native disclosure, no client JS */}
            <details className="group relative">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-[14px] bg-brand-solid px-3.5 py-2 text-sm font-medium text-brand-on shadow-[var(--shadow-green)] transition-colors hover:bg-brand-solid-hover">
                <Plus className="h-4 w-4" />
                Nova marcação
              </summary>
              <form
                action={createSlot}
                className="absolute right-0 top-full z-30 mt-2 w-80 space-y-3 rounded-[18px] border border-line bg-surface p-4 text-sm shadow-[var(--shadow-lg)]"
              >
                <input type="hidden" name="date" value={date} />
                <div>
                  <label className="mb-1 block font-medium text-muted">
                    Paciente
                  </label>
                  <select
                    name="patient_id"
                    className="w-full rounded-[10px] border border-line bg-surface-alt px-2.5 py-2 text-ink focus:border-brand focus:outline-none"
                  >
                    <option value="">— Vaga (sem paciente) —</option>
                    {patients.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="mb-1 block font-medium text-muted">
                      Hora
                    </label>
                    <input
                      type="time"
                      name="time"
                      required
                      defaultValue="09:00"
                      step={300}
                      className="w-full rounded-[10px] border border-line bg-surface-alt px-2.5 py-2 text-ink focus:border-brand focus:outline-none"
                    />
                  </div>
                  <div className="w-28">
                    <label className="mb-1 block font-medium text-muted">
                      Duração
                    </label>
                    <select
                      name="duration"
                      defaultValue="30"
                      className="w-full rounded-[10px] border border-line bg-surface-alt px-2.5 py-2 text-ink focus:border-brand focus:outline-none"
                    >
                      <option value="30">30 min</option>
                      <option value="45">45 min</option>
                      <option value="60">60 min</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block font-medium text-muted">
                    Médico
                  </label>
                  <select
                    name="doctor_id"
                    defaultValue={doctorFilter ?? doctors[0]?.id ?? ""}
                    className="w-full rounded-[10px] border border-line bg-surface-alt px-2.5 py-2 text-ink focus:border-brand focus:outline-none"
                  >
                    {doctors.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="submit"
                  className="w-full rounded-[12px] bg-brand-solid px-3 py-2 font-medium text-brand-on shadow-[var(--shadow-green)] hover:bg-brand-solid-hover"
                >
                  Criar marcação
                </button>
                <p className="text-[11px] leading-tight text-faint">
                  Cria a marcação no dia visível ({dayLabel}). Hora em fuso de
                  Lisboa.
                </p>
              </form>
            </details>
          </div>

          {/* timeline card */}
          <div
            className="ii-rise flex min-h-0 flex-1 flex-col overflow-hidden rounded-[22px] border border-line bg-surface shadow-sm"
            style={{ ["--d" as string]: "0.16s" }}
          >
            {/* header strip: day summary + status legend */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-subtle px-5 py-4">
              <div className="flex items-baseline gap-3">
                <h3 className="text-lg font-semibold tracking-[-0.03em] text-ink">
                  Dia
                </h3>
                <span className="text-sm text-muted">
                  <span className="font-semibold tabular-nums text-ink">
                    {apptCount}
                  </span>{" "}
                  marcaç{apptCount === 1 ? "ão" : "ões"}
                  <span className="mx-1.5 text-line-strong">·</span>
                  <span className="font-semibold tabular-nums text-ink">
                    {openCount}
                  </span>{" "}
                  vaga{openCount === 1 ? "" : "s"}
                </span>
                <span className="hidden text-[11px] font-medium tabular-nums text-faint sm:inline">
                  {String(START_HOUR).padStart(2, "0")}:00 –{" "}
                  {String(END_HOUR).padStart(2, "0")}:00
                </span>
              </div>
              {/* Each pill is painted with its own slot fill, so the legend
                  doubles as the key to the block hierarchy on the grid. */}
              <div className="flex flex-wrap gap-1.5">
                {LEGEND.map((s) => {
                  const m = SLOT[s];
                  return (
                    <span
                      key={s}
                      className="inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium"
                      style={slotFill(m.key)}
                    >
                      {m.label}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* scrolling day grid */}
            <div className="min-h-0 flex-1 overflow-auto py-4 pr-5">
              <div
                className="relative flex"
                style={{ height: gridHeight, minWidth: 360 }}
              >
                {/* time gutter */}
                <div className="w-[58px] shrink-0">
                  {hours.map((h) => (
                    <div key={h} className="relative" style={{ height: HOUR_PX }}>
                      <span className="absolute -top-2 right-3 text-[11px] font-medium tabular-nums text-faint">
                        {String(h).padStart(2, "0")}:00
                      </span>
                    </div>
                  ))}
                </div>

                {/* events column */}
                <div className="relative flex-1">
                  {/* hour gridlines */}
                  {hours.map((h) => (
                    <div
                      key={h}
                      className="absolute inset-x-0 border-t border-line-subtle"
                      style={{ top: topFor(h * 60) }}
                    />
                  ))}

                  {/* now indicator */}
                  {nowMin !== null &&
                    nowMin >= START_HOUR * 60 &&
                    nowMin <= END_HOUR * 60 && (
                      <div
                        className="absolute inset-x-0 z-20 flex items-center"
                        style={{ top: topFor(nowMin) }}
                      >
                        <span
                          className="ii-now-dot -ml-1 h-[9px] w-[9px] rounded-full"
                          style={{ background: "var(--now-line)" }}
                        />
                        <span
                          className="h-[1.5px] flex-1"
                          style={{ background: "var(--now-line)" }}
                        />
                        <span
                          className="ml-2 text-[10px] font-semibold tabular-nums"
                          style={{ color: "var(--now-line)" }}
                        >
                          {nowLabel}
                        </span>
                      </div>
                    )}

                  {/* slots */}
                  {slots.map((s, i) => {
                    const start = tzParts(new Date(s.start_time));
                    const end = tzParts(new Date(s.end_time));
                    const top = topFor(start.minutes);
                    const height = Math.max(
                      ((end.minutes - start.minutes) / 60) * HOUR_PX - 5,
                      40,
                    );
                    const st = SLOT[s.status] ?? SLOT.booked;
                    // A slot ingested from Google (no patient row) carries its
                    // event title in `notes` — show that instead of a bare "Vaga".
                    const name = s.patient?.name ?? s.notes ?? "Vaga";
                    const pos = layout.get(s.id) ?? { col: 0, cols: 1 };
                    const widthPct = 100 / pos.cols;
                    const meta =
                      st.label +
                      (s.doctor_name ? ` · ${s.doctor_name}` : "") +
                      (s.cascade_level && s.cascade_level > 0
                        ? ` · nível ${s.cascade_level}`
                        : "");
                    // An open vaga is a GAP, not an appointment: hollow, no
                    // shadow, quiet type, and it never sits above a real
                    // booking. Everything else is a solid, elevated object.
                    const isOpen = s.status === "available";
                    return (
                      <div
                        key={s.id}
                        className={`ii-slot absolute overflow-hidden rounded-[16px] border ${
                          st.pulse ? "ii-pulse" : "ii-slot-in"
                        } ${isOpen ? "z-[5]" : "z-10 shadow-sm"}`}
                        style={{
                          top,
                          height,
                          left: `calc(${widthPct * pos.col}% + 8px)`,
                          width: `calc(${widthPct}% - 14px)`,
                          minHeight: 40,
                          padding: isOpen ? "6px 12px" : "8px 12px",
                          textDecoration: st.strike ? "line-through" : "none",
                          ["--d" as string]: `${Math.min(i, 14) * 0.03}s`,
                          ...slotFill(st.key),
                        }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="m-0 flex items-baseline gap-2 truncate">
                              <span
                                className={`flex-none text-[11px] leading-none tabular-nums ${
                                  isOpen ? "font-normal opacity-80" : "font-medium"
                                }`}
                              >
                                {start.hm}
                              </span>
                              <span
                                className={
                                  isOpen
                                    ? "truncate text-[12px] font-medium leading-tight"
                                    : "truncate text-[13.5px] font-semibold leading-tight tracking-[-0.01em]"
                                }
                              >
                                {name}
                              </span>
                            </p>
                            {/* An empty slot doesn't need a status line — it
                                only says which doctor is free. */}
                            <p
                              className={`mt-[3px] truncate text-[11px] ${
                                isOpen ? "opacity-70" : "opacity-85"
                              }`}
                            >
                              {isOpen ? (s.doctor_name ?? "Livre") : meta}
                            </p>
                            {s.refilled_from && (
                              <p className="m-0 truncate text-[11px] opacity-70">
                                ↳ de: {s.refilled_from}
                              </p>
                            )}
                          </div>
                          {CANCELLABLE.has(s.status) && (
                            <form action={cancelSlot}>
                              <input type="hidden" name="id" value={s.id} />
                              <button
                                type="submit"
                                className="flex-none rounded-[9px] border border-black/10 bg-white/80 px-2 py-[3px] text-[10px] font-medium text-rose-700 hover:bg-white"
                              >
                                Cancelar
                              </button>
                            </form>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {slots.length === 0 && (
                    <div className="ii-rise absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
                      <span className="grid h-12 w-12 place-items-center rounded-full bg-surface-sunken text-faint">
                        <CalendarX2 className="h-5 w-5" strokeWidth={1.75} />
                      </span>
                      <p className="text-sm font-medium text-muted">
                        Sem marcações neste dia
                      </p>
                      <p className="max-w-[220px] text-xs text-faint">
                        Escolha outro dia no calendário ou crie uma nova marcação.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
