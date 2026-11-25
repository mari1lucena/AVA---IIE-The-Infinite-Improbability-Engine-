import { useMemo, useState } from "react";
import "./App.css";
import {
  cascadeFor17h,
  CLINIC_NAME,
  DEMO_DATE_LABEL,
  DOCTOR2_NAME,
  DOCTOR3_NAME,
  initialSlots,
  patients,
  type CascadeCandidate,
  type Message,
  type PatientId,
  type Slot,
} from "./data";
import {
  cancelConfirmed,
  cancelNudge,
  cascadeOfferFuture,
  cascadeOfferSameDay,
  cascadeOfferWaiting,
  clarifyPreference,
  escalationReply,
  eveningConfirmation,
  examFollowUp,
  noShowFollowUp,
  postVisitSummary,
  rescheduleAltConfirm,
  rescheduleAltOffer,
  rescheduleConfirm,
  rescheduleOffer,
} from "./messages";

// ------------------------------------------------------------------
// The whole app is one machine driven by explicit clicks.
// No wall clock, no setTimeout: everything is a step function so
// the demo is fully reproducible in front of a live interviewee.
// ------------------------------------------------------------------

type Scene = "cascade" | "exam" | "postvisit" | "noshow" | "reschedule" | "cancel" | "escalate" | "booking";

type CascadeStage =
  | { kind: "idle" }                                    // agenda calm, before anything happens
  | { kind: "confirming" }                              // day-before confirmations sent
  | { kind: "cancelled"; slotId: string }               // Rita just cancelled
  | { kind: "offering"; slotId: string; step: number }  // waiting for patient N to answer
  | { kind: "declined"; slotId: string; step: number }  // that patient said no, ready to try next
  // Someone booked LATER THE SAME DAY moved up. The clinic has gained nothing yet —
  // the hole simply moved to their old time. The cascade must continue.
  | { kind: "chained"; slotId: string; step: number; movedName: string; fromTime: string }
  | { kind: "filled"; slotId: string }                  // filled from OUTSIDE the day: real gain
  | { kind: "exhausted"; slotId: string };              // ran out of candidates; gives up 2h before

export default function App() {
  const [scene, setScene] = useState<Scene>("cascade");

  return (
    <div className="app">
      <TopBar scene={scene} onSceneChange={setScene} />
      {scene === "cascade"    && <CascadeScene />}
      {scene === "exam"       && <FollowUpScene kind="exam" />}
      {scene === "postvisit"  && <FollowUpScene kind="postvisit" />}
      {scene === "noshow"     && <FollowUpScene kind="noshow" />}
      {scene === "reschedule" && <RescheduleScene />}
      {scene === "cancel"     && <CancelScene />}
      {scene === "escalate"   && <EscalationScene />}
      {scene === "booking"    && <BookingScene />}
      <Footer />
    </div>
  );
}

// -----------------------------
// Top bar (scene switcher)
// -----------------------------

