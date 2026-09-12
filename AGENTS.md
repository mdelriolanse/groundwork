# Agent brief — plant-floor operations agent

Read this file first. Then walk the links. Do not re-litigate locked decisions. Do not rebuild the DSP layer.

**Host:** run everything on the GB10 (`ssh spark` / Remote-SSH `spark`, user `dell`). Not the laptop. See `../AGENTS.md`.

**Product (one sentence):** An always-on industrial predictive-maintenance agent that lives inside a plant's air-gapped OT network, watches vibration from rotating equipment, diagnoses faults with deterministic DSP, drafts a cited work order from manuals + CMMS history, and **proves via OpenShell** that nothing left the building.

**Event:** Dell × NVIDIA AI Hackathon, Cornell. Sat 12 Sep 2026, eHub Collegetown. Loaner: Dell Pro Max with GB10. Build window **09:50–18:30** (~8h45m). Demo **video** due at code freeze. Teams 3–4. Rubric: technical execution, usefulness, **local-first** (scored, not a checkbox), pitch.

---

## Invariants (do not violate)

1. **All inference local.** No Brave Search, no web fetch, no cloud embeddings/ASR, no OpenAI/Anthropic keys in the runtime path.
2. **Required stack is layers, not a menu:** OpenClaw (agent) inside OpenShell (kernel sandbox + egress policy) installed by NemoClaw (`nemoclaw setup-spark`).
3. **Depend on `predictive-maintenance-mcp` for DSP.** FFT, envelope, BPFO/BPFI/BSF/FTF, RMS, ISO tables, trend/Kalman/RUL, page-weak RAG — call it via MCP. MIT. Zero network calls in-tree. **Exclude `data/`** (CC BY-NC-SA).
4. **Attack PMMCP's scope, never its credibility.** 14,795 LOC, 1,365 tests, 92% coverage, honest 77.3%. On stage, name it first.
5. **Not a chat window.** Lead with work already completed in the background (cron/heartbeat).
6. **Every on-screen claim cites a real artifact** (CWRU record + window, SKF PDF page, CMMS row). No invented manual pages.
7. **Do not claim ISO 20816 zones on a benchtop fan.** `iso20816.py:294` enforces a 15 kW floor. Disclose out loud. ISO *context* only on the CWRU path.
8. **Do not claim market whitespace.** Oxmaint, iFactory, Tractian, SKF, Emerson, Augury, Senseye/Siemens, Aspen Mtell, IBM Maximo exist. Unclaimed: vendors **assert** air-gap; **none prove containment**.
9. **Lead the pitch with regulation, not cost.** IEC 62443 SL2+ outbound = control violation. CISA/NSA/FBI + 6 allies (3 Dec 2025) tell operators to push OT data to a *separate AI system*. The GB10 is that system.
10. **MoE + long context + many concurrent asset jobs.** Never a dense ≥32B chat demo. Decode law: `tok/s ≈ 273 GB/s ÷ bytes of active weights`.
11. **No audio ASR / no PyPI-torch FFT.** sm_121 NVRTC crash. PMMCP avoids that path; keep it that way.
12. **Freeze the stack on the day.** Copy models from HACKPACK to **internal NVMe** before serving. Do not serve off the USB (`--no-mmap` reads the whole file).

---

## What we build (the product)

PMMCP structurally cannot do these (`server.py:400-430` is a bare `mcp.run()`):

| Layer | Why it is ours |
| ----- | -------------- |
| Always-on loop | OpenClaw cron/heartbeat over `asset_id`s |
| Persistence | sqlite (or OpenClaw store). PMMCP repo is an in-memory LRU |
| Ingest | USB audio 44.1/48 kHz **or** CWRU `.mat` fallback |
| Work order | structured, cited. PMMCP stops at a 3-line string table |
| False-positive rate | include healthy CWRU normals. PMMCP `n_normal = 0` → FPR is `None` |
| Containment | OpenShell deny+log on "exfiltrate this telemetry" |

**Do not build:** DSP, a new LLM server, vision, ASR/TTS, looseness-as-ISO-zone, ESP32+ADXL345 ingest (`fs=1000` breaks envelope: high=499 < low=500; need >1002 Hz, ISO ≥2106 Hz).

---

## Demo closer (the physical moment)

Instruct the agent to email / POST plant telemetry off-box. OpenShell L7 egress policy **denies and logs**. Optionally unplug Ethernet. If the demo would work identically with an API key, local-first score is zero.

---

## Read next (in order)

1. [docs/VISION.md](docs/VISION.md) — why this, persona, winning pattern
2. [docs/DECISIONS.md](docs/DECISIONS.md) — locked choices + rationale
3. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — runtime topology + incident/work-order contract
4. [docs/PRD.md](docs/PRD.md) — technician workspace requirements, modules, tests
5. [docs/FRONTEND-SPEC.md](docs/FRONTEND-SPEC.md) — Palantir Workshop visual/interaction contract
6. [docs/PMMCP.md](docs/PMMCP.md) — dependency contract, file:line gaps
7. [docs/STACK-AND-HARDWARE.md](docs/STACK-AND-HARDWARE.md) — install, models, HACKPACK
8. [docs/CONSTRAINTS.md](docs/CONSTRAINTS.md) — rules, DQ traps, prior winners
9. [docs/DEMO-AND-PITCH.md](docs/DEMO-AND-PITCH.md) — beats, 5-min script, citation traps
10. [docs/BUILD-PLAN.md](docs/BUILD-PLAN.md) — hour-by-hour + teammate workstreams
11. [docs/LANDMINES.md](docs/LANDMINES.md) — do-not list

---

## Tool allowlist (say it out loud)

**Allow:** PMMCP MCP, local FS under `~/hackpack-data` + this repo, `inference.local` / host llama.cpp or vLLM, sqlite.

**Deny:** Brave Search, browser/web fetch, any `*.openai.com` / cloud telemetry, email/HTTP egress except the deny-demo.

---

## Framing line (preempt derivative accusation)

*"Diagnosis is a solved problem and we didn't rebuild it. What nobody has solved is running it unattended, inside a plant, with proof that nothing left the building."*
