import { LogOut } from "lucide-react";

// Icon-only `compact` variant lives in the rail; the default labelled variant
// is still available for other surfaces.
export function SignOutButton({ compact = false }: { compact?: boolean }) {
  return (
    <form action="/auth/signout" method="post">
      {compact ? (
        <button
          type="submit"
          title="Sair"
          aria-label="Sair"
          className="flex h-11 w-11 items-center justify-center rounded-[14px] text-white/85 transition-colors hover:bg-white/15 hover:text-white"
        >
          <LogOut className="h-[18px] w-[18px]" />
        </button>
      ) : (
        <button
          type="submit"
          className="flex w-full items-center gap-2 rounded-[14px] px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-sunken hover:text-ink"
        >
          <LogOut className="h-4 w-4" />
          Sair
        </button>
      )}
    </form>
  );
}
