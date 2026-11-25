import type { ComponentType, ReactNode } from "react";

// The II page-header accents — one per section, drawn from the dashboard
// metric palette so every screen shares the same colour language. Saturated
// values that read on both light and dark themes.
const ACCENTS = {
  green: "#2f7d62",
  mint: "#3d9647",
  amber: "#c98a25",
  teal: "#3c9ca8",
  rose: "#c4574f",
} as const;

export type HeadingAccent = keyof typeof ACCENTS;

/**
 * The shared inner-page header: a soft accent icon tile beside the eyebrow +
 * title, with an optional right-hand slot for toolbars or stat pills. Each
 * section passes its own accent so the app reads as one coloured system
 * instead of a wall of monochrome titles.
 */
export function PageHeading({
  eyebrow = "Receção",
  title,
  subtitle,
  icon: Icon,
  accent,
  right,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  accent: HeadingAccent;
  right?: ReactNode;
}) {
  const c = ACCENTS[accent];
  return (
    <header className="ii-rise mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-center gap-3.5">
        <span
          className="grid h-12 w-12 flex-none place-items-center rounded-[16px] shadow-sm"
          style={{
            background: `color-mix(in srgb, ${c} 15%, transparent)`,
            color: c,
          }}
        >
          <Icon className="h-[22px] w-[22px]" strokeWidth={2} />
        </span>
        <div>
          <span className="text-xs font-medium uppercase tracking-[0.12em] text-faint">
            {eyebrow}
          </span>
          <h1 className="mt-1 text-[32px] font-semibold leading-none tracking-[-0.03em] text-ink">
            {title}
          </h1>
          {subtitle && <p className="mt-2 text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {right}
    </header>
  );
}
