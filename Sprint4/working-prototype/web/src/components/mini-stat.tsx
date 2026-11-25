import type { ComponentType } from "react";

// The II metric accents — one fixed accent per counter, shared with the
// dashboard StatCards so every screen speaks the same colour language.
export const STAT_ACCENT = {
  green: "#2f7d62",
  mint: "#3d9647",
  amber: "#c98a25",
  teal: "#3c9ca8",
  rose: "#c4574f",
} as const;

export type StatAccent = (typeof STAT_ACCENT)[keyof typeof STAT_ACCENT];

/**
 * A compact metric card — soft accent icon tile, mono numeral, one optional
 * filled hero. The lighter-weight sibling of the dashboard StatCard, sized for
 * the header strips on Agenda / Patients / etc.
 */
export function MiniStat({
  label,
  value,
  hint,
  icon: Icon,
  accent,
  filled = false,
  delay,
}: {
  label: string;
  value: number;
  hint: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  accent: StatAccent;
  filled?: boolean;
  delay?: string;
}) {
  const tile = filled
    ? "rgb(255 255 255 / 0.18)"
    : `color-mix(in srgb, ${accent} 14%, transparent)`;
  return (
    <div
      className={
        (filled
          ? "rounded-[18px] p-4 shadow-md"
          : "rounded-[18px] border border-line bg-surface p-4 shadow-sm") +
        " ii-rise h-full transition-transform duration-200 hover:-translate-y-0.5"
      }
      style={{
        ...(filled ? { background: accent } : {}),
        ...(delay ? { ["--d" as string]: delay } : {}),
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <p
          className="text-[11px] font-medium"
          style={{ color: filled ? "rgb(255 255 255 / 0.82)" : "var(--muted)" }}
        >
          {label}
        </p>
        <span
          className="grid h-[28px] w-[28px] place-items-center rounded-[11px]"
          style={{ background: tile, color: filled ? "#fff" : accent }}
        >
          <Icon className="h-[15px] w-[15px]" strokeWidth={2} />
        </span>
      </div>
      <p
        className="mt-3 font-mono text-[26px] font-medium leading-none tracking-[-0.03em] tabular-nums"
        style={{ color: filled ? "#fff" : "var(--ink)" }}
      >
        {value}
      </p>
      <p
        className="mt-1 text-[11px]"
        style={{ color: filled ? "rgb(255 255 255 / 0.75)" : "var(--faint)" }}
      >
        {hint}
      </p>
    </div>
  );
}
