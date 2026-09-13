# Frontend schema — plant-floor board

FE-only. Product/stack stays in [PRD.md](PRD.md). Words stay in [CONTEXT.md](CONTEXT.md). Twin stack is locked in PRD §6.

**Motif:** Swiss industrial desk, not a SCADA dashboard and not a chatbot. Steal the *language* of [Acaysia](https://acaysia.com/) — ink/cream dual-tone, hairline rules, grotesk + mono, 0-radius, full-bleed process visual — and put the VFLab **Twin** where they put the reactor film. Chrome is a poster over the cell.

**One sentence:** The cell is the page; the dossier is the claim; every claim opens an artifact.

---

## 1. Steal / don't steal

From Acaysia (homepage-dark):

| Take | Why it fits |
| ---- | ----------- |
| Dual-tone **ink `#0c0c0c`** + **cream `#f0ede6`** | Desk paper over a dark cell. One contrast move, no palette soup. |
| **Syne** display / **Hanken Grotesk** body / **JetBrains Mono** data | Poster headline, readable body, tagged evidence. |
| `border-radius: 0` | Machined, not SaaS. |
| Eyebrow → headline → one paragraph | WO reads like a job, not a card stack. |
| Full-bleed visual + overlay copy | Twin occupies the viewport; type sits on it. |
| Hairline rules (`1px` ink/cream) | Sections, not shadows. |
| Stat as a number + 4-word label | FPR, last scan, deny count. |
| Self-hosted faces | Air-gap. No Google Fonts, no CDN. |

Do **not** take: marketing video, page-wipe transitions, vendor-logo marquee, discovery CTA, lattice-Boltzmann toy, cream/dark *scrolling sections*. This is one always-on **Board**.

Do **not** import: Inter-on-slate “ops dashboard”, glass cards, neon cyan, traffic-light walls, chat composer, heatmap, voxel glow.

---

## 2. Tokens

Vendor OFL woff2 under `web/board/fonts/` (or system fallback if the day slips). `font-display: block`. No runtime font fetch.

| Token | Value | Use |
| ----- | ----- | --- |
| `--ink` | `#0c0c0c` | Twin clear-color, mast, denial tape |
| `--cream` | `#f0ede6` | Dossier, roster, type on ink |
| `--cream-ink` | `#1a1a1a` | Type on cream |
| `--rule` | `#2a2a2a` / `#cfc8bb` | Hairlines on ink / cream |
| `--mark` | `#059669` | Healthy, contained, allow |
| `--flag` | `#c25100` | Open WO / BPFx flag (not “alarm red”) |
| `--mute` | `#6c6c6c` | Scenery, synthetic stamp |
| `--display` | Syne 500–800 | Cell name, fault class, WO id |
| `--body` | Hanken Grotesk 400–600 | Sentences |
| `--data` | JetBrains Mono 400–500 | `asset_id`, Hz, windows, paths |
| `--space` | 4 / 8 / 16 / 24 / 40 | Poster rhythm |
| `--radius` | `0` | Everything |
| `--type-eyebrow` | 11px / 0.14em / uppercase / mono | Surface labels |
| `--type-display` | clamp(28px, 4vw, 56px) | One headline per surface |
| `--type-body` | 15–17px / 1.45 | Claims |
| `--type-data` | 12–13px / tabular | Rows |

Twin selection light: cream `#e6dcc8` emissive, intensity ≤0.7, one `PointLight`. Not the current `#3d7cff`. Flagged **Asset** may shift to `--flag`. Scenery: no light.

---

## 3. Surfaces (the chrome schema)

One page. No router. Five surfaces, always present. Twin is the field; the other four are posters.

```
┌─ S0 MAST ─────────────────────────────────────────────── S4 TAPE ─┐
│  cell · containment · inference.local          last deny / FPR    │
├──────────────┬────────────────────────────────────────────────────┤
│ S2 DOSSIER   │                                                    │
│  selection   │                 S1 TWIN                            │
│  + WO        │              (full-bleed WebGL)                    │
│  + cites     │                                                    │
├──────────────┤                                                    │
│ S3 ROSTER    │                                                    │
│  fleet rows  │                                                    │
└──────────────┴────────────────────────────────────────────────────┘
```

Desktop (demo): dossier 360–400px cream column, left. Twin fills the rest. Mast 40px ink. Tape 28px ink. Roster sits *under* the dossier in the same column — a list, not a second window.

Fallback if WebGL is software: Twin becomes a still + “llvmpipe — camera only”; dossier still works.

---

## 4. What each surface must present

Language from CONTEXT. If a field is missing, show the em-dash and a source-gap, never invent.

### S0 — Mast

Always-on proof the desk is live. Not a nav.

| Field | Bind | Typeface | Notes |
| ----- | ---- | -------- | ----- |
| Cell | `VFLab · hinge assembly` | body | Cite VLFT in a title attr / footer, not a badge pile |
| Containment | `CONTAINED` \| `DENY` | mono + `--mark` / `--flag` | Driven by last OpenShell audit line |
| Inference | `inference.local` | mono | Say the allowlist out loud; print it |
| Clock | host local | mono | Wall time, not “live stream” |

### S1 — Twin

The product picture. Sqlite paints; the LLM does not drive frames.

| Field / act | Bind | Notes |
| ----------- | ---- | ----- |
| Scene | `web/twin/scene.json` placements | Existing viewer |
| Click | Raycast → parent walk → first named **Node** | PRD §6 pick contract |
| Resolve | `asset-map.json` → `{asset_id, part, source}` | Hero `RPP1` / part `URjoint1` |
| Light | That mesh only | No voxel, no heatmap, no MSAA8 |
| Push | `BoardView.fleet[].flag` + `work_order.evidence.part` @ 1 Hz | **Focus** that Asset, light that Part. Same strings as the mesh names. LLM does not drive this. |
| Kind | `asset` \| `part` \| `scenery` | Conveyor click → name only, no WO |
| Camera | Orbit, 30 fps, `pixelRatio ≤ 1.25` | Freeze orbit during prefill |

HUD *inside* the canvas is banned. Selection state leaves the Twin and lands in S2.

### S2 — Dossier (agent diagnostic)

This is the rendered diagnosis. Work is already done when a judge walks up.

**Idle (nothing selected, or scenery Node):** eyebrow `CELL` · display “Hinge assembly cell” · body one line: published VFLab, not a scanned plant · VLFT cite.

**Asset selected, no open WO:** eyebrow `ASSET` · display `asset_id` · rows: part, source, last L1 (`rms`/`rpm`/BPFx on the hero; `cycle_s`/`busy` on `T1`), `source:` stamp.

**Asset selected, open WO (the demo):**

| Block | Bind | Must show |
| ----- | ---- | --------- |
| Eyebrow | `WORK ORDER` | + `wo_id` in mono |
| Display | `fault` | `inner_race` not “bearing issue” |
| Lead | one sentence | Asset + Part + action. No chat voice. |
| Evidence | `evidence.*` | `source`, `window`, `rpm`, feature lines |
| Part | `evidence.part` | `URjoint1` — same string as the lit Node |
| Severity | `severity` | `iso_context_only` when applicable; **no zone letter** |
| Action | `action` + `parts[]` | `replace_bearing` · `6205-2RS` |
| Citations | `citations[]` | Each row is a *control*: opens `.mat` window note, SKF page, or CMMS row |
| Honesty | static | “2 hp << 15 kW ISO floor — context only” |

Citation rows are first-class. A claim without an openable cite is a bug.

### S3 — Roster (fleet)

Not a dashboard table. Typographic list. ≥2 **Assets**: hero `RPP1` + sibling `T1`.

| Col | Bind |
| --- | ---- |
| Id | `asset_id` (mono) |
| Role | `hero` \| `sibling` |
| Last L1 | `ts` + `rms` (hero) or `cycle_s`/`busy` (`T1`) |
| Flag | none / BPFx / RMS |
| WO | `wo_id` or em-dash |
| Source | `cwru:…` \| `vlft:process` \| `synthetic:…` |

Click a row = same selection as a Twin pick. Selected row gets a left hairline in `--flag` or `--cream-ink`, not a filled card.

Healthy siblings stay visible (FPR story). They do not enter the L2 prompt.

### S4 — Tape (containment + honesty)

Thin ink bar. Two facts, always:

| Field | Bind |
| ----- | ---- |
| FPR | `n_false / n_normal` — PMMCP’s headline is `None`; ours is a number |
| Last deny | OpenShell audit one-liner (`DENY email/POST …`) |

Optional third tick: `egress: deny`. This is the closer surface — when the judge says “email the vendor”, the tape is what changes.

---

## 5. View-model (what the Board reads)

Projection of sqlite ([adr/0002-sqlite-is-the-wo-bus.md](adr/0002-sqlite-is-the-wo-bus.md)). Chrome polls this JSON (~1 Hz, same rate as L1) — not OpenClaw transcripts. Twin keeps its own `scene.json` + `asset-map.json`.

```
BoardView
  cell          { name, cite, license }
  containment   { state, last_deny, inference }
  fpr           { n_false, n_normal }
  honesty       { iso_floor_kw: 15, claim: "context_only" }
  selection     { asset_id?, part?, kind: asset|part|scenery }
  fleet[]       { asset_id, role, part, source, rms?, rpm?, flag?, wo_id?, ts? }
  work_order?   PRD §8 object, or null
```

Rules:

- `selection.asset_id` is the VLFT station (`RPP1`), never `MTR-07`. Alias may print as secondary mono.
- `work_order` appears only if `selection` is that **Asset** and a WO is open.
- Scenery selection clears `work_order` from the dossier (the WO still exists on the roster).
- `source` is always stamped. No “real / mock”.
- Twin color comes from `fleet[].flag` + `selection`, not from the LLM.

---

## 6. Interaction schema

| Input | Result |
| ----- | ------ |
| L1 **Flag** (push) | Twin **Focus**es `fleet[].asset_id`, lights `evidence.part`. S2 fills when a WO is open. No click required. |
| Click Twin **Node** that maps to an **Asset** | Light mesh. S2 fills. Roster highlights. |
| Click Twin scenery | Light optional / none. S2 shows Node name + “not an Asset”. No WO. |
| Click roster row | Same as Asset pick. Camera may ease to station; do not auto-orbit. |
| Click citation | Opens local artifact (PDF page, window text, CMMS row). No network. |
| “Email / POST telemetry” | Not a chat send. A single cream control on S2 or S4 that *attempts* egress so the tape can show DENY. |
| Keyboard | Tab order: roster → dossier cites → deny control. Twin click is pointer-first. |

No prompt box. No “ask the agent”. Judge chat, if any, is OpenClaw Control UI — off this page.

Motion: 150–250ms opacity/transform only. `prefers-reduced-motion`: snap. Freeze Twin during model prefill.

---

## 7. Twin visual rules (chrome around the existing viewer)

Keep `web/twin/viewer.js` pick/light/load. Wrap it; don’t replace the render path.

| Do | Don’t |
| -- | ----- |
| Ink clear-color `#0c0c0c` | Gradient sky, grid floor, shadows |
| Cream / flag emissive on the named mesh | Whole-station flood, heatmap, outlines on every Node |
| One PointLight, range small | Extra fills, bloom, SMAA |
| 30 fps cap | 60 fps fighting vLLM |
| Station names from GLB | Billboard labels on every mesh |

Click-in copy (S2) for the hero path:

`RPP1` → part `URjoint1` → source `cwru:105.mat` → WO `inner_race` + SKF page.

That is the only click that must be demo-perfect.

---

## 8. Copy voice (on-screen only)

Eyebrows: `ASSET`, `PART`, `EVIDENCE`, `WORK ORDER`, `CONTAINED`, `SYNTHETIC`.

Banned on the Board: dashboard, ticket, anomaly, chatbot, digital twin (as the product), ISO zone letters, “live streaming 12 kHz”, market-whitespace lines, TCO.

Stage line that can sit as a cream footer, 13px:

*Published assembly cell we did not scan. Diagnosis is PMMCP. Unattended work orders + containment are ours.*

---

## 9. Anti-patterns

- Chat input, typing indicators, “thinking…” tokens on the Board
- Rebuilding DSP plots (FFT/envelope) as decoration
- ISO 20816 zone A–D on the 2 hp stand
- Treating `T1` as CWRU, or a conveyor as an Asset
- Cloud font / icon CDN
- A second 3D library or a React rewrite of the viewer
- More than one display headline visible at a time
- Status-as-color-only (always pair `--mark`/`--flag` with a word)

---

## 10. Day-of file map (when we build chrome)

| File | Job |
| ---- | --- |
| `web/twin/*` | Locked viewer + GLBs. Keep. |
| `web/board/index.html` | Mast + dossier + roster + tape; iframe or mount Twin canvas |
| `web/board/board.css` | Tokens from §2 |
| `web/board/board.js` | Poll `BoardView`, bind surfaces, citation clicks, deny control |
| `web/board/fonts/` | Syne / Hanken / JetBrains (OFL), or system fallback |

Serve beside the Twin (`web/` root). Firefox only. No build step required.

---

## 11. Judge-walk-up checklist

When someone stands in front of the box, they must see without typing:

1. The cell (Twin, already framed)
2. An open **Work Order** on `RPP1` / `URjoint1` with `inner_race`
3. Two openable cites (CWRU window + SKF page or CMMS row)
4. `source: cwru:105.mat` on the hero; `vlft:process` on `T1`
5. FPR as a number
6. ISO 15 kW disclosure
7. `inference.local` + `CONTAINED`
8. After the closer: a real deny line on the tape
