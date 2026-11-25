// Fake but internally consistent world for the demo.
// One clinic, one doctor, one afternoon. Enough patients to make the cascade legible.

export type PatientId = string;

export type Patient = {
  id: PatientId;
  name: string;
  phone: string; // masked, cosmetic only
  age: number;
  note?: string; // shown in the cascade panel to make the choice feel human
};

export type Slot = {
  id: string;
  time: string;       // "17:00"
  patientId: PatientId | null;
  status: "confirmed" | "pending" | "cancelled" | "empty" | "refilled";
  // If refilled, who took it and where they came from
  refilledFrom?: { patientName: string; originalTime: string };
};

// The pool the cascade offers the slot to, in order.
// Real system would rank by distance, willingness, tenure — here it's just a list.
export type CascadeCandidate = {
  patientId: PatientId;
  origin:
    | { kind: "sameDayLater"; time: string }         // patient booked later today
    | { kind: "futureBooking"; date: string; time: string } // booked in a coming week
    | { kind: "waitingList" };
};

export type MessageDirection = "clinic-to-patient" | "patient-to-clinic";

export type Message = {
  id: string;
  from: string;
  to: string;
  body: string;
  direction: MessageDirection;
  ts: string;         // human-readable timestamp like "qua, 12 ago 21:15"
  channel: "SMS" | "WhatsApp";
};

// -------- world --------

export const CLINIC_NAME = "Clínica Teste";
export const DOCTOR_NAME = "Dr. Miguel Sousa";
// Second doctor, only used in scenes 5-7 — same naming pattern as the real
// multi-doctor agenda in the working prototype (Dr. Sousa / Dr. Silva / Dra. Lima).
export const DOCTOR2_NAME = "Dra. Lima";
export const DOCTOR3_NAME = "Dr. Silva";
export const DEMO_DATE_LABEL = "quinta, 13 ago 2026";

export const patients: Record<PatientId, Patient> = {
  ana:   { id: "ana",   name: "Ana Prata",     phone: "•••• 214", age: 42 },
  joao:  { id: "joao",  name: "João Melo",     phone: "•••• 887", age: 58, note: "voltou por dores lombares" },
  rita:  { id: "rita",  name: "Rita Sousa",    phone: "•••• 331", age: 34 },
  paulo: { id: "paulo", name: "Paulo Dias",    phone: "•••• 502", age: 61, note: "diabético; consulta seguinte às 18:00" },
  celia: { id: "celia", name: "Célia Faria",   phone: "•••• 190", age: 47, note: "marcada para 26 ago; disse que preferia mais cedo" },
  bruno: { id: "bruno", name: "Bruno Antunes", phone: "•••• 728", age: 29, note: "faltou à última consulta sem avisar" },
  helena:{ id: "helena",name: "Helena Vaz",    phone: "•••• 045", age: 55, note: "aguarda marcação de ecografia pedida a 4 ago" },
  tiago: { id: "tiago", name: "Tiago Reis",    phone: "•••• 613", age: 38, note: "recomendada cirurgia menor; ficou de pensar" },
  marta:   { id: "marta",   name: "Marta Ferreira",  phone: "•••• 356", age: 44, note: "consulta amanhã às 10:00 com o Dr. Sousa" },
  ricardo: { id: "ricardo", name: "Ricardo Nogueira", phone: "•••• 771", age: 51, note: "consulta marcada para sexta às 15:30" },
  sofia:   { id: "sofia",   name: "Sofia Ramos",     phone: "•••• 902", age: 36, note: "esteve na consulta a semana passada" },
  filipa:  { id: "filipa",  name: "Filipa Nunes",    phone: "•••• 448", age: 30, note: "contacto novo — nunca teve consulta aqui" },
};

// The agenda for the demo afternoon.
export const initialSlots: Slot[] = [
  { id: "s15", time: "15:00", patientId: "ana",   status: "confirmed" },
  { id: "s16", time: "16:00", patientId: "joao",  status: "confirmed" },
  { id: "s17", time: "17:00", patientId: "rita",  status: "confirmed" },
  { id: "s18", time: "18:00", patientId: "paulo", status: "confirmed" },
];

// Who to offer a freshly-opened slot to, in order.
export const cascadeFor17h: CascadeCandidate[] = [
  { patientId: "paulo", origin: { kind: "sameDayLater", time: "18:00" } },
  { patientId: "celia", origin: { kind: "futureBooking", date: "26 ago", time: "10:30" } },
  { patientId: "helena", origin: { kind: "waitingList" } },
];
