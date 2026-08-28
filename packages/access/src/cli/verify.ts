// `pnpm access` — the phone verification CLI.
//
// One surgeon at a time, in queue order, prompting only for what is stale or unknown. It opens
// with volume coverage rather than a headcount, because that is the number that says when to
// stop calling.

import { createInterface } from "node:readline/promises";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { displayName, makeFixtureSurgeons, type AccessFieldKey, type Surgeon } from "@referral/core";
import { buildCallQueue } from "../call-queue";
import { withReferralWeights } from "../referral-weight";
import { CallRecordSchema, historyIndex, type CallRecord } from "../call-log";
import { applyPatch, buildPatch, parseAnswer, promptFor, type Answer } from "../verification";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const REVIEWED = join(ROOT, "data", "reviewed");
const PATCHES = join(REVIEWED, "access-patches.ndjson");
const CALLS = join(REVIEWED, "call-log.ndjson");

// Melbourne CBD. The launch metro.
const MELBOURNE = { lat: -37.8136, lng: 144.9631, radiusKm: 45 };
const TARGET_COVERAGE = 0.7;

function readNdjson<T>(path: string): T[] {
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as T);
  } catch {
    return [];
  }
}

function appendNdjson(path: string, row: unknown): void {
  mkdirSync(REVIEWED, { recursive: true });
  writeFileSync(path, `${JSON.stringify(row)}\n`, { flag: "a" });
}

const now = new Date();
const today = now.toISOString().slice(0, 10);
const caller = process.env["USER"] ?? "caller";

// Until the bundle pipeline feeds this, the directory is the synthetic fixture set.
const surgeons: Surgeon[] = withReferralWeights(makeFixtureSurgeons({ count: 50 }), now);
const calls = readNdjson<CallRecord>(CALLS).map((c) => CallRecordSchema.parse(c));

const queue = buildCallQueue(surgeons, now, {
  metro: MELBOURNE,
  callHistory: historyIndex(calls),
  targetVolumeCoverage: TARGET_COVERAGE,
});

const rl = createInterface({ input: process.stdin, output: process.stdout });

console.log("");
console.log("  Access verification — Melbourne");
console.log("  ────────────────────────────────────────────────────────");
console.log(`  In scope             ${queue.coverageNow.surgeonsInScope} surgeons`);
console.log(`  Referral volume covered now      ${queue.coverageNow.volumeCoveragePct}%`);
console.log(`  Calls to reach ${TARGET_COVERAGE * 100}%              ${queue.callsToTarget ?? "not reachable from this queue"}`);
console.log(`  Resting (refused / no answer)    ${queue.suppressed.length}`);
console.log("");

let called = 0;
for (const entry of queue.entries) {
  const surgeon = entry.surgeon;
  console.log(`  ${displayName(surgeon)}  [${surgeon.ahpraId}]`);
  console.log(`  weight ${entry.referralWeight.toFixed(2)} · urgency ${entry.urgency.toFixed(2)} · ${entry.fieldsToAsk.length} fields to ask`);
  console.log(`  ${surgeon.locations[0]?.name ?? "no rooms listed"}`);
  console.log("");

  const outcome = (await rl.question("  outcome [r]eached / re[f]used / [n]o answer / [w]rong number / [s]kip / [q]uit: ")).trim().toLowerCase();
  if (outcome === "q") break;

  const map: Record<string, CallRecord["outcome"]> = { r: "reached", f: "refused", n: "no-answer", w: "wrong-number" };
  if (outcome !== "s") {
    const resolved = map[outcome];
    if (resolved) {
      appendNdjson(CALLS, CallRecordSchema.parse({ ahpraId: surgeon.ahpraId, outcome: resolved, at: today, note: null, callbackOn: null }));
      called += 1;
      if (resolved !== "reached") {
        console.log("  logged; moving on\n");
        continue;
      }
    } else {
      console.log("  not understood; skipping\n");
      continue;
    }
  } else {
    console.log("");
    continue;
  }

  const answers = new Map<AccessFieldKey, Answer>();
  for (const key of entry.fieldsToAsk) {
    const prompt = promptFor(key, surgeon.access, now);
    for (;;) {
      const raw = await rl.question(`    ${prompt.label.padEnd(24)} (${prompt.current})  ${prompt.hint}\n    > `);
      const parsed = parseAnswer(prompt.kind, raw);
      if (parsed.kind === "invalid") {
        console.log(`    ${parsed.message}`);
        continue;
      }
      answers.set(key, parsed);
      break;
    }
  }

  const patch = buildPatch(surgeon.ahpraId, answers, { at: today, by: caller });
  if (Object.keys(patch.fields).length > 0) {
    appendNdjson(PATCHES, patch);
    console.log(`  saved ${Object.keys(patch.fields).length} fields\n`);
  } else {
    console.log("  nothing answered\n");
  }
  void applyPatch(surgeon, patch);
}

rl.close();
console.log(`  ${called} calls logged this session.`);
