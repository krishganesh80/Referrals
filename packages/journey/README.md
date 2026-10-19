# @referral/journey

A two-minute ride from "finding care is a mountain" to a short list of clinicians who fit. Built
for Wattle Health as an optional introduction to how its finder matches people with clinicians,
in Wattle's own palette and voice.

## What it is, and is not

- The six questions on the trail are the practical filters the ADHD.ME finder actually applies:
  telehealth, bulk billing, longer appointments, wheelchair access, taking new patients, and a
  language beside English. No symptom, diagnosis or care need is ever asked.
- The ten clinicians at the end are **invented**, labelled as such on every card, and matched with
  demo logic that mirrors the finder's rule (chosen things combine as AND). Order inside a group
  is alphabetical so position never reads as a rank. Nothing here is a clinical judgement.
- The ride is a foundation built here, not a port. The reference was a replay from a commercial
  console skate game, which has no reusable code; its drop-in, bowl, tunnel and glide shaped the
  trail, and that is the whole of the borrowing.
- The page makes no network request of its own. The only way off it is a link the person clicks.

## Shape

```
src/trail.ts        the trail: control points, signposts, fog banks       DOM-free, tested
src/physics.ts      movement: gravity on slope, push, brake, hop, settle   DOM-free, tested
src/preferences.ts  the six questions and the Selection they fill          DOM-free
src/roster.ts       ten invented clinicians                                DOM-free
src/matching.ts     demo matching: fits, close, hidden; reasons            DOM-free, tested
src/render.ts       the picture, Canvas 2D
src/Ride.tsx        the loop, the controls, the prompt, the chips
src/Chooser.tsx     the same six questions as a form (reduced motion, "skip the ride")
src/Results.tsx     cards, groups, next step
e2e/                Playwright, desktop and Pixel 7
```

## Run it

```bash
pnpm --filter @referral/journey dev      # http://localhost:3500
pnpm --filter @referral/journey typecheck
pnpm test                                # the unit suite, journey included
pnpm --filter @referral/journey e2e      # PW_CHROMIUM_PATH=/path/to/chrome on a machine with a pinned browser
```

## Accessibility

Reduced motion, from the system or the switch in the masthead, removes the ride and offers the
form. Every control has a button; the keyboard plays what a thumb plays. Nothing flashes, nothing
is timed, and no sound plays. Important choices and results live in the DOM, never only in the
canvas.