function TopBar({ scene, onSceneChange }: { scene: Scene; onSceneChange: (s: Scene) => void }) {
  const tabs: { id: Scene; label: string; hint: string }[] = [
    { id: "cascade", label: "1. Vagas canceladas",   hint: "Rita cancela → sistema oferece a vaga" },
    { id: "exam",    label: "2. Exame por marcar",   hint: "Dr. pediu ecografia" },
    { id: "postvisit", label: "3. Resumo pós-consulta", hint: "Resumo + próximo passo, enviado automaticamente" },
    { id: "noshow",  label: "4. Falta sem aviso",    hint: "Não veio, ninguém ligou" },
    { id: "reschedule", label: "5. Reagendamento por conversa", hint: "Marta pede para remarcar, em português normal — não é SIM/NÃO" },
    { id: "cancel",     label: "6. Pedido de cancelamento",     hint: "Ricardo quer cancelar — o sistema não desiste logo" },
    { id: "escalate",   label: "7. Pergunta clínica",           hint: "A IA não arrisca — encaminha para uma pessoa" },
    { id: "booking",    label: "8. Marcar consulta",            hint: "Contacto novo, sem ninguém ligar — inicia a paciente" },
  ];
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-sub">
          <div>{CLINIC_NAME}</div>
          <div className="muted">{DEMO_DATE_LABEL}</div>
        </div>
      </div>
      <nav className="tabs">
        {tabs.map(t => (
          <button
            key={t.id}
            className={`tab ${scene === t.id ? "active" : ""}`}
            onClick={() => onSceneChange(t.id)}
            title={t.hint}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </header>
  );
}

// -----------------------------
// Scene 1: cascade
// -----------------------------

function CascadeScene() {
  const [slots, setSlots]     = useState<Slot[]>(initialSlots);
  const [stage, setStage]     = useState<CascadeStage>({ kind: "idle" });
  const [messages, setMsgs]   = useState<Message[]>([]);
  // Which patient's phone is currently on screen. Starts empty; becomes whoever the
  // system is talking to. In the demo you point and say "look at the phone."
  const [phoneOwner, setPhoneOwner] = useState<PatientId | null>(null);

  const addMsg = (m: Omit<Message, "id">) =>
    setMsgs(prev => [...prev, { ...m, id: `${prev.length}` }]);

  // ---------- steps ----------

  const step_sendEveningConfirmations = () => {
    // At 18:30 the day before, everyone with a slot tomorrow gets asked to confirm.
    const confirmables = slots.filter(s => s.patientId && s.status === "confirmed");
    confirmables.forEach(s => {
      const p = patients[s.patientId!];
      addMsg({
        from: CLINIC_NAME, to: p.name,
        body: eveningConfirmation(p.name, s.time),
        direction: "clinic-to-patient", ts: "qua, 12 ago · 18:30", channel: "SMS",
      });
    });
    setPhoneOwner("rita");
    setStage({ kind: "confirming" });
  };

  const step_ritaCancels = () => {
    // Rita replies at 21:15 that she can't come tomorrow.
    const rita = patients["rita"];
    addMsg({
      from: rita.name, to: CLINIC_NAME,
      body: "Não consigo ir amanhã, desculpem. Podemos remarcar?",
      direction: "patient-to-clinic", ts: "qua, 12 ago · 21:15", channel: "SMS",
    });
    setSlots(prev => prev.map(s => s.id === "s17" ? { ...s, status: "cancelled" } : s));
    setStage({ kind: "cancelled", slotId: "s17" });
  };

  const step_startCascade = () => {
    // Morning of. Offer the freed 17:00 to the first candidate.
    setStage({ kind: "offering", slotId: "s17", step: 0 });
    offerTo(cascadeFor17h[0], "s17");
  };

  const offerTo = (cand: CascadeCandidate, slotId: string) => {
    const freed = slots.find(s => s.id === slotId)!.time;
    const p     = patients[cand.patientId];
    let body: string;
    if (cand.origin.kind === "sameDayLater")   body = cascadeOfferSameDay(p.name, freed, cand.origin.time);
    else if (cand.origin.kind === "futureBooking") body = cascadeOfferFuture(p.name, freed, cand.origin.date);
    else body = cascadeOfferWaiting(p.name, freed);
    addMsg({
      from: CLINIC_NAME, to: p.name, body,
      direction: "clinic-to-patient", ts: "qui, 13 ago · 08:00", channel: "SMS",
    });
    setPhoneOwner(cand.patientId);
  };

  const step_candidateResponds = (accepted: boolean) => {
    if (stage.kind !== "offering") return;
    const cand = cascadeFor17h[stage.step];
    const p    = patients[cand.patientId];
    addMsg({
      from: p.name, to: CLINIC_NAME,
      body: accepted ? "Sim, obrigado — fico com essa." : "Obrigado, mas não consigo trocar.",
      direction: "patient-to-clinic", ts: "qui, 13 ago · 08:07", channel: "SMS",
    });

    if (!accepted) {
      setStage({ kind: "declined", slotId: stage.slotId, step: stage.step });
      return;
    }

    const movedWithinDay = cand.origin.kind === "sameDayLater";
    const originLabelText =
      cand.origin.kind === "sameDayLater"   ? cand.origin.time :
      cand.origin.kind === "futureBooking"  ? cand.origin.date :
                                              "lista de espera";

    setSlots(prev => prev.map(s => {
      if (s.id === stage.slotId) {
        return {
          ...s,
          patientId: p.id,
          status: "refilled",
          refilledFrom: { patientName: p.name, originalTime: originLabelText },
        };
      }
      // Moved up from later the same day → their old slot is now the open one.
      if (movedWithinDay && cand.origin.kind === "sameDayLater"
          && s.time === cand.origin.time && s.patientId === p.id) {
        return { ...s, patientId: null, status: "empty" };
      }
      return s;
    }));

    if (movedWithinDay && cand.origin.kind === "sameDayLater") {
      // Honest accounting: the day still has the same number of empty slots.
      // The hole moved from 17:00 to 18:00. Nothing recovered yet — keep going.
      setStage({
        kind: "chained",
        slotId: stage.slotId,
        step: stage.step,
        movedName: p.name,
        fromTime: cand.origin.time,
      });
    } else {
      // Filled from outside today (future booking or waiting list): a real, countable gain.
      setStage({ kind: "filled", slotId: stage.slotId });
    }
  };

  // Continue the cascade — either after a refusal, or after a same-day move
  // left a new hole further down the day.
  const step_tryNext = () => {
    if (stage.kind !== "declined" && stage.kind !== "chained") return;
    const nextStep = stage.step + 1;
    if (nextStep >= cascadeFor17h.length) {
      // Real system: keeps trying until 2h before the slot, then gives up.
      setStage({ kind: "exhausted", slotId: stage.slotId });
      return;
    }

    // If a same-day patient moved up, the slot now being offered is the one they vacated.
    const targetSlotId =
      stage.kind === "chained"
        ? (slots.find(s => s.time === stage.fromTime)?.id ?? stage.slotId)
        : stage.slotId;

    setStage({ kind: "offering", slotId: targetSlotId, step: nextStep });
    offerTo(cascadeFor17h[nextStep], targetSlotId);
  };

  const step_reset = () => {
    setSlots(initialSlots);
    setStage({ kind: "idle" });
    setMsgs([]);
    setPhoneOwner(null);
  };

  // ---------- next-action button ----------
  // A single "próximo passo" button that always knows what to do.
  // Interviews interrupt — this keeps the demo linear even if someone talks over it.

  const nextAction = useMemo<{ label: string; onClick: () => void } | null>(() => {
    if (stage.kind === "idle" && messages.length === 0)
      return { label: "1. Enviar confirmações de véspera (18:30)", onClick: step_sendEveningConfirmations };
    if (stage.kind === "confirming")
      return { label: "2. Rita cancela às 21:15", onClick: step_ritaCancels };
    if (stage.kind === "cancelled")
      return { label: "3. Manhã seguinte — oferecer a vaga", onClick: step_startCascade };
    if (stage.kind === "declined")
      return { label: "Tentar o próximo candidato", onClick: step_tryNext };
    if (stage.kind === "chained")
      return { label: `Continuar — falta preencher as ${stage.fromTime}`, onClick: step_tryNext };
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, messages.length]);

  return (
    <main className="scene">
      <StepBar stage={stage} nextAction={nextAction} onReset={step_reset} />

      <div className="split">
        <ClinicPanel slots={slots} stage={stage} />
        <PhonePanel
          messages={messages}
          phoneOwner={phoneOwner}
          onAcceptOffer={() => step_candidateResponds(true)}
          onDeclineOffer={() => step_candidateResponds(false)}
          canRespond={stage.kind === "offering"}
        />
      </div>
    </main>
  );
}

function StepBar({
  stage, nextAction, onReset,
}: {
  stage: CascadeStage;
  nextAction: { label: string; onClick: () => void } | null;
  onReset: () => void;
}) {
  const explain = () => {
    switch (stage.kind) {
      case "idle":       return "Antes de começar: agenda de quinta, tudo confirmado.";
      case "confirming": return "Todos os pacientes receberam a confirmação de véspera. Aguardar respostas.";
      case "cancelled":  return "A Rita cancelou. A vaga das 17:00 abriu — ninguém ligou a ninguém, ainda.";
      case "offering":   return `Cascata a correr. Passo ${stage.step + 1} de ${cascadeFor17h.length}.`;
      case "declined":   return "Este disse que não. O sistema passa ao próximo — não desiste.";
      case "chained":    return `${stage.movedName.split(" ")[0]} subiu, mas o buraco só mudou de sítio: agora falta às ${stage.fromTime}. Ainda não recuperámos nada — a cascata continua.`;
      case "filled":     return "Vaga preenchida por alguém de fora do dia. Agora sim: consulta que não existia.";
      case "exhausted":  return "Ninguém aceitou. O sistema desiste 2h antes e assinala a vaga — mas ficou registado que se perdeu.";
    }
  };
  return (
    <div className="stepbar">
      <div className="stepbar-explain">{explain()}</div>
      <div className="stepbar-actions">
        {nextAction && <button className="btn-primary" onClick={nextAction.onClick}>{nextAction.label}</button>}
        <button className="btn-ghost" onClick={onReset}>↻ Recomeçar</button>
      </div>
    </div>
  );
}

// -----------------------------
// Clinic (agenda) panel
// -----------------------------

function ClinicPanel({ slots, stage }: { slots: Slot[]; stage: CascadeStage }) {
  return (
    <section className="panel clinic">
      <h2 className="panel-title">Agenda</h2>
      <div className="panel-sub">{DEMO_DATE_LABEL}</div>

      <ul className="agenda">
        {slots.map(s => (
          <li key={s.id} className={`slot slot-${s.status}`}>
            <span className="slot-time">{s.time}</span>
            <span className="slot-body">
              {s.patientId ? (
                <>
                  <span className="slot-name">{patients[s.patientId].name}</span>
                  {s.refilledFrom && (
                    <span className="slot-tag">
                      ← veio de {s.refilledFrom.originalTime}
                    </span>
                  )}
                </>
              ) : (
                <span className="slot-empty">— vaga aberta —</span>
              )}
            </span>
            <span className="slot-status">{statusLabel(s.status)}</span>
          </li>
        ))}
      </ul>

      {(stage.kind === "offering" || stage.kind === "declined" || stage.kind === "chained") && (
        <div className="cascade-inspector">
          <div className="cascade-inspector-title">Fila de candidatos à vaga</div>
          <ol className="cascade-list">
            {cascadeFor17h.map((c, i) => {
              const p = patients[c.patientId];
              // Earlier candidates always refused (an acceptance ends or chains the cascade).
              // The current one is either being asked, has refused, or accepted-and-moved.
              const state: "declined" | "asking" | "queued" | "moved" =
                i < stage.step   ? "declined"
              : i === stage.step ? (stage.kind === "offering" ? "asking"
                                  : stage.kind === "chained"  ? "moved"
                                  : "declined")
              : "queued";
              return (
                <li key={c.patientId} className={`cascade-item cascade-${state}`}>
                  <span className="cascade-idx">{i + 1}</span>
                  <span>
                    <strong>{p.name}</strong> · {originLabel(c)}
                    {p.note && <div className="muted small">{p.note}</div>}
                  </span>
                  <span className="cascade-state">
                    {state === "declined" ? "recusou"
                   : state === "asking"   ? "a aguardar"
                   : state === "moved"    ? "aceitou e subiu"
                   : "em fila"}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
}

function statusLabel(s: Slot["status"]) {
  switch (s) {
    case "confirmed": return "✓ confirmado";
    case "pending":   return "· pendente";
    case "cancelled": return "✗ cancelado";
    case "empty":     return "○ aberto";
    case "refilled":  return "✓ preenchido";
  }
}

function originLabel(c: CascadeCandidate) {
  if (c.origin.kind === "sameDayLater")   return `tem consulta hoje às ${c.origin.time}`;
  if (c.origin.kind === "futureBooking")  return `marcada para ${c.origin.date}, ${c.origin.time}`;
  return "lista de espera";
}

// -----------------------------
// Phone panel
// -----------------------------

function PhonePanel({
  messages, phoneOwner, onAcceptOffer, onDeclineOffer, canRespond,
}: {
  messages: Message[];
  phoneOwner: PatientId | null;
  onAcceptOffer: () => void;
  onDeclineOffer: () => void;
  canRespond: boolean;
}) {
  // Show only the conversation with the current owner — otherwise the demo
  // becomes a wall of every message ever sent.
  const owner = phoneOwner ? patients[phoneOwner] : null;
  const thread = owner
    ? messages.filter(m => m.from === owner.name || m.to === owner.name)
    : [];

  return (
    <section className="panel phone-wrap">
      <div className="phone">
        <div className="phone-notch" />
        <div className="phone-screen">
          {owner ? (
            <>
              <div className="phone-header">
                <div className="phone-title">{CLINIC_NAME}</div>
                <div className="phone-owner">telemóvel de {owner.name.split(" ")[0]}</div>
              </div>
              <div className="phone-thread">
                {thread.length === 0 && <div className="phone-empty">sem mensagens ainda</div>}
                {thread.map(m => (
                  <div key={m.id} className={`bubble ${m.direction === "clinic-to-patient" ? "in" : "out"}`}>
                    <div className="bubble-body">{m.body}</div>
                    <div className="bubble-meta">{m.ts} · {m.channel}</div>
                  </div>
                ))}
              </div>
              {canRespond && (
                <div className="phone-actions">
                  <button className="btn-yes" onClick={onAcceptOffer}>Responder SIM</button>
                  <button className="btn-no"  onClick={onDeclineOffer}>Responder NÃO</button>
                  <div className="muted small">(o entrevistador escolhe pelo paciente)</div>
                </div>
              )}
            </>
          ) : (
            <div className="phone-idle">
              <div className="phone-idle-title">Telemóvel</div>
              <p className="muted">
                Quando o sistema falar com um paciente, a conversa aparece aqui.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// -----------------------------
// Scenes 2, 3, 4: follow-ups
// -----------------------------

function FollowUpScene({ kind }: { kind: "exam" | "postvisit" | "noshow" }) {
  const [sent,   setSent]   = useState(false);
  const [reply,  setReply]  = useState<"none" | "yes" | "no">("none");
  const [autoOfferSent, setAutoOfferSent] = useState(false);
  const [dateChosen,    setDateChosen]    = useState<string | null>(null);

  // A different patient for each scene so the demo isn't monotonous.
  const patient =
    kind === "exam"     ? patients["helena"] :
    kind === "postvisit" ? patients["tiago"] :
                          patients["bruno"];

  const trigger = (() => {
    switch (kind) {
      case "exam":     return { title: "O Dr. pediu uma ecografia — nada agendado.", detail: "Sem sistema, ninguém repara. Aqui, o intervalo tem dono." };
      case "postvisit": return { title: "Tiago saiu da consulta. Medicamento + próximo passo:", detail: "Resumo enviado automaticamente — o paciente não tem de decorar nada." };
      case "noshow":  return { title: "Não veio à consulta de ontem. Ninguém ligou.", detail: "Substitui a chamada difícil que ninguém quer fazer." };
    }
  })();

  const body = (() => {
    switch (kind) {
      case "exam":     return examFollowUp(patient.name, "uma ecografia abdominal");
      case "postvisit": return postVisitSummary(patient.name);
      case "noshow":  return noShowFollowUp(patient.name, "10 ago");
    }
  })();

  // Options 1-2 are slots the clinic offers. Option 3 is not a slot at all —
  // it's the patient naming their own day/time instead of picking from the list,
  // same free-form behaviour as the "reagendamento por conversa" scene.
  const autoOfferDates = ["qua 19 ago · 09:30", "qui 20 ago · 10:00", "dia 21 · 15:00"];
  // Same slot as autoOfferDates[2], phrased for a sentence instead of a compact label —
  // "·" reads fine in a timestamp, not inside something a person is meant to have typed.
  const patientRequestedSpoken = "dia 21 às 15:00";
  const autoOfferBody =
    "Temos estas vagas livres. Qual prefere?\n\n" +
    `1. ${autoOfferDates[0]}\n` +
    `2. ${autoOfferDates[1]}\n\n` +
    "Se nenhuma destas lhe der jeito, diga-me outro dia e hora.";

  const isPostvisit = kind === "postvisit";

  return (
    <main className="scene">
      <div className="stepbar">
        <div className="stepbar-explain">
          <strong>{trigger.title}</strong>
          <div className="muted">{trigger.detail}</div>
        </div>
        <div className="stepbar-actions">
          {!sent && <button className="btn-primary" onClick={() => setSent(true)}>Enviar mensagem</button>}
          {sent && !isPostvisit && reply === "none" && (
            <>
              <button className="btn-yes" onClick={() => setReply("yes")}>Paciente responde SIM</button>
              <button className="btn-no"  onClick={() => setReply("no")}>Paciente responde NÃO</button>
            </>
          )}
          {reply === "yes" && !autoOfferSent && (
            <button className="btn-primary" onClick={() => setAutoOfferSent(true)}>Marcar automaticamente</button>
          )}
          <button className="btn-ghost" onClick={() => { setSent(false); setReply("none"); setAutoOfferSent(false); setDateChosen(null); }}>↻ Recomeçar</button>
        </div>
      </div>

      <div className="split">
        <section className="panel clinic">
          <h2 className="panel-title">Contexto do paciente</h2>
          <div className="patient-card">
            <div><strong>{patient.name}</strong> · {patient.age} anos</div>
            <div className="muted">{patient.note}</div>
          </div>
          <div className="followup-status">
            <Line done={sent} label="Mensagem enviada" />
            {!isPostvisit && (
              <Line done={reply !== "none"} label={
                reply === "yes" ? "Respondeu que sim" :
                reply === "no"  ? "Respondeu que não — fica no seguimento passivo" :
                "A aguardar resposta"} />
            )}
            {reply === "yes" && (
              <Line done={autoOfferSent} label={
                dateChosen ? "Vaga escolhida" : "Sistema a sugerir datas"} />
            )}
          </div>
        </section>

        <PhoneFollowPanel
            sent={sent}
            body={body}
            reply={reply}
            autoOfferSent={autoOfferSent}
            autoOfferBody={autoOfferBody}
            autoOfferDates={autoOfferDates}
            patientRequestedSpoken={patientRequestedSpoken}
            dateChosen={dateChosen}
            onDateChoose={setDateChosen}
            patientName={patient.name.split(" ")[0]}
            isPostvisit={isPostvisit}
          />
        </div>
      </main>
  );
}

function PhoneFollowPanel({
  sent, body, reply, autoOfferSent, autoOfferBody, autoOfferDates, patientRequestedSpoken, dateChosen, onDateChoose, patientName, isPostvisit,
}: {
  sent: boolean; body: string; reply: "none" | "yes" | "no";
  autoOfferSent: boolean; autoOfferBody: string; autoOfferDates: string[]; patientRequestedSpoken: string; dateChosen: string | null;
  onDateChoose: (d: string) => void; patientName: string; isPostvisit: boolean;
}) {
  return (
    <div className="phone">
      <div className="phone-notch" />
      <div className="phone-screen">
        <div className="phone-header">
          <div className="phone-title">{CLINIC_NAME}</div>
          <div className="phone-owner">telemóvel de {patientName}</div>
        </div>
        <div className="phone-thread">
          {!sent && <div className="phone-empty">sem mensagens ainda</div>}
          {sent && (
            <div className="bubble in">
              <div className="bubble-body">{body}</div>
              <div className="bubble-meta">hoje · SMS</div>
            </div>
          )}
          {!isPostvisit && reply === "yes" && !autoOfferSent && (
            <div className="bubble out">
              <div className="bubble-body">Sim, obrigado.</div>
              <div className="bubble-meta">2 min depois</div>
            </div>
          )}
          {!isPostvisit && reply === "no" && (
            <div className="bubble out">
              <div className="bubble-body">Ainda não. Fica para depois.</div>
              <div className="bubble-meta">2 min depois</div>
            </div>
          )}
          {autoOfferSent && !dateChosen && (
            <div className="bubble in">
              <div className="bubble-body">{autoOfferBody}</div>
              <div className="bubble-meta">imediato · SMS</div>
            </div>
          )}
          {dateChosen && (
            <>
              <div className="bubble out">
                <div className="bubble-body">
                  {dateChosen === autoOfferDates[2]
                    ? `Nenhuma dessas me dá jeito. Pode ser ${patientRequestedSpoken}?`
                    : dateChosen}
                </div>
                <div className="bubble-meta">1 min depois</div>
              </div>
              <div className="bubble in">
                <div className="bubble-body">
                  {dateChosen === autoOfferDates[2]
                    ? `Perfeito — fica marcado para ${patientRequestedSpoken}. Até lá.`
                    : "Agendamento concluído. Até lá."}
                </div>
                <div className="bubble-meta">imediato</div>
              </div>
            </>
          )}
        </div>
        {autoOfferSent && !dateChosen && !isPostvisit && (
          <div className="phone-actions">
            {autoOfferDates.map((d, i) => (
              <button key={i} className="btn-yes" onClick={() => onDateChoose(d)}>
                {i < 2 ? `${i + 1}. ${d}` : `Paciente pede outra data: ${d}`}
              </button>
            ))}
            <div className="muted small">(o entrevistador escolhe pelo paciente)</div>
          </div>
        )}
      </div>
    </div>
  );
}

function Line({ done, label }: { done: boolean; label: string }) {
  return (
    <div className={`status-line ${done ? "done" : "pending"}`}>
      <span className="status-dot" />
      {label}
    </div>
  );
}

// -----------------------------
// Scene 5: reschedule by free-form conversation
// -----------------------------
// Deliberately NOT a numbered menu, unlike scenes 1-4 — this is the one that
// shows what the working prototype actually does differently: the patient
// writes normally, the system asks before it offers, and a named doctor
// preference sticks (continuity of care).

type RescheduleStage = "idle" | "asked" | "clarifying" | "preference" | "offered" | "booked";

function RescheduleScene() {
  const [stage, setStage] = useState<RescheduleStage>("idle");
  const [chosenTime, setChosenTime] = useState<string | null>(null);
  const patient = patients["marta"];
  const offerTimes = ["14:15", "16:30"];

  const explain = (): string => {
    switch (stage) {
      case "idle":       return "Marta tem consulta amanhã às 10:00 com o Dr. Sousa.";
      case "asked":      return "Pediu para remarcar — sem dizer para quando.";
      case "clarifying": return "O sistema não adivinha: pergunta que dia e altura do dia lhe dá jeito.";
      case "preference": return "Só agora, com uma preferência, é que faz sentido procurar vagas.";
      case "offered":    return "Ofereceu horários reais — com a médica que a Marta pediu, não uma qualquer.";
      case "booked":     return "Remarcada. A vaga de amanhã ficou livre e a cascata arranca sozinha (cenário 1).";
    }
  };

  const reset = () => { setStage("idle"); setChosenTime(null); };

  return (
    <main className="scene">
      <div className="stepbar">
        <div className="stepbar-explain">{explain()}</div>
        <div className="stepbar-actions">
          {stage === "idle"       && <button className="btn-primary" onClick={() => setStage("asked")}>Paciente pede para remarcar</button>}
          {stage === "asked"      && <button className="btn-primary" onClick={() => setStage("clarifying")}>Sistema pergunta que dia/hora prefere</button>}
          {stage === "clarifying" && <button className="btn-primary" onClick={() => setStage("preference")}>Paciente responde (pede a Dra. Lima)</button>}
          {stage === "preference" && <button className="btn-primary" onClick={() => setStage("offered")}>Sistema procura e oferece horários reais</button>}
          <button className="btn-ghost" onClick={reset}>↻ Recomeçar</button>
        </div>
      </div>

      <div className="split">
        <section className="panel clinic">
          <h2 className="panel-title">Ficha de {patient.name}</h2>
          <div className="patient-card">
            <div><strong>{patient.name}</strong> · {patient.age} anos</div>
            <div className="muted">{patient.note}</div>
          </div>
          <div className="followup-status">
            <Line done={stage !== "idle"} label="Pediu para remarcar" />
            <Line done={stage === "preference" || stage === "offered" || stage === "booked"} label="Deu uma preferência (dia/hora/médico)" />
            <Line done={stage === "offered" || stage === "booked"} label="Sistema encontrou vagas reais" />
            <Line done={stage === "booked"} label={stage === "booked" ? `Médico habitual: Dr. Sousa → ${DOCTOR2_NAME} (pedido explícito)` : "Confirmação"} />
          </div>
        </section>

        <div className="phone">
          <div className="phone-notch" />
          <div className="phone-screen">
            <div className="phone-header">
              <div className="phone-title">{CLINIC_NAME}</div>
              <div className="phone-owner">telemóvel de {patient.name.split(" ")[0]}</div>
            </div>
            <div className="phone-thread">
              {stage === "idle" && <div className="phone-empty">sem mensagens ainda</div>}
              {stage !== "idle" && (
                <div className="bubble out">
                  <div className="bubble-body">Preciso de remarcar a consulta de amanhã, não vou conseguir ir.</div>
                  <div className="bubble-meta">agora · SMS</div>
                </div>
              )}
              {(stage === "clarifying" || stage === "preference" || stage === "offered" || stage === "booked") && (
                <div className="bubble in">
                  <div className="bubble-body">{clarifyPreference(patient.name)}</div>
                  <div className="bubble-meta">imediato · SMS</div>
                </div>
              )}
              {(stage === "preference" || stage === "offered" || stage === "booked") && (
                <div className="bubble out">
                  <div className="bubble-body">Depois de amanhã à tarde, se puder ser com a Dra. Lima.</div>
                  <div className="bubble-meta">1 min depois</div>
                </div>
              )}
              {(stage === "offered" || stage === "booked") && (
                <div className="bubble in">
                  <div className="bubble-body">{rescheduleOffer("Depois de amanhã à tarde", offerTimes, DOCTOR2_NAME)}</div>
                  <div className="bubble-meta">imediato · SMS</div>
                </div>
              )}
              {stage === "booked" && chosenTime && (
                <>
                  <div className="bubble out">
                    <div className="bubble-body">Fica a das {chosenTime}, obrigada.</div>
                    <div className="bubble-meta">1 min depois</div>
                  </div>
                  <div className="bubble in">
                    <div className="bubble-body">{rescheduleConfirm("depois de amanhã", chosenTime, DOCTOR2_NAME, "10:00")}</div>
                    <div className="bubble-meta">imediato</div>
                  </div>
                </>
              )}
            </div>
            {stage === "offered" && (
              <div className="phone-actions">
                {offerTimes.map(t => (
                  <button key={t} className="btn-yes" onClick={() => { setChosenTime(t); setStage("booked"); }}>{t}</button>
                ))}
                <div className="muted small">(o entrevistador escolhe pela paciente)</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

// -----------------------------
// Scene 6: cancel request — resist, then comply
// -----------------------------
// The system never cancels on the first ask. It offers to reschedule first;
// only cancels outright if the patient insists. Answers the question every
// clinic owner asks: "doesn't this just make it easier for people to bail?"

type CancelStage = "idle" | "asked" | "nudged" | "cancelled" | "reconsidered" | "offered2" | "rebooked";

function CancelScene() {
  const [stage, setStage] = useState<CancelStage>("idle");
  const [chosenTime, setChosenTime] = useState<string | null>(null);
  const patient = patients["ricardo"];
  const altTimes = ["09:30", "11:45"];

  const explain = (): string => {
    switch (stage) {
      case "idle":         return "Ricardo tem consulta marcada para sexta às 15:30.";
      case "asked":        return "Pediu para cancelar.";
      case "nudged":       return "O sistema não cancela logo — pergunta se prefere remarcar.";
      case "cancelled":    return "Insistiu. Cancelado — mas a vaga liberta-se e a cascata arranca sozinha.";
      case "reconsidered": return "Mudou de ideias — quer tentar remarcar em vez de cancelar.";
      case "offered2":     return "Sistema oferece horários reais para a semana seguinte.";
      case "rebooked":     return "Remarcado. Zero pacientes perdidos por não perguntar duas vezes.";
    }
  };

  const reset = () => { setStage("idle"); setChosenTime(null); };

  return (
    <main className="scene">
      <div className="stepbar">
        <div className="stepbar-explain">{explain()}</div>
        <div className="stepbar-actions">
          {stage === "idle"  && <button className="btn-primary" onClick={() => setStage("asked")}>Paciente pede para cancelar</button>}
          {stage === "asked" && <button className="btn-primary" onClick={() => setStage("nudged")}>Sistema pergunta: remarcar em vez de cancelar?</button>}
          {stage === "nudged" && (
            <>
              <button className="btn-no" onClick={() => setStage("cancelled")}>Paciente insiste — cancelar mesmo</button>
              <button className="btn-yes" onClick={() => setStage("reconsidered")}>Paciente reconsidera — quer remarcar</button>
            </>
          )}
          {stage === "reconsidered" && <button className="btn-primary" onClick={() => setStage("offered2")}>Sistema oferece horários alternativos</button>}
          <button className="btn-ghost" onClick={reset}>↻ Recomeçar</button>
        </div>
      </div>

      <div className="split">
        <section className="panel clinic">
          <h2 className="panel-title">Ficha de {patient.name}</h2>
          <div className="patient-card">
            <div><strong>{patient.name}</strong> · {patient.age} anos</div>
            <div className="muted">{patient.note}</div>
          </div>
          <div className="followup-status">
            <Line done={stage !== "idle"} label="Pediu para cancelar" />
            <Line done={stage !== "idle" && stage !== "asked"} label="Sistema perguntou se preferia remarcar" />
            <Line done={stage === "cancelled"} label={stage === "cancelled" ? "Cancelado — vaga liberta, cascata a correr" : "Ainda não cancelado"} />
            <Line done={stage === "rebooked"} label={stage === "rebooked" ? "Remarcado — nada perdido" : "Ainda por resolver"} />
          </div>
        </section>

        <div className="phone">
          <div className="phone-notch" />
          <div className="phone-screen">
            <div className="phone-header">
              <div className="phone-title">{CLINIC_NAME}</div>
              <div className="phone-owner">telemóvel de {patient.name.split(" ")[0]}</div>
            </div>
            <div className="phone-thread">
              {stage === "idle" && <div className="phone-empty">sem mensagens ainda</div>}
              {stage !== "idle" && (
                <div className="bubble out">
                  <div className="bubble-body">Quero cancelar a consulta de sexta às 15:30, já não vou poder ir.</div>
                  <div className="bubble-meta">agora · SMS</div>
                </div>
              )}
              {stage !== "idle" && stage !== "asked" && (
                <div className="bubble in">
                  <div className="bubble-body">{cancelNudge()}</div>
                  <div className="bubble-meta">imediato · SMS</div>
                </div>
              )}
              {stage === "cancelled" && (
                <>
                  <div className="bubble out">
                    <div className="bubble-body">Não, obrigado. É para cancelar mesmo.</div>
                    <div className="bubble-meta">1 min depois</div>
                  </div>
                  <div className="bubble in">
                    <div className="bubble-body">{cancelConfirmed()}</div>
                    <div className="bubble-meta">imediato</div>
                  </div>
                </>
              )}
              {(stage === "reconsidered" || stage === "offered2" || stage === "rebooked") && (
                <div className="bubble out">
                  <div className="bubble-body">Se calhar sim... vamos tentar remarcar.</div>
                  <div className="bubble-meta">1 min depois</div>
                </div>
              )}
              {(stage === "offered2" || stage === "rebooked") && (
                <div className="bubble in">
                  <div className="bubble-body">{rescheduleAltOffer(altTimes)}</div>
                  <div className="bubble-meta">imediato · SMS</div>
                </div>
              )}
              {stage === "rebooked" && chosenTime && (
                <>
                  <div className="bubble out">
                    <div className="bubble-body">Fica a das {chosenTime}.</div>
                    <div className="bubble-meta">1 min depois</div>
                  </div>
                  <div className="bubble in">
                    <div className="bubble-body">{rescheduleAltConfirm(chosenTime)}</div>
                    <div className="bubble-meta">imediato</div>
                  </div>
                </>
              )}
            </div>
            {stage === "offered2" && (
              <div className="phone-actions">
                {altTimes.map(t => (
                  <button key={t} className="btn-yes" onClick={() => { setChosenTime(t); setStage("rebooked"); }}>{t}</button>
                ))}
                <div className="muted small">(o entrevistador escolhe pelo paciente)</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

// -----------------------------
// Scene 7: clinical question — escalate, never answer
// -----------------------------
// "Na dúvida, escala": the one hard rule with no exceptions. This is the
// answer to "what if the AI says something wrong to a patient?"

type EscalationStage = "idle" | "asked" | "escalated";

function EscalationScene() {
  const [stage, setStage] = useState<EscalationStage>("idle");
  const patient = patients["sofia"];

  const explain = (): string => {
    switch (stage) {
      case "idle":      return "Sofia esteve na consulta a semana passada.";
      case "asked":     return "Fez uma pergunta clínica — não uma de agenda.";
      case "escalated": return "O sistema não arrisca uma resposta clínica. Encaminha para uma pessoa e regista.";
    }
  };

  const reset = () => setStage("idle");

  return (
    <main className="scene">
      <div className="stepbar">
        <div className="stepbar-explain">{explain()}</div>
        <div className="stepbar-actions">
          {stage === "idle"  && <button className="btn-primary" onClick={() => setStage("asked")}>Paciente faz uma pergunta clínica</button>}
          {stage === "asked" && <button className="btn-primary" onClick={() => setStage("escalated")}>Sistema não arrisca — encaminha para a equipa</button>}
          <button className="btn-ghost" onClick={reset}>↻ Recomeçar</button>
        </div>
      </div>

      <div className="split">
        <section className="panel clinic">
          <h2 className="panel-title">Fila de escalonamento</h2>
          <div className="panel-sub">Para onde vão as perguntas que a IA não deve responder sozinha.</div>
          {stage !== "escalated" && <div className="muted">Vazia — nada à espera.</div>}
          {stage === "escalated" && (
            <div className="patient-card escalation-card">
              <div><strong>{patient.name}</strong> · questão médica</div>
              <div className="muted small">prioridade alta · agora mesmo</div>
              <div className="muted small">"Posso baixar a dose...?" — a IA não respondeu; passou para a equipa.</div>
            </div>
          )}
        </section>

        <div className="phone">
          <div className="phone-notch" />
          <div className="phone-screen">
            <div className="phone-header">
              <div className="phone-title">{CLINIC_NAME}</div>
              <div className="phone-owner">telemóvel de {patient.name.split(" ")[0]}</div>
            </div>
            <div className="phone-thread">
              {stage === "idle" && <div className="phone-empty">sem mensagens ainda</div>}
              {stage !== "idle" && (
                <div className="bubble out">
                  <div className="bubble-body">Posso baixar a dose do que o médico me passou? Estou com efeitos secundários bastante fortes.</div>
                  <div className="bubble-meta">agora · SMS</div>
                </div>
              )}
              {stage === "escalated" && (
                <div className="bubble in">
                  <div className="bubble-body">{escalationReply()}</div>
                  <div className="bubble-meta">imediato · SMS</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

// -----------------------------
// Scene 8: booking — patient-initiated, no prior relationship
// -----------------------------
// The other scenes are all the clinic/agent reaching out first. This is the
// other pillar of the product: a stranger texts in cold and books herself,
// no phone call, no reception — nothing gets displaced, nothing to free up.

type BookingStage = "idle" | "asked" | "clarifying" | "preference" | "offered" | "booked";
type DoctorSlot = { time: string; doctor: string };

function BookingScene() {
  const [stage, setStage] = useState<BookingStage>("idle");
  const [chosen, setChosen] = useState<DoctorSlot | null>(null);
  const patient = patients["filipa"];
  const offers: DoctorSlot[] = [
    { time: "09:00", doctor: DOCTOR3_NAME },
    { time: "10:30", doctor: "Dr. Sousa" },
    { time: "11:15", doctor: DOCTOR2_NAME },
  ];

  const explain = (): string => {
    switch (stage) {
      case "idle":       return "Filipa nunca teve consulta aqui — contacto novo.";
      case "asked":      return "Escreveu pela primeira vez, sem ninguém lhe ligar.";
      case "clarifying": return "O sistema não empurra horários — pergunta o que lhe dá jeito.";
      case "preference": return "Só agora, com uma preferência, faz sentido procurar vagas.";
      case "offered":    return "Horários reais, com médicos diferentes — não o mesmo três vezes.";
      case "booked":     return "Marcada. Sem telefonar, sem falar com a receção — a outra metade do produto.";
    }
  };

  const reset = () => { setStage("idle"); setChosen(null); };

  return (
    <main className="scene">
      <div className="stepbar">
        <div className="stepbar-explain">{explain()}</div>
        <div className="stepbar-actions">
          {stage === "idle"       && <button className="btn-primary" onClick={() => setStage("asked")}>Paciente escreve pela primeira vez</button>}
          {stage === "asked"      && <button className="btn-primary" onClick={() => setStage("clarifying")}>Sistema pergunta que dia/hora prefere</button>}
          {stage === "clarifying" && <button className="btn-primary" onClick={() => setStage("preference")}>Paciente responde "terça de manhã"</button>}
          {stage === "preference" && <button className="btn-primary" onClick={() => setStage("offered")}>Sistema procura e oferece horários reais</button>}
          <button className="btn-ghost" onClick={reset}>↻ Recomeçar</button>
        </div>
      </div>

      <div className="split">
        <section className="panel clinic">
          <h2 className="panel-title">Ficha de {patient.name}</h2>
          <div className="patient-card">
            <div><strong>{patient.name}</strong> · {patient.age} anos</div>
            <div className="muted">{patient.note}</div>
          </div>
          <div className="followup-status">
            <Line done={stage !== "idle"} label="Primeiro contacto recebido" />
            <Line done={stage === "preference" || stage === "offered" || stage === "booked"} label="Deu uma preferência (dia/período)" />
            <Line done={stage === "offered" || stage === "booked"} label="Sistema encontrou vagas reais" />
            <Line done={stage === "booked"} label={stage === "booked" ? `Marcada — ${chosen?.time} com ${chosen?.doctor}` : "Confirmação"} />
          </div>
        </section>

        <div className="phone">
          <div className="phone-notch" />
          <div className="phone-screen">
            <div className="phone-header">
              <div className="phone-title">{CLINIC_NAME}</div>
              <div className="phone-owner">telemóvel de {patient.name.split(" ")[0]}</div>
            </div>
            <div className="phone-thread">
              {stage === "idle" && <div className="phone-empty">sem mensagens ainda</div>}
              {stage !== "idle" && (
                <div className="bubble out">
                  <div className="bubble-body">Olá, gostaria de marcar uma consulta.</div>
                  <div className="bubble-meta">agora · SMS</div>
                </div>
              )}
              {(stage === "clarifying" || stage === "preference" || stage === "offered" || stage === "booked") && (
                <div className="bubble in">
                  <div className="bubble-body">Que dia e que altura do dia lhe dá mais jeito?</div>
                  <div className="bubble-meta">imediato · SMS</div>
                </div>
              )}
              {(stage === "preference" || stage === "offered" || stage === "booked") && (
                <div className="bubble out">
                  <div className="bubble-body">Terça de manhã, se possível.</div>
                  <div className="bubble-meta">1 min depois</div>
                </div>
              )}
              {(stage === "offered" || stage === "booked") && (
                <div className="bubble in">
                  <div className="bubble-body">
                    Nesse caso tenho terça às {offers[0].time} com o {offers[0].doctor}, às {offers[1].time} com o {offers[1].doctor} ou às {offers[2].time} com a {offers[2].doctor} — qual prefere?
                  </div>
                  <div className="bubble-meta">imediato · SMS</div>
                </div>
              )}
              {stage === "booked" && chosen && (
                <>
                  <div className="bubble out">
                    <div className="bubble-body">A das {chosen.time}, obrigada.</div>
                    <div className="bubble-meta">1 min depois</div>
                  </div>
                  <div className="bubble in">
                    <div className="bubble-body">Perfeito! Fica marcado para terça às {chosen.time} com {chosen.doctor === DOCTOR2_NAME ? "a" : "o"} {chosen.doctor}. Até lá!</div>
                    <div className="bubble-meta">imediato</div>
                  </div>
                </>
              )}
            </div>
            {stage === "offered" && (
              <div className="phone-actions">
                {offers.map(o => (
                  <button key={o.time} className="btn-yes" onClick={() => { setChosen(o); setStage("booked"); }}>
                    {o.time} · {o.doctor}
                  </button>
                ))}
                <div className="muted small">(o entrevistador escolhe pela paciente)</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

// -----------------------------
// Footer
// -----------------------------

function Footer() {
  return (
    <footer className="footer">
      <div>Sprint 4 · protótipo clicável · dados fictícios</div>
      <div className="muted">Equipa 4 — Mariana Lins + Vasco Campos</div>
    </footer>
  );
}
