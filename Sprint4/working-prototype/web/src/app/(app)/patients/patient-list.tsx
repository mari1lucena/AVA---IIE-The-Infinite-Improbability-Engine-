"use client";

import { useMemo, useState } from "react";
import { Check, Search, Users } from "lucide-react";
import { updatePatient } from "./actions";

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

// Shared grid template so the header and every row line up. Inline style
// (not an arbitrary Tailwind class) so the column template is guaranteed to
// apply without depending on JIT class generation.
const COLS = "grid items-center gap-3";
const GRID_STYLE: React.CSSProperties = {
  gridTemplateColumns:
    "minmax(0,1fr) 150px 150px 70px 120px 110px 90px 90px",
};

export function PatientList({
  patients,
  doctors,
}: {
  patients: PatientRow[];
  doctors: DoctorRow[];
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter(
      (p) =>
        p.name.toLowerCase().includes(q) || p.phone.toLowerCase().includes(q),
    );
  }, [patients, query]);

  return (
    <>
      {/* Search */}
      <div className="ii-rise relative mb-3" style={{ ["--d" as string]: "0.1s" }}>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Procurar paciente por nome ou telefone…"
          className="w-full rounded-[14px] border border-line bg-surface-alt py-2.5 pl-9 pr-3 text-sm text-ink placeholder:text-faint focus:border-brand focus:bg-surface focus:outline-none"
        />
      </div>

      {/* List */}
      <div
        className="ii-rise min-h-0 flex-1 overflow-auto rounded-[22px] border border-line bg-surface shadow-sm"
        style={{ ["--d" as string]: "0.16s" }}
      >
        <div
          style={GRID_STYLE}
          className={`${COLS} sticky top-0 border-b border-line bg-surface-alt px-4 py-2 text-xs font-medium uppercase tracking-wide text-faint`}
        >
          <span>Nome</span>
          <span>Telefone</span>
          <span>Médico habitual</span>
          <span className="text-center">Ativo</span>
          <span className="text-center">Curto prazo</span>
          <span className="text-center">Lista de espera</span>
          <span className="text-center">Opt-out</span>
          <span />
        </div>

        {filtered.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-surface-sunken text-faint">
              <Users className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <p className="text-sm font-medium text-muted">
              {patients.length === 0 ? "Sem pacientes" : "Sem resultados"}
            </p>
            <p className="text-xs text-faint">
              {patients.length === 0
                ? "Adicione o primeiro paciente no formulário acima."
                : "Tente outro nome ou número de telefone."}
            </p>
          </div>
        )}

        {filtered.map((p) => (
          <form
            key={p.id}
            action={updatePatient}
            style={GRID_STYLE}
            className={`${COLS} border-b border-line-subtle px-4 py-2 last:border-b-0 hover:bg-surface-alt`}
          >
            <input type="hidden" name="id" value={p.id} />
            <div className="flex min-w-0 flex-col">
              <input
                name="name"
                defaultValue={p.name}
                className="w-full rounded-[8px] border border-transparent bg-transparent px-1.5 py-1 text-sm font-medium text-ink hover:border-line focus:border-line-strong focus:bg-surface focus:outline-none"
              />
              {p.no_show_count && p.no_show_count > 0 ? (
                <span className="px-1.5 text-[11px] text-danger-fg">
                  {p.no_show_count} falta{p.no_show_count > 1 ? "s" : ""}
                </span>
              ) : null}
            </div>
            <span className="truncate font-mono text-sm tabular-nums text-muted">
              {p.phone}
            </span>
            <select
              name="primary_doctor_id"
              defaultValue={p.primary_doctor_id ?? ""}
              className="w-full rounded-[8px] border border-transparent bg-transparent px-1.5 py-1 text-sm text-muted hover:border-line focus:border-line-strong focus:bg-surface focus:outline-none"
            >
              <option value="">— Nenhum —</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <label className="flex justify-center">
              <input
                type="checkbox"
                name="is_active"
                defaultChecked={p.is_active ?? false}
                className="h-4 w-4 accent-green-600"
              />
            </label>
            <label className="flex justify-center">
              <input
                type="checkbox"
                name="accepts_short_notice"
                defaultChecked={p.accepts_short_notice ?? false}
                className="h-4 w-4 accent-teal"
              />
            </label>
            <label className="flex justify-center">
              <input
                type="checkbox"
                name="waiting_list"
                className="h-4 w-4 accent-brand-solid"
              />
            </label>
            <label className="flex justify-center">
              <input
                type="checkbox"
                name="opted_out"
                defaultChecked={p.opted_out}
                className="h-4 w-4 accent-danger"
              />
            </label>
            <div className="flex justify-end">
              <button
                type="submit"
                className="flex items-center gap-1 rounded-[12px] border border-line bg-surface px-2.5 py-1 text-xs font-medium text-muted hover:bg-surface-alt"
              >
                <Check className="h-3.5 w-3.5" />
                Guardar
              </button>
            </div>
          </form>
        ))}
      </div>
    </>
  );
}
