import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "dark";
type Size = "sm" | "md";

// II Design System button variants — clinical green primary, no blue.
const variants: Record<Variant, string> = {
  primary:
    "bg-brand-solid text-brand-on shadow-[var(--shadow-green)] hover:bg-brand-solid-hover focus-visible:outline-brand",
  secondary:
    "bg-surface text-ink border border-line-strong hover:bg-surface-alt focus-visible:outline-line-strong",
  ghost:
    "bg-transparent text-muted hover:bg-surface-sunken hover:text-ink focus-visible:outline-line-strong",
  danger:
    "bg-danger text-brand-on hover:bg-danger/90 focus-visible:outline-danger",
  dark: "bg-ink text-surface hover:bg-ink/90 focus-visible:outline-ink",
};

const sizes: Record<Size, string> = {
  sm: "h-[34px] px-3.5 text-sm",
  md: "h-11 px-5 text-sm",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[14px] font-medium whitespace-nowrap transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-45",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
