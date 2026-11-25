import { Settings as SettingsIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isGoogleConfigured } from "@/lib/google/oauth";
import { GoogleCalendarControl } from "../agenda/google-calendar-control";
import { ThemeToggle } from "@/components/theme-toggle";
import { AgentSettingsForm } from "./agent-settings-form";
import { ReceptionSettingsForm } from "./reception-settings-form";
import { PageHeading } from "@/components/page-heading";

/**
 * Clinic settings. Two sections:
 *   - Aparência   — the light/dark theme toggle (moved here from the sidebar).
 *   - Integrações — the Google Calendar connection (connect / status /
 *     disconnect). The agenda header keeps only a compact status + "Sincronizar";
 *     the credential-grade connect lives here, its natural home.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string; reason?: string; watching?: string }>;
}) {
  const sp = await searchParams;

  const supabase = await createClient();
  const gConfigured = isGoogleConfigured();
  const { data: clinicRow } = await supabase
    .from("clinics")
    .select(
      "name, google_connected_email, google_refresh_token, google_connected_at, agent_name, agent_tone, agent_language, agent_signature, agent_use_emoji, agent_custom_instructions, notify_patient_on_reception_change",
    )
    .limit(1)
    .maybeSingle();

  const gConnected = Boolean(clinicRow?.google_refresh_token);
  const gEmail = clinicRow?.google_connected_email ?? null;
  // Real-time push is per-doctor now — "watching" if any doctor has a channel.
  const { count: watchCount } = await supabase
    .from("doctors")
    .select("id", { count: "exact", head: true })
    .not("google_channel_id", "is", null);
  const gWatching = (watchCount ?? 0) > 0;
  const connectedAt = clinicRow?.google_connected_at
    ? new Date(clinicRow.google_connected_at).toLocaleString("pt-PT", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;

  return (
    <div className="flex h-full flex-col p-8">
      <PageHeading
        eyebrow={`${clinicRow?.name ?? "Clínica"} · Receção`}
        title="Definições"
        icon={SettingsIcon}
        accent="mint"
      />

      {sp?.google && (
        <div
          className={`mb-6 max-w-2xl rounded-[10px] border px-4 py-2.5 text-sm ${
            sp.google === "error"
              ? "border-danger/30 bg-danger-bg text-danger-fg"
              : "border-success/30 bg-success-bg text-success-fg"
          }`}
        >
          {sp.google === "connected"
            ? "Google Calendar ligado — a agenda começou a sincronizar."
            : sp.google === "synced"
              ? "Sincronização com o Google Calendar concluída."
              : sp.google === "armed"
                ? `Sincronização em tempo real ativada${sp.watching ? ` (${sp.watching} calendário(s))` : ""}.`
                : sp.google === "disconnected"
                  ? "Google Calendar desligado desta clínica."
                  : `Erro na ligação ao Google Calendar${sp.reason ? `: ${sp.reason}` : "."}`}
        </div>
      )}

      <div className="max-w-2xl space-y-8">
        <section>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">
            Aparência
          </h2>
          <div className="rounded-[22px] border border-line bg-surface p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-medium text-ink">Tema</h3>
                <p className="mt-0.5 text-sm text-muted">
                  Alterna entre modo claro e escuro. Sem escolha explícita, segue
                  o sistema.
                </p>
              </div>
              <ThemeToggle />
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">
            Agente
          </h2>
          <div className="rounded-[22px] border border-line bg-surface p-5 shadow-sm">
            <div className="mb-4">
              <h3 className="font-medium text-ink">Como o agente comunica</h3>
              <p className="mt-0.5 text-sm text-muted">
                Ajusta a forma como o agente de SMS se apresenta e fala com os
                pacientes. Não altera as regras de marcação, cancelamento nem o
                aviso de RGPD (STOP), que se mantêm sempre.
              </p>
            </div>
            <AgentSettingsForm
              defaults={{
                agent_name: clinicRow?.agent_name ?? null,
                agent_tone: clinicRow?.agent_tone ?? "formal",
                agent_language: clinicRow?.agent_language ?? "pt",
                agent_signature: clinicRow?.agent_signature ?? null,
                agent_use_emoji: clinicRow?.agent_use_emoji ?? false,
                agent_custom_instructions:
                  clinicRow?.agent_custom_instructions ?? null,
              }}
            />
          </div>
        </section>

        <section>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">
            Comandos de agenda
          </h2>
          <div className="rounded-[22px] border border-line bg-surface p-5 shadow-sm">
            <div className="mb-4">
              <h3 className="font-medium text-ink">
                Alterações pela receção
              </h3>
              <p className="mt-0.5 text-sm text-muted">
                Comportamento do bloco de comandos no painel, onde a receção
                escreve alterações à agenda em texto livre.
              </p>
            </div>
            <ReceptionSettingsForm
              defaultOn={
                clinicRow?.notify_patient_on_reception_change ?? true
              }
            />
          </div>
        </section>

        <section>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">
            Integrações
          </h2>
          <div className="rounded-[22px] border border-line bg-surface p-5 shadow-sm">
            <div className="mb-3">
              <h3 className="font-medium text-ink">Google Calendar</h3>
              <p className="mt-0.5 text-sm text-muted">
                Sincroniza a agenda com o Google Calendar nos dois sentidos — as
                marcações feitas no Google entram aqui, e o que muda aqui reflete
                no Google. Permite gerir a agenda sem depender da API do sistema
                atual da clínica.
              </p>
              {gConnected && gEmail && (
                <p className="mt-2 text-sm text-ink">
                  Conta: <span className="font-medium">{gEmail}</span>
                  {connectedAt ? ` · ligado em ${connectedAt}` : ""}
                  {" · "}
                  {gWatching ? "sincronização em tempo real" : "sincronização manual"}
                </p>
              )}
            </div>

            <GoogleCalendarControl
              configured={gConfigured}
              connected={gConnected}
              email={gEmail}
              watching={gWatching}
              redirectTo="/settings"
            />
          </div>
        </section>
      </div>
    </div>
  );
}
