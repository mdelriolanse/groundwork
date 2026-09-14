# Landing

Groundwork's public surface at `/` and `/landing/`. No sticky bar: the hero wordmark uses `groundwork-mark.svg`, and the two Demo Now links (hero + close) POST `/api/demo/seed` then open `/prototype/#/floor`. The board process fabricates hops at 1 Hz (catalog process tags + recorded healthy RPP1 RMS) for as long as it is up.

The hero uses an italic Instrument Serif manifesto on a layered silver light field: a short fade-in, then compositor-only `translate3d` / `opacity` on oversized gradient layers (no rotate or scale — those re-rasterize radial fills every frame). Reduced motion disables both. Motion reference: [Stripe’s front-end experience](https://stripe.com/blog/connect-front-end-experience). Below it, alternating product stories pair mute gray PP1/RPP1/T1 orbits with Floor and report previews. This replaces the original row of three decorative renders so the page explains the actual application. Board styles and behavior remain separate.

## Preview sources

- `images/floor-iso.jpg` and `images/floor-top.jpg`: captures of `/prototype/#/floor` and `/prototype/#/floor?view=top`, respectively, at 1280×800 on 2026-09-13. Use a fresh browser page per route so the persistent Twin initializes the requested camera. Landing displays them in grayscale; the Board is unchanged.
- L1 preview: `../prototype/feed.json`, `flag`, RPP1 / URjoint1. RMS 0.289 g, speed 1797 rpm, inner-race/BPFI flag, source `cwru:105.mat:X105_DE_time`, window `0.00..2.00`. Labeled recorded flag, not live telemetry.
- L2 preview: report structure from `l2ReportRail` in `../prototype/app.js`: action, candidate parts, deterministic evidence, artifact citations, incident binding. It intentionally shows no fabricated fault, part number, citation page, or completed work order.
- Concepts: existing VFLab geometry via `orbit.mjs`; the Landing renderer uses neutral gray, double-sided materials (matching the CAD mesh winding). The RPP1 story scrubs from the whole station toward `URjoint1_Bodies` and turns only that joint red; its neighboring report uses the same recorded flag. Desktop pins the story for one scroll sequence; narrow/short screens use normal document flow. Reduced motion shows the final highlighted still immediately. No picking or Board bridge.

## Fonts

Geist (body/headings), Geist Mono (chrome/data), and Instrument Serif italic (hero) are self-hosted in `fonts/`. Their OFL licenses are bundled alongside them. No runtime font CDN requests.

## Checks

Run `node --test tests/landing.test.mjs tests/concept-orbit.test.mjs`. Check both routes at 1440×900 and 375px wide, including below-fold copy, image loading, local font loading, and reduced-motion still frames.

## Animated line

`line-view.js` replaces the isometric screenshot with a lazy-loaded VFLab line. A slow camera tour zooms in and pans along the stations. The tour is playback-only; it has no pointer, keyboard, or playback controls. The top-down frame remains a captured reference.

`line-state.mjs` uses `/api/hops/latest` and `/api/board` while the hop feed reports live. Green means running (`busy`), red means flagged (red takes precedence), gray means idle. Colors pulse gently; they do not rapidly flash. While offline, the preview replays the first ten recorded process hops plus the recorded RPP1 flag. No simulated state is called live. Polling switches back to live automatically.

Reduced motion disables the camera tour and pulse, and fixes the recorded preview on hop 9. Page scrolling passes through the canvas. The Board/Twin implementation is unchanged.

The hero names Groundwork explicitly. Titles stay unmasked.
