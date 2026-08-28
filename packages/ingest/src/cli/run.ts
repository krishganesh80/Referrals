// `pnpm ingest` — run every cleared identity adapter and report what came back.
//
// Nothing here decides whether a source may be fetched. Clearance comes from the committed
// register in data/reviewed/source-clearance.json, and the runner refuses the batch if anything
// in it is uncleared. Snapshots land in data/raw, which is gitignored.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { displayName } from "@referral/core";
import { FetchPolicy, type HttpResponse } from "../fetch-policy";
import { applyClearances, parseClearanceRegister } from "../clearance";
import { contentHash, runAdapters } from "../runner";
import { reconcile } from "../reconcile";
import { ahssDirectoryAdapter } from "../adapters/ahss";
import type { RawSnapshot } from "../types";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const RAW = join(ROOT, "data", "raw");
const REGISTER = join(ROOT, "data", "reviewed", "source-clearance.json");
const CONTACT = "krishganesh80@gmail.com";

mkdirSync(RAW, { recursive: true });

const policy = new FetchPolicy(
  {
    httpGet: async (url, headers): Promise<HttpResponse> => {
      const response = await fetch(url, { headers, redirect: "follow" });
      return { status: response.status, body: await response.text() };
    },
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    readSnapshot: async (adapterId) => {
      try {
        return JSON.parse(readFileSync(join(RAW, `${adapterId}.json`), "utf8")) as RawSnapshot;
      } catch {
        return null;
      }
    },
    writeSnapshot: async (snapshot) => {
      writeFileSync(join(RAW, `${snapshot.adapterId}.json`), JSON.stringify(snapshot, null, 2));
    },
    hash: contentHash,
  },
  { contactEmail: CONTACT, productName: "ReferralSupportBot", productUrl: "https://github.com/krishganesh80/Referrals" },
);

const register = parseClearanceRegister(JSON.parse(readFileSync(REGISTER, "utf8")));
const adapters = applyClearances([ahssDirectoryAdapter(policy)], register);

console.log("clearance register:");
for (const adapter of adapters) {
  console.log(`  ${adapter.id.padEnd(24)} ${adapter.legalStatus}`);
}
console.log();

const report = await runAdapters(adapters, { skipUncleared: true });
console.log(`ran: ${report.ran.join(", ") || "(nothing)"}`);
if (report.refused.length) console.log(`refused: ${report.refused.map((r) => `${r.adapterId} (${r.legalStatus})`).join(", ")}`);
if (report.failures.length) console.log(`failures: ${report.failures.map((f) => `${f.adapterId}: ${f.message}`).join("; ")}`);
console.log(`records parsed: ${report.records.length}`);
console.log();

const { surgeons, review } = reconcile([], report.records, { today: new Date().toISOString().slice(0, 10) });
console.log(`surgeons created: ${surgeons.length}`);
console.log(`review queue:     ${review.length}`);
const byKind = new Map<string, number>();
for (const item of review) byKind.set(item.kind, (byKind.get(item.kind) ?? 0) + 1);
for (const [kind, count] of byKind) console.log(`  ${kind.padEnd(16)} ${count}`);
console.log();

console.log("first 8 records, as they left the parser:");
for (const record of report.records.slice(0, 8)) {
  const { partial } = record;
  console.log(
    `  ${(partial.givenNames + " " + partial.familyName).padEnd(28)} ` +
      `ahpra=${partial.ahpraId ?? "null"}  postcode=${partial.postcodeHint ?? "-"}  ` +
      `tier=${record.tier}  ${partial.tags.map((t) => t.bucket).join(",")}`,
  );
}
if (surgeons.length > 0) console.log(`\nexample created surgeon: ${displayName(surgeons[0]!)}`);
