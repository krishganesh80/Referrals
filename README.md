# Referrals

Referral support for Australian GPs, starting with orthopaedic surgery.

A GP selects an anatomical region, a broad category, a payer type and a location. The tool
returns a ranked list of orthopaedic surgeons matching those criteria, with a plain-language
explanation of why each one ranked where it did. **The GP chooses. The tool never chooses.**

## What this is not

This is not a medical device and must not become one. The software applies user-selected filters
to a directory. It does not interpret symptoms, infer diagnoses, score urgency, or make
recommendations. Every ranking factor is visible and explainable in one sentence — no embeddings,
no ML ranking, no free-text symptom parsing.

Two rules are enforced mechanically rather than by review:

- **Vocabulary.** `tools/language.test.ts` fails the build on `recommend`, `diagnose`, `triage`,
  `assess` or `best` anywhere in the tree — identifiers, string literals and comments alike. That
  is where this class of product drifts first.
- **No paid placement, permanently.** Every schema object is zod-`.strict()`, so a `sponsored` or
  `boost` field cannot enter a record even by accident. Completeness improves visibility; money
  never does.

## Privacy posture

Patient data never leaves the GP's machine. There is no matching API — the server ships a signed
static data bundle and all matching runs client-side. The single permitted outbound call is the
referral outcome ping, whose payload is provably free of clinical content. Any other network
egress from the client is a bug.

## Layout

```
packages/
  core       schema (zod), taxonomy, freshness model, matcher.  Zero I/O. Node + browser.
  ingest     identity source adapters, legal gate, reconciliation, review queue.
  access     access-data subsystem: collectors, call queue, verification CLI.   (not yet built)
  bundle     compiles the working DB into a compact signed bundle artifact.     (not yet built)
  signals    referral outcome aggregation. Separate deploy.                     (not yet built)
  portal     specialist self-serve app + API. Holds specialist PII. Separate deploy.  (not yet built)
  web        Vite + React PWA. Downloads the bundle, matches locally.
data/
  raw        gitignored, per-source snapshots with fetch timestamps
  reviewed   committed, human-adjudicated corrections as JSON patches
```

`portal`, `signals` and `web` are three separate deployments with no shared database. That is
deliberate: the portal holds specialist PII under specialist consent, and data reaches the bundle
through an export step with human review, never a live join.

## Status

`core` and `ingest` are implemented and tested. **No real surgeon data has been ingested — not a
single page has been fetched.** All six identity adapters ship with `legalStatus: 'needs-review'`
and the runner refuses to execute any batch containing one, so clearing a source is a deliberate
human act after its terms of use have been read.

What runs today is a seeded synthetic fixture set of 50 invented surgeons. Every fixture name is
obviously fictional on purpose: this directory describes real, identifiable practitioners in
production, and plausible-looking fake data would eventually be mistaken for the real thing.

## Running it

```bash
pnpm install
pnpm verify                              # typecheck + 208 tests
pnpm --filter @referral/web dev          # http://localhost:3400
```

## Data model, in one paragraph

Identity data — who a surgeon is, what they sub-specialise in — comes from public registries and
is stable for years. Access data — which payers they accept, whether their books are open, how
long the wait is — decays in weeks and exists nowhere on the open web. They are different problems
with different machinery, and the second one is the moat.

Every fact carries provenance, a confidence tier (`A` verified registry or society membership,
`B` inferred, `C` self-described, `S` self-reported through our portal) and the date it was last
confirmed. Staleness is derived at read time, never stored. `'unknown'` is a first-class value: it
renders as unknown, never as a negative and never as an absence, because a large fraction of this
dataset will be unknown for the first six months and the product has to be honest and usable in
that state.
