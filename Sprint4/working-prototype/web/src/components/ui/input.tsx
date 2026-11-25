import * as React from "react";
import { cn } from "@/lib/utils";

// II Design System input — 14px radius, raised field, green focus ring.
export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "flex h-11 w-full rounded-[14px] border border-line-strong bg-surface-alt px-4 text-sm text-ink transition-colors placeholder:text-faint focus-visible:border-brand focus-visible:bg-surface focus-visible:outline-none focus-visible:shadow-[var(--ring-focus)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
