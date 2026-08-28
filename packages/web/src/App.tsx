// The GP-facing screen.
//
// Criteria entry is chips and selects only. There is no free-text clinical field anywhere on
// this page and there must never be one: the moment a referrer can type what is wrong with the
// patient, the software is being asked to interpret it.
//
// DEV NOTE. This build reads the seeded synthetic fixture set directly from `@referral/core`.
// The signed-bundle download, signature check and IndexedDB cache land with `packages/bundle`;
// until then the banner says plainly that these are invented records.

import { useMemo, useState } from "react";
import {
  CATEGORY_COPY,
  FIXTURE_POSTCODE_CENTROIDS,
  PAYER_COPY,
  PAYER_KEYS,
  REFERRAL_CATEGORIES,
  REGION_COPY,
  SUBSPECIALTY_COPY,
  ANATOMICAL_REGIONS,
  displayName,
  makeFixtureSurgeons,
  rankByCriteria,
  type AnatomicalRegion,
  type Criteria,
  type PayerKey,
  type ReferralCategory,
} from "@referral/core";
import { Fact } from "./access-view";

const NOW = new Date();
const SURGEONS = makeFixtureSurgeons({ count: 50 });
const FUNDS = ["HCF", "Bupa", "Medibank", "NIB", "AHM", "HBF"];

const TIER_TITLE: Record<string, string> = {
  A: "Verified registry or sub-specialty society membership",
  B: "Inferred from publications, credentialing or booking data",
  C: "Self-described on a practice website",
  S: "Self-reported by the practice through our portal",
};

