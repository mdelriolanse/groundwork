# Static public demo

The Vercel branch preserves the approved UI while replacing backend calls
with browser-local replay. The original Rocketship service remains separate.
Baseline: `9534adc1c020910842891f57f84a7125fb9ac552`.

## Behavior and boundaries

`web/prototype/demo.mjs` exposes `createDemo(feed, seed)` with `snapshot()`,
`tick()`, and `answer(question, assetId, incidentId)`. Each instance starts
at hop zero and retains at most 60 hops. The page advances once per visible
second; background tabs pause, hash navigation retains state, refresh resets.
Snapshots are copies, so callers cannot mutate the internal incident catalog.

Nine incidents come from `data/demo/seed-incidents.json`; no detection,
injection API, shortcut, button, or new fault onset exists in the public UI.
RPP1 replays healthy recorded windows; PP5 retains its seeded vibration fault.
Technician acknowledgments stay in browser memory. Only rail widths and nav collapse persist.
Assist answers exact suggested questions from selected asset/incident evidence;
other input receives a demo-only response, rendered as escaped text.
Containment explicitly lacks a published audit record; it does not execute
commands or claim live containment. No SKF PDF or raw signal is published.

## Build and verify

Run `npm run build`, `npm run test:demo`, and `npm run preview` (localhost:8678).
`npm test` also runs legacy backend tests; four require an external SKF PDF
absent on Rocketship. They are recorded failures, not skipped tests.

The build allowlists assets into `dist` and produces Vercel Build Output API
configuration in `.vercel/output`. `vercel.json` repeats the same CSP, framing,
and nosniff headers so Git/`outputDirectory` deploys are not headerless.
No functions, application server, database, credentials, or runtime corpus
are copied. All paths are same-origin.
Script hashes cover inline bootstrap scripts and import maps. The twin alone
allows same-origin embedding; top-level pages forbid framing. Inline styles
remain necessary for the current UI, including dynamic geometry positioning.

Browser acceptance covers fixed incident count after 15+ seconds and former
injection shortcuts; per-visitor hop state and reload; contextual Assist and
HTML-like text; all primary views; reduced motion; no backend requests;
404 responses for API, secrets, and server-source paths. Check desktop/mobile
layout and browser console against the static preview before each release.

## Deployment

Project: `groundwork-demo`, team: `mdelriolanses-projects`.
Deploy a preview with `vercel deploy --prebuilt --target=preview` after building.
Preview deployment protection remains enabled; use the signed-in Vercel account
or `vercel curl` for authenticated verification. Do not publish bypass tokens.
Production remains unpublished pending user review; no domain is promoted.
The current team is Hobby: [Spend Management](https://vercel.com/docs/spend-management)
is Pro-only, so no budget/automatic-pausing configuration was applied.

## Sources and redistribution

The `/credits.html` page includes attribution and license texts for modified
VLFT geometry/derived renders (CC BY-NC 4.0), Three.js (MIT), and fonts (OFL).
This is a noncommercial hackathon showcase, not a licensed commercial product.
CWRU/Mendeley scalar measurements retain source locators; no raw recordings or
manuals are redistributed. Process tags and CMMS examples are synthetic.
The authoritative geometry license is
[DigitalFactory LICENSE.md](https://github.com/difactory/repository/blob/master/LICENSE.md).
