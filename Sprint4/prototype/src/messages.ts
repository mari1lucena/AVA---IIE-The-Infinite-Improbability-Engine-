// Message copy, kept in one place so the tone stays consistent.
// Rule of thumb: sound like a person from the clinic, not a system.
// No "estimado utente", no ALL CAPS, no threats. Assume the patient is busy and might miss it.

import { CLINIC_NAME } from "./data";

export const eveningConfirmation = (name: string, time: string) =>
  `Olá ${name.split(" ")[0]}, é da ${CLINIC_NAME}. ` +
  `Só a confirmar a consulta de amanhã às ${time} com o Dr. Sousa. ` +
  `Responda SIM para confirmar ou NÃO se não puder vir — sem problema, remarcamos.`;

export const cascadeOfferSameDay = (name: string, freedTime: string, originalTime: string) =>
  `Olá ${name.split(" ")[0]}, é da ${CLINIC_NAME}. ` +
  `Abriu uma vaga às ${freedTime} com o Dr. Sousa — é uma hora antes da sua consulta das ${originalTime}. ` +
  `Quer trocar? Responda SIM ou NÃO, para não estar à espera.`;

export const cascadeOfferFuture = (name: string, freedTime: string, originalDate: string) =>
  `Olá ${name.split(" ")[0]}, é da ${CLINIC_NAME}. ` +
  `Sei que estava marcada para ${originalDate}, mas tenho uma vaga amanhã às ${freedTime} com o Dr. Sousa. ` +
  `Quer antecipar? Responda SIM ou NÃO.`;

export const cascadeOfferWaiting = (name: string, freedTime: string) =>
  `Olá ${name.split(" ")[0]}, é da ${CLINIC_NAME}. ` +
  `Ficou em lista de espera — abriu uma vaga amanhã às ${freedTime} com o Dr. Sousa. ` +
  `Quer ficar com ela? Responda SIM ou NÃO.`;

// ---- follow-up after the visit ----

export const examFollowUp = (name: string, examName: string) =>
  `Olá ${name.split(" ")[0]}. O Dr. Sousa pediu ${examName}. ` +
  `Já conseguiu marcar? Se quiser, ajudamos a marcar aqui: [marcar exame]`;

export const postVisitSummary = (name: string) =>
  `Olá ${name.split(" ")[0]}, resumo da sua consulta de hoje:\n\n` +
  `Dexametasona 4mg — 1 ampola IM agora, depois em comprimidos (desmame em 5 dias).\n` +
  `Omeprazol 20mg — 1 cápsula em jejum, durante 2 semanas.\n` +
  `Ibuprofeno 600mg — 1 comprimido de 8 em 8h, se dor.\n\n`;

export const noShowFollowUp = (name: string, missedDate: string) =>
  `Olá ${name.split(" ")[0]}, sentimos a sua falta na consulta de ${missedDate}. ` +
  `Está tudo bem? Se quiser, remarcamos aqui: [remarcar] — sem pergunta nenhuma sobre a falta.`;

// ---- free-form reschedule (scene 5) ----
// Not a numbered menu: the system asks before it offers, and only searches
// once it actually has a day/hour/period to search around.

export const clarifyPreference = (name: string) =>
  `Sem problema, ${name.split(" ")[0]}. Diga-me só que dia e que altura do dia lhe dá mais jeito, que eu vejo o que há.`;

export const rescheduleOffer = (dayPeriodLabel: string, times: string[], doctor: string) =>
  `${dayPeriodLabel} tenho com ${doctor} às ${times[0]} ou às ${times[1]}. Qual lhe fica melhor?`;

export const rescheduleConfirm = (dayLabel: string, time: string, doctor: string, freedTime: string) =>
  `Combinado — passa para ${dayLabel} às ${time} com ${doctor}. A vaga de amanhã às ${freedTime} ficou livre; já a estou a oferecer a outro paciente.`;

// ---- cancel request: resist, then comply (scene 6) ----
// Never cancels on the first ask — offers to reschedule first.

export const cancelNudge = () =>
  `Antes de cancelar de vez — quer que eu tente arranjar outro dia, em vez de cancelar?`;

export const cancelConfirmed = () =>
  `Está bem, cancelei a consulta de sexta. Se mudar de ideias, é só escrever.`;

export const rescheduleAltOffer = (times: string[]) =>
  `Para a semana que vem tenho ${times[0]} ou ${times[1]} com o Dr. Sousa. Fica bem alguma?`;

export const rescheduleAltConfirm = (time: string) =>
  `Ótimo — fica marcado para as ${time}. Obrigado por avisar.`;

// ---- clinical question: escalate, never answer (scene 7) ----

export const escalationReply = () =>
  `Isso é uma questão clínica — não posso decidir por si. Vou já encaminhar para a equipa da ${CLINIC_NAME}; alguém entra em contacto consigo em breve.`;
