import { Calendar as CalendarIcon, RefreshCw, Check, Radio } from "lucide-react";
import Link from "next/link";
import { armRealtimeSync, disconnectGoogle, syncGoogleNow } from "./google-actions";

type State = {
  configured: boolean;
  connected: boolean;
  email: string | null;
  watching: boolean;
};

const BTN =
  "flex items-center gap-1.5 rounded-[8px] border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:border-line-strong hover:bg-surface-alt";
const CHIP =
  "flex items-center gap-1.5 rounded-[8px] border border-success/30 bg-success-bg px-3 py-2 text-sm font-medium text-success-fg";

/**
 * FULL Google Calendar control — lives on the Settings page. Three honest
 * states: not configured (disabled hint) · configured-not-connected (start
 * OAuth) · connected (account + real-time badge + Sincronizar + Desligar).
 * `redirectTo` is where the OAuth callback and the form actions return to.
 */
export function GoogleCalendarControl({
  configured,
  connected,
  email,
  watching,
  redirectTo = "/agenda",
}: State & { redirectTo?: "/agenda" | "/settings" }) {
  if (!configured) {
    return (
      <div className="rounded-[10px] border border-line bg-surface-alt px-4 py-3 text-sm text-muted">
        <p className="font-medium text-ink">Google Calendar</p>
        <p className="mt-1">
          Faltam as credenciais OAuth do Google (
          <code className="rounded bg-surface-sunken px-1">GOOGLE_CLIENT_ID</code>,{" "}
          <code className="rounded bg-surface-sunken px-1">GOOGLE_CLIENT_SECRET</code>
          , <code className="rounded bg-surface-sunken px-1">GOOGLE_TOKEN_ENC_KEY</code>
          ). Ver <code>docs/GOOGLE_CALENDAR_SETUP.md</code>.
        </p>
      </div>
    );
  }

  if (!connected) {
    return (
      <a
        href={`/api/google/connect?next=${redirectTo}`}
        className={`inline-${BTN}`}
      >
        <CalendarIcon className="h-4 w-4" />
        Ligar Google Calendar
      </a>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={CHIP}
        title={
          watching
            ? "Sincronização em tempo real ativa (push)"
            : "Ligado. Push em tempo real inativo (falta URL pública) — usa 'Sincronizar agora'."
        }
      >
        <Check className="h-4 w-4" />
        <span className="max-w-[18rem] truncate">
          {email ?? "Google Calendar"}
          {watching ? " · tempo real" : " · manual"}
        </span>
      </span>

      <form action={syncGoogleNow}>
        <input type="hidden" name="redirect_to" value={redirectTo} />
        <button type="submit" className={BTN} title="Puxar do Google e enviar para o Google agora">
          <RefreshCw className="h-4 w-4" />
          Sincronizar agora
        </button>
      </form>

      <form action={armRealtimeSync}>
        <input type="hidden" name="redirect_to" value={redirectTo} />
        <button
          type="submit"
          className={BTN}
          title={
            watching
              ? "Renovar a subscrição de tempo real (expira ~7 dias; refaz após reinício do túnel)"
              : "Ativar push em tempo real (Google → app). Requer GOOGLE_WEBHOOK_URL público."
          }
        >
          <Radio className="h-4 w-4" />
          {watching ? "Renovar tempo real" : "Ativar tempo real"}
        </button>
      </form>

      <form action={disconnectGoogle}>
        <input type="hidden" name="redirect_to" value={redirectTo} />
        <button
          type="submit"
          className="rounded-[8px] border border-line bg-surface px-3 py-2 text-sm font-medium text-muted hover:border-danger/40 hover:text-danger-fg"
          title="Desligar o Google Calendar desta clínica"
        >
          Desligar
        </button>
      </form>
    </div>
  );
}

/**
 * COMPACT status for the agenda header. Connected → a status chip + a small
 * "Sincronizar". Not connected (but configured) → a quiet link to Settings,
 * where the full connect/disconnect lives. Not configured → nothing (the
 * toolbar stays clean; the setup hint is on Settings).
 */
export function GoogleCalendarAgendaStatus({
  configured,
  connected,
  watching,
}: Omit<State, "email">) {
  if (!configured) return null;

  if (!connected) {
    return (
      <Link href="/settings" className={BTN} title="Ligar o Google Calendar nas Definições">
        <CalendarIcon className="h-4 w-4" />
        Ligar Google Calendar
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span
        className={CHIP}
        title={
          watching ? "Google Calendar em tempo real" : "Google Calendar ligado (sync manual)"
        }
      >
        <Check className="h-4 w-4" />
        Google Calendar
      </span>
      <form action={syncGoogleNow}>
        <input type="hidden" name="redirect_to" value="/agenda" />
        <button type="submit" className={BTN} title="Sincronizar com o Google Calendar agora">
          <RefreshCw className="h-4 w-4" />
          Sincronizar
        </button>
      </form>
    </div>
  );
}
