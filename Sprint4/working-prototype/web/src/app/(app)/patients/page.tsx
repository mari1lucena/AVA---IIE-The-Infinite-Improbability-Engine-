import { UserPlus, Users, UserCheck, Zap, BellOff } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { addPatient } from "./actions";
import { PatientList } from "./patient-list";
import { PageHeading } from "@/components/page-heading";
import { MiniStat, STAT_ACCENT } from "@/components/mini-stat";

type PatientRow = {
  id: string;
  name: string;
  phone: string;
  is_active: boolean | null;
  accepts_short_notice: boolean | null;
  opted_out: boolean;
  no_show_count: number | null;
  primary_doctor_id: string | null;
};

type DoctorRow = { id: string; name: string };

export default async function PatientsPage() {
  const supabase = await createClient();
  // RLS scopes to the caller's clinic.
  const [{ data }, { data: doctorsData }] = await Promise.all([
    supabase
      .from("patients")
      .select(
        "id, name, phone, is_active, accepts_short_notice, opted_out, no_show_count, primary_doctor_id",
      )
      .order("name", { ascending: true }),
    supabase
      .from("doctors")
      .select("id, name")
      .eq("is_active", true)
      .order("name", { ascending: true }),
  ]);
  const patients = (data ?? []) as PatientRow[];
  const doctors = (doctorsData ?? []) as DoctorRow[];

  const activeN = patients.filter((p) => p.is_active !== false).length;
  const shortNoticeN = patients.filter((p) => p.accepts_short_notice).length;
  const optedOutN = patients.filter((p) => p.opted_out).length;

  const stats = [
    {
      label: "Registados",
      value: patients.length,
      hint: "Total na clínica",
      icon: Users,
      accent: STAT_ACCENT.teal,
      filled: true,
    },
    {
      label: "Ativos",
      value: activeN,
      hint: "Recebem mensagens",
      icon: UserCheck,
      accent: STAT_ACCENT.green,
    },
    {
      label: "Curto prazo",
      value: shortNoticeN,
      hint: "Aceitam vagas mais cedo",
      icon: Zap,
      accent: STAT_ACCENT.mint,
    },
    {
      label: "Opt-out",
      value: optedOutN,
      hint: "Sem mensagens (STOP)",
      icon: BellOff,
      accent: STAT_ACCENT.amber,
    },
  ];

  return (
    <div className="flex h-full flex-col p-8">
      <PageHeading eyebrow="Receção" title="Pacientes" icon={Users} accent="teal" />

      {/* colored stat strip — mirrors the dashboard metric cards */}
      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {stats.map((s, i) => (
          <MiniStat key={s.label} {...s} delay={`${0.04 + i * 0.05}s`} />
        ))}
      </div>

      {/* Add patient */}
      <form
        action={addPatient}
        className="ii-rise mb-5 flex flex-wrap items-end gap-3 rounded-[22px] border border-line bg-surface p-4 shadow-sm"
        style={{ ["--d" as string]: "0.06s" }}
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted">Nome</label>
          <input
            name="name"
            required
            placeholder="Nome do paciente"
            className="w-56 rounded-[10px] border border-line bg-surface-alt px-2.5 py-2 text-sm text-ink placeholder:text-faint focus:border-brand focus:outline-none"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted">Telefone</label>
          <input
            name="phone"
            required
            inputMode="tel"
            placeholder="+3519xxxxxxxx"
            className="w-44 rounded-[10px] border border-line bg-surface-alt px-2.5 py-2 text-sm text-ink placeholder:text-faint focus:border-brand focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="flex items-center gap-1.5 rounded-[12px] bg-brand-solid px-3.5 py-2 text-sm font-medium text-brand-on shadow-[var(--shadow-green)] hover:bg-brand-solid-hover"
        >
          <UserPlus className="h-4 w-4" />
          Adicionar
        </button>
      </form>

      <PatientList patients={patients} doctors={doctors} />

      <p className="mt-2 text-xs text-faint">
        Médico habitual: atribuído automaticamente pelo agente na primeira marcação,
        e só muda se o paciente pedir explicitamente outro médico · Ativo: recebe
        mensagens · Curto prazo: aceita ofertas de vagas mais cedo · Lista de espera:
        recebe todas as ofertas de vagas · Opt-out: não recebe mensagens automáticas
        (STOP).
      </p>
    </div>
  );
}
