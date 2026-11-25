import { createClient } from "@/lib/supabase/server";
import { MockPhone } from "./mock-phone";

// The demo clinic the simulator texts. The patient side is intentionally
// unauthenticated — it stands in for a real phone until Twilio is wired up.
const DEMO_CLINIC_SLUG = "clinica-sousa";

type RosterEntry = { name: string; phone: string };

export default async function MockSmsPage() {
  const supabase = await createClient();

  // SECURITY DEFINER RPC — callable without a session (see migration 006).
  const { data } = await supabase.rpc("mock_sms_roster", {
    p_clinic_slug: DEMO_CLINIC_SLUG,
  });

  const roster = (data as RosterEntry[] | null) ?? [];

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-[#101a17] px-4 py-10">
      <div className="text-center">
        <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-[18px] bg-[#2f7d62]">
          <span className="text-lg font-semibold tracking-[-0.03em] text-white">
            II <span className="text-white/65">∞</span>
          </span>
        </div>
        <h1 className="text-lg font-semibold tracking-[-0.02em] text-[#eef4f1]">
          Simulador de SMS
        </h1>
        <p className="mt-1 text-sm text-[#9aaaa4]">
          Ferramenta de desenvolvimento — encarne um paciente e escreva para a
          clínica.
        </p>
      </div>

      {roster.length === 0 ? (
        <p className="rounded-[14px] bg-[#1d2f28] px-4 py-3 text-sm text-[#c8d5cf]">
          Nenhum paciente com telemóvel nesta clínica.
        </p>
      ) : (
        <MockPhone clinicSlug={DEMO_CLINIC_SLUG} roster={roster} />
      )}
    </main>
  );
}
