"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  LayoutDashboard,
  MessageSquare,
  Users,
  AlertCircle,
  Settings,
} from "lucide-react";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";

const nav = [
  { href: "/dashboard", label: "Painel", icon: LayoutDashboard },
  { href: "/agenda", label: "Agenda", icon: CalendarDays },
  { href: "/patients", label: "Pacientes", icon: Users },
  { href: "/conversations", label: "Conversas", icon: MessageSquare },
  { href: "/escalations", label: "Ajuda humana", icon: AlertCircle },
  { href: "/settings", label: "Definições", icon: Settings },
] as const;

// The II Design System rail: a 76px green-filled column that floats on the
// field with a 28px radius. Nav is icon-only — labels live in tooltips; the
// active section is a white 14px tile with a green glyph; counts are teal pills.
export function Sidebar({
  clinicName,
  staffName,
  staffRole,
  counts = {},
}: {
  clinicName: string;
  staffName: string;
  staffRole: string;
  counts?: Record<string, number>;
}) {
  const pathname = usePathname();
  const initials = staffName
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <nav
      title={`${clinicName} · ${staffName} · ${staffRole}`}
      className="flex h-full w-[76px] flex-none flex-col items-center gap-1.5 rounded-[28px] bg-sidebar py-4 shadow-[var(--shadow-green)]"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/ava-nobg.png"
        alt={clinicName}
        width={48}
        height={48}
        className="mb-3 h-12 w-12 flex-none select-none object-contain drop-shadow-[0_6px_14px_rgba(9,40,30,0.45)]"
        draggable={false}
      />

      {nav.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        const count = counts[href] ?? 0;
        return (
          <Link
            key={href}
            href={href}
            title={label}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "relative flex h-12 w-12 items-center justify-center rounded-[14px] bg-white text-brand transition-colors"
                : "relative flex h-12 w-12 items-center justify-center rounded-[14px] text-white/85 transition-colors hover:bg-white/15 hover:text-white"
            }
          >
            <Icon className="h-[19px] w-[19px]" strokeWidth={2} />
            {count > 0 && (
              <span className="absolute right-1 top-1.5 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-teal-600 px-1 text-[10px] font-semibold leading-none text-white">
                {count}
              </span>
            )}
          </Link>
        );
      })}

      <div className="flex-1" />

      <ThemeToggle iconOnly />
      <SignOutButton compact />

      {/* User avatar — bottom of the rail */}
      <div
        title={`${staffName} · ${staffRole}`}
        className="mt-1.5 grid h-9 w-9 flex-none place-items-center rounded-full bg-white text-xs font-semibold text-brand"
      >
        {initials}
      </div>
    </nav>
  );
}
