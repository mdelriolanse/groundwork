# Locked decisions

Do not re-open these unless the box physically cannot run the chosen path.

| # | Decision | Why |
| - | -------- | --- |
| 1 | Idea = plant-floor PdM (ops), not compliance / AIOps / discrepancy hunter / vendor clean room | Strongest "local is mandatory" argument available: IEC 62443 + CISA Dec 2025. Category-legal. No prior-winner collision. |
| 2 | Depend on `lgdimaggio/predictive-maintenance-mcp`; do not rebuild DSP | 14,795 LOC, 1,365 tests @ 92%, MIT, ARM64-clean, **zero network calls**. Event rules allow libraries. Buys hours. |
| 3 | Attack PMMCP **scope**, never credibility | It is well engineered. `mcp.run()` has no scheduler, no persistence, no live ingest, no work order. That is the product. |
| 4 | Harness = OpenClaw under NemoClaw | Only layer with built-in cron/heartbeat — the always-on differentiator. |
| 5 | Primary model = `nvidia/Qwen3.6-35B-A3B-NVFP4` on managed vLLM | NVIDIA pinned Spark recipe. MoE ~3B active → ~90–92 tok/s on this silicon. 262k ctx. Tool parser `qwen3_xml`. |
| 6 | Offline fallback = llama.cpp sm_121a + `gpt-oss-20b-MXFP4.gguf` | No NGC on the pack laptop → no `nvcr.io` vLLM image on HACKPACK. 83 tok/s measured on GB10. |
| 7 | Plan B only: Nemotron 3.5 Lightning 30B-A3B NVFP4 + DSpark | Fast, but "thinks a lot" and can eat the token budget before the work-order text lands. |
| 8 | Sensor path = USB audio interface @ 44.1/48 kHz (piezo/accel) | ESP32+ADXL345 at 1 kHz is dead: envelope `filter_high=499 < filter_low=500`. Need >1002 Hz; ISO ≥2106 Hz. |
| 9 | CWRU `.mat` is the first-class fallback if the rig is missing | Legal data prep. Also the only path where ISO *context* is discussable. |
| 10 | Do not claim ISO 20816 zones on the benchtop rig | 15 kW floor in `iso20816.py:294`. Disclose. Report baseline deviation + trend slope on the live rig. |
| 11 | Report a false-positive rate | PMMCP headline 77.3% has `n_normal = 0`. Healthy CWRU normals (`97`–`100.mat`) are a free technical-execution win. |
| 12 | Pitch leads with regulation, not TCO | Breakeven literature contradicts a pure cost pitch. |
| 13 | Name the dependency first on stage | Converts derivative risk into a credibility signal. |
| 14 | No vision, no ASR, no Whisper, no VL model | Factory floor is telemetry + PDFs. Audio hits NVRTC. VL wastes residency. |
| 15 | Frontend = technician-first Palantir Workshop operations workspace | Workshop Inbox + Object View + AIP Assist matches incident triage, object context, and the existing machinery assistant. It supersedes the Acaysia ink/cream/full-bleed motif. Dataset choice changes twin geometry only. Static five-screen approval precedes integration. See `PRD.md` and `FRONTEND-SPEC.md`. |
| 16 | Floor = live bird's-eye plan view of the whole VLFT line, not a first-person 3D scene | Fixed orthographic camera (isometric default, top-down toggle), every station placed from `web/twin/scene.json`, neutral materials, selection dims-and-outlines instead of hiding, labels/markers/tree drawn by the parent app from posted screen anchors. 24 stations rendered, only RPP1 + T1 monitored and said so. Warehouse shell omitted. Clicking a machine on the floor opens its Asset 360, whose `Open 3D render` shows that station alone in the same grayscale/grid (`?view=part`) with click-a-part fault facts. Inspection mode (perspective + orbit + hide-others) stays for incident detail. See `FRONTEND-SPEC.md` §5.3 and `web/twin/README.md`. |

Rejected models (do not download, do not "just try"): `gpt-oss-120b` (59 GB, not the NemoClaw path), any dense ≥32B (demo dies at 2.7–8 tok/s), Qwen3-VL, Whisper/Kokoro.

Rejected sensor: ESP32 + ADXL345.

## Corrections we already paid for

- "Industrial OT has almost no software competition" was **false**. Regulatory argument survives; whitespace does not.
- The stack is **layered**, not a choice. Cornell page says "or"; NYC/SF say "and". `nemoclaw onboard` installs all three.
- Build window is **~8h45m**, not 12h. Video due 18:30.
- Simbiote (Seattle 1st) already used this full stack. Cornell formalises what already won.
