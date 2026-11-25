"use client";

import { useSyncExternalStore } from "react";
import { Sun, Moon } from "lucide-react";

/**
 * Light/dark switch. Persists an explicit choice to localStorage and stamps
 * `data-theme` on <html> (globals.css resolves the tokens). Without a stored
 * choice the app follows the OS; the first toggle makes it explicit. A no-flash
 * inline script in the root layout applies the stored choice before first paint.
 */
const EVENT = "ii-themechange";

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function currentTheme(): "light" | "dark" {
  const stored = localStorage.getItem("theme");
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

// Default style suits a light "surface" (e.g. the Settings card). Pass
// `className` to place it elsewhere (e.g. the dark sidebar).
const SURFACE_STYLE =
  "inline-flex items-center gap-2 rounded-[8px] border border-line bg-surface px-3 py-2 text-sm font-medium text-ink transition-colors hover:border-line-strong hover:bg-surface-alt";

// Icon-only variant for the green rail (white-on-green, 44px tile).
const RAIL_STYLE =
  "flex h-11 w-11 items-center justify-center rounded-[14px] text-white/85 transition-colors hover:bg-white/15 hover:text-white";

export function ThemeToggle({
  className,
  iconOnly = false,
}: {
  className?: string;
  iconOnly?: boolean;
}) {
  // useSyncExternalStore reconciles the server "light" fallback with the real
  // client theme without a hydration mismatch, and re-renders on toggle.
  const current = useSyncExternalStore(subscribe, currentTheme, () => "light");
  const next = current === "dark" ? "light" : "dark";

  function toggle() {
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
    window.dispatchEvent(new Event(EVENT));
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={next === "dark" ? "Ativar modo escuro" : "Ativar modo claro"}
      title={next === "dark" ? "Modo escuro" : "Modo claro"}
      className={className ?? (iconOnly ? RAIL_STYLE : SURFACE_STYLE)}
    >
      {current === "dark" ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
      {!iconOnly && (current === "dark" ? "Modo claro" : "Modo escuro")}
    </button>
  );
}
