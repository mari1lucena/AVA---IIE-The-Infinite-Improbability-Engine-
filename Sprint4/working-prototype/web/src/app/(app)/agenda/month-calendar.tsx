import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

const WEEKDAY_LABELS: { short: string; full: string }[] = [
  { short: "S", full: "Segunda" },
  { short: "T", full: "Terça" },
  { short: "Q", full: "Quarta" },
  { short: "Q", full: "Quinta" },
  { short: "S", full: "Sexta" },
  { short: "S", full: "Sábado" },
  { short: "D", full: "Domingo" },
];

/** true for the Sat/Sun columns (indices 5 and 6 in a Monday-first week). */
function isWeekendCol(col: number) {
  return col === 5 || col === 6;
}

function monthLabel(month: string) {
  return new Date(`${month}-01T12:00:00Z`).toLocaleDateString("pt-PT", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Monday-first weekday index (0=Segunda … 6=Domingo) for a UTC-noon date. */
function mondayIndex(d: Date) {
  return (d.getUTCDay() + 6) % 7;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

type Cell = { iso: string; day: number; inMonth: boolean; col: number };

function buildGrid(month: string): Cell[] {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1, 12));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const leading = mondayIndex(first);
  const totalCells = Math.ceil((leading + daysInMonth) / 7) * 7;

  const cells: Cell[] = [];
  for (let i = 0; i < totalCells; i++) {
    const dayOffset = i - leading + 1;
    const d = new Date(Date.UTC(y, m - 1, dayOffset, 12));
    cells.push({
      iso: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
      day: d.getUTCDate(),
      inMonth: dayOffset >= 1 && dayOffset <= daysInMonth,
      col: i % 7,
    });
  }
  return cells;
}

export function MonthCalendar({
  month,
  selectedDate,
}: {
  month: string;
  selectedDate: string;
}) {
  const cells = buildGrid(month);

  return (
    <div className="w-full max-w-[280px] rounded-[22px] border border-line bg-surface p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold capitalize text-ink">
          {monthLabel(month)}
        </h2>
        <div className="flex items-center gap-0.5">
          <Link
            href={`/agenda?date=${selectedDate}&month=${shiftMonth(month, -1)}`}
            className="rounded-[8px] p-1 text-faint hover:bg-surface-alt hover:text-muted"
            aria-label="Mês anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <Link
            href={`/agenda?date=${selectedDate}&month=${shiftMonth(month, 1)}`}
            className="rounded-[8px] p-1 text-faint hover:bg-surface-alt hover:text-muted"
            aria-label="Mês seguinte"
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-x-1 gap-y-1 text-center">
        {WEEKDAY_LABELS.map((w, i) => (
          <div
            key={`${w.full}-${i}`}
            title={w.full}
            className={`text-xs font-medium ${
              isWeekendCol(i) ? "text-warning" : "text-faint"
            }`}
          >
            {w.short}
          </div>
        ))}

        {cells.map((c) => {
          const isSelected = c.iso === selectedDate;
          const weekend = isWeekendCol(c.col);

          let cls =
            "mx-auto flex h-7 w-7 items-center justify-center rounded-full text-sm tabular-nums transition-colors";
          if (isSelected) {
            cls +=
              " bg-brand-subtle font-semibold text-brand ring-1 ring-inset ring-brand/40";
          } else if (!c.inMonth) {
            cls += " text-disabled hover:bg-surface-alt";
          } else if (weekend) {
            cls += " text-warning hover:bg-surface-alt";
          } else {
            cls += " text-muted hover:bg-surface-alt";
          }

          return (
            <Link
              key={c.iso}
              href={`/agenda?date=${c.iso}&month=${c.iso.slice(0, 7)}`}
              className="py-0.5"
            >
              <span className={cls}>{c.day}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