export function App() {
  const [criteria, setCriteria] = useState<Criteria>({
    region: "knee",
    category: "sports_soft_tissue",
    payer: "workcover",
    postcode: "3000",
    maxTravelKm: 25,
    sector: "either",
    fund: null,
  });

  const set = <K extends keyof Criteria>(key: K, value: Criteria[K]) =>
    setCriteria((c) => ({ ...c, [key]: value }));

  const origin = FIXTURE_POSTCODE_CENTROIDS[criteria.postcode];
  const results = useMemo(
    () => rankByCriteria(SURGEONS, criteria, origin ? { origin } : {}, NOW),
    [criteria, origin],
  );

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">R</div>
          <div>
            <div className="brand-name">Referral support</div>
            <div className="brand-sub">Orthopaedic surgery · VIC</div>
          </div>
        </div>

        <div className="field">
          <label className="label" htmlFor="region">Anatomical region</label>
          <select
            id="region"
            value={criteria.region}
            onChange={(e) => set("region", e.target.value as AnatomicalRegion)}
          >
            {ANATOMICAL_REGIONS.map((r) => (
              <option key={r} value={r}>{REGION_COPY[r]}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <span className="label">Category</span>
          <div className="chips">
            {REFERRAL_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                className="chip"
                aria-pressed={criteria.category === c}
                onClick={() => set("category", c as ReferralCategory)}
              >
                {CATEGORY_COPY[c]}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="label">Payer</span>
          <div className="chips">
            <button
              type="button"
              className="chip"
              aria-pressed={criteria.payer === null}
              onClick={() => set("payer", null)}
            >
              Any
            </button>
            {PAYER_KEYS.map((p) => (
              <button
                key={p}
                type="button"
                className="chip"
                aria-pressed={criteria.payer === p}
                onClick={() => set("payer", p as PayerKey)}
              >
                {PAYER_COPY[p]}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="label" htmlFor="fund">No-gap fund</label>
          <select
            id="fund"
            value={criteria.fund ?? ""}
            onChange={(e) => set("fund", e.target.value === "" ? null : e.target.value)}
          >
            <option value="">Any fund</option>
            {FUNDS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <span className="label">Sector</span>
          <div className="segmented">
            {(["either", "public", "private"] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={criteria.sector === s}
                onClick={() => set("sector", s)}
              >
                {s === "either" ? "Any" : s === "public" ? "Public" : "Private"}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="label" htmlFor="postcode">Patient postcode</label>
          <input
            id="postcode"
            type="text"
            inputMode="numeric"
            maxLength={4}
            value={criteria.postcode}
            onChange={(e) => set("postcode", e.target.value.replace(/\D/g, "").slice(0, 4))}
          />
          {!origin && (
            <div className="range-row">
              <span>Postcode not in the fixture gazetteer — distance not ranked.</span>
            </div>
          )}
        </div>

        <div className="field">
          <label className="label" htmlFor="travel">Maximum travel</label>
          <input
            id="travel"
            type="range"
            min={5}
            max={150}
            step={5}
            value={criteria.maxTravelKm}
            onChange={(e) => set("maxTravelKm", Number(e.target.value))}
          />
          <div className="range-row">
            <span>{criteria.maxTravelKm} km</span>
            <span>150 km</span>
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="page-head">
          <div>
            <h1 className="page-title">Surgeons matching your criteria</h1>
            <p className="page-sub">
              Filtered and ranked on the criteria selected on the left. Every factor that moved a
              surgeon's position is listed under their entry.
            </p>
          </div>
          <div className="count">
            {results.length} of {SURGEONS.length}
          </div>
        </div>

        <div className="notice">
          <div>
            <b>Development data.</b> These are seeded synthetic records, not real practitioners.
            Matching runs entirely in this browser — no criteria are sent anywhere.
          </div>
        </div>

        {results.length === 0 ? (
          <div className="empty">
            No surgeon in the directory matches these criteria.
            <br />
            Widen the travel radius, or set the payer to Any.
          </div>
        ) : (
          <div className="cards">
            {results.map((result, index) => (
              <article className="card" key={result.surgeon.ahpraId}>
                <div className="card-head">
                  <div className="rank">{index + 1}</div>
                  <div className="who">
                    <div className="name">{displayName(result.surgeon)}</div>
                    <div className="sub">
                      {result.surgeon.specialistRegistration.specialty} · specialist since{" "}
                      {result.surgeon.specialistRegistration.since.slice(0, 4)}
                      {result.nearestLocation && (
                        <>
                          {" · "}
                          {result.nearestLocation.name}, {result.nearestLocation.suburb}
                          {result.distanceKm !== null && ` · ${result.distanceKm} km`}
                        </>
                      )}
                    </div>
                    {result.surgeon.subspecialtyTags.length > 0 ? (
                      <div className="tags">
                        {result.surgeon.subspecialtyTags.map((tag) => (
                          <span className="tag" key={tag.bucket} title={TIER_TITLE[tag.tier]}>
                            <span className={`tier tier-${tag.tier}`}>{tag.tier}</span>
                            {SUBSPECIALTY_COPY[tag.bucket]}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="tags">
                        <span className="tag">
                          <span className="tier tier-C">—</span>
                          No sub-specialty confirmed
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="divider" />

                <div className="grid-2">
                  <div>
                    <div className="block-label">Access</div>
                    <div className="facts">
                      <Fact recordKey="booksOpen" record={result.surgeon.access} now={NOW} />
                      <Fact recordKey="waitToConsultDays" record={result.surgeon.access} now={NOW} />
                      <Fact recordKey="waitToSurgeryDays" record={result.surgeon.access} now={NOW} />
                      <Fact recordKey="bulkBillsInitial" record={result.surgeon.access} now={NOW} />
                    </div>
                  </div>
                  <div>
                    <div className="block-label">Payers &amp; funds</div>
                    <div className="facts">
                      {PAYER_KEYS.map((p) => (
                        <Fact key={p} recordKey={p} record={result.surgeon.access} now={NOW} />
                      ))}
                      <Fact recordKey="noGapFunds" record={result.surgeon.access} now={NOW} />
                    </div>
                  </div>
                </div>

                <div className="divider" />

                <div className="block-label">Why this position</div>
                <ul className="reasons">
                  {result.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        )}

        <footer className="footer">
          This tool filters a directory according to criteria you select. It does not provide
          clinical advice, and the referral decision remains yours.
        </footer>
      </main>
    </div>
  );
}
