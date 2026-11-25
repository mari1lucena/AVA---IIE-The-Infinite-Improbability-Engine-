// Sanity check for the cascade's accounting, mirroring the logic in App.tsx.
// Guards the one claim a clinic owner will actually interrogate:
// "you didn't recover a slot, you just moved the hole."
// Run: node verify-demo.mjs

const AVG_CONSULT = 65;

const cascade = [
  { id: "paulo",  origin: { kind: "sameDayLater",  time: "18:00" } },
  { id: "celia",  origin: { kind: "futureBooking", date: "26 ago" } },
  { id: "helena", origin: { kind: "waitingList" } },
];

// Walk the cascade given a list of answers; return final accounting.
function run(answers) {
  let slots = [
    { time: "15:00", who: "ana",   status: "confirmed" },
    { time: "16:00", who: "joao",  status: "confirmed" },
    { time: "17:00", who: "rita",  status: "confirmed" },
    { time: "18:00", who: "paulo", status: "confirmed" },
  ];
  // Rita cancels
  slots = slots.map(s => s.time === "17:00" ? { ...s, who: null, status: "cancelled" } : s);

  let recovered = 0, revenue = 0, target = "17:00", step = 0;

  for (const accepted of answers) {
    const cand = cascade[step];
    if (!cand) break;
    if (accepted) {
      slots = slots.map(s => s.time === target ? { ...s, who: cand.id, status: "refilled" } : s);
      if (cand.origin.kind === "sameDayLater") {
        // they vacate their old slot: hole moves, nothing recovered
        slots = slots.map(s =>
          s.time === cand.origin.time && s.who === cand.id ? { ...s, who: null, status: "empty" } : s);
        target = cand.origin.time;
      } else {
        recovered += 1;
        revenue += AVG_CONSULT;
        break; // filled from outside the day; cascade ends
      }
    }
    step += 1;
  }

  const emptyCount = slots.filter(s => !s.who).length;
  const booked = slots.filter(s => s.who).length;
  return { recovered, revenue, emptyCount, booked, slots };
}

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) { console.log(`  ok   ${name}`); }
  else { console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); failures++; }
};

console.log("\nScenario A — Paulo moves up, Célia takes the freed 18:00 (the happy path):");
{
  const r = run([true, true]);
  check("exactly 1 slot counted as recovered", r.recovered === 1, `got ${r.recovered}`);
  check("revenue = one consultation", r.revenue === AVG_CONSULT, `got ${r.revenue}`);
  check("day ends with 0 empty slots", r.emptyCount === 0, `got ${r.emptyCount}`);
  check("4 slots booked", r.booked === 4, `got ${r.booked}`);
}

console.log("\nScenario B — Paulo moves up, then everyone else refuses:");
{
  const r = run([true, false, false]);
  check("nothing counted as recovered", r.recovered === 0, `got ${r.recovered}`);
  check("still 1 empty slot at end of day", r.emptyCount === 1, `got ${r.emptyCount}`);
  check("the hole moved to 18:00", !r.slots.find(s => s.time === "18:00").who);
  check("17:00 is filled by Paulo", r.slots.find(s => s.time === "17:00").who === "paulo");
}

console.log("\nScenario C — Paulo refuses, Célia accepts from a future booking:");
{
  const r = run([false, true]);
  check("1 slot recovered", r.recovered === 1, `got ${r.recovered}`);
  check("0 empty slots", r.emptyCount === 0, `got ${r.emptyCount}`);
  check("Paulo keeps his 18:00", r.slots.find(s => s.time === "18:00").who === "paulo");
}

console.log("\nScenario D — nobody accepts (the honest failure case):");
{
  const r = run([false, false, false]);
  check("nothing recovered", r.recovered === 0, `got ${r.recovered}`);
  check("the 17:00 stays empty", r.emptyCount === 1, `got ${r.emptyCount}`);
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
