# PRD — plant-floor operations agent

Locked 2026-09-12. Do not re-litigate unless the box cannot run the path.

**Box now:** [SPARK-STATUS.md](SPARK-STATUS.md). **Still to write:** [IMPLEMENT.md](IMPLEMENT.md). Language: [CONTEXT.md](CONTEXT.md).

**Product (one sentence):** A private, on-device maintenance copilot: plant telemetry becomes an explainable diagnosis and the exact repair a technician needs — cited to a sensor window and a manual page, shown on the named part, with proof nothing left the building.

Deterministic DSP names the fault. The local LLM writes the work order. The Twin **Focus**es the Asset and lights the Part from sqlite (named mesh, **not voxels**). OpenShell proves containment.

**Event:** Dell × NVIDIA AI Hackathon, Cornell, Sat 12 Sep 2026. Build 09:50–18:30. Demo **video** due at freeze. Host: Dell Pro Max GB10 (`spark` / `promaxgb10-8823`). Category: **ops**.

**Framing:** *"Diagnosis is a solved problem and we didn't rebuild it. What nobody has solved is running it unattended, inside a plant, with proof that nothing left the building."*

---

## 1. Who does what

| Layer | Project | Job | We build? |
| ----- | ------- | --- | --------- |
| Installer | **NemoClaw** (`nemoclaw setup-spark`) | Puts OpenClaw inside OpenShell; points `inference.local` at host `:8000` | Configure |
| Agent | **OpenClaw** (port 18789) | Cron/heartbeat, skills, MCP client, WO draft | Skills + automations |
| Sandbox | **OpenShell** 0.0.109 | seccomp/Landlock/netns, L7 egress YAML, credential placeholders, `inference.local` | Policy only |
| DSP | **PMMCP** (`lgdimaggio/predictive-maintenance-mcp`, MIT) | Envelope, BPFO/BPFI/BSF/FTF, RMS, ISO tables, thin RAG | **Do not rebuild** |
| Weights | Host **vLLM** or **llama.cpp** | See §3 | Serve on host, not in k3s |
| Twin | Firefox + Three.js | VLFT VFLab named stations | Viewer + sidecar map |
| Memory | sqlite `historian` | L1 features, baselines, WOs | **Build** |

**NemoClaw does not host a model.** Path:

```
OpenClaw → https://inference.local → OpenShell router
        → host.openshell.internal:8000
        → llama.cpp  Qwen3.6-35B-A3B Q4_K_M   (live)
        → llama.cpp  gpt-oss-20b MXFP4        (fallback script)
```

NVFP4 + managed vLLM is the NVIDIA pin but **not runnable here** (no NGC image; Express profiles readiness-incompatible).

GPU stays on the **host**. Passthrough into the sandbox is untested — do not depend on it.

---

## 2. Hardware (this box)

Dell Pro Max FCM1253 = DGX Spark silicon.

| | |
| - | - |
| SoC | GB10 Grace Blackwell — 6,144 CUDA cores, 48 SMs, sm_121 + 20-core Arm (10× X925 + 10× A725) |
| Memory | 128 GB LPDDR5X-8533 unified, 256-bit, **273 GB/s**, ~121 GB usable. One bus for weights, KV, display, browser. |
| OS | DGX OS 7 = Ubuntu 24.04 aarch64, CUDA 13, driver 580.x (EGL 580.173.02 probed) |
| Power | 280 W USB-C. SoC TDP ~140 W. Do not swap the charger. |
| Display | iGPU (not a second dGPU). HDMI 2.1a / DP-Alt. |

Decode law: `tok/s ≈ 273 GB/s ÷ bytes of active weights per token`.

| Model | Active | Measured decode |
| ----- | ------ | --------------- |
| Dense 70B FP8 | 70B | **2.7 tok/s** — unusable |
| Qwen3.6-35B-A3B Q4_K_M (llama.cpp, live) | ~3B | **~73 tok/s** (measured 2026-09-12) |
| Qwen3.6-35B-A3B NVFP4 (vLLM, not served) | ~3B | **~90–92 tok/s** (catalog) |
| gpt-oss-20b MXFP4 | ~3B | **83 tok/s** |
| Soft ceiling | — | ~80–85 tok/s below ~10 GB weights |

Prefill 2,400–6,000 tok/s. vLLM recipe: `--gpu-memory-utilization 0.4`, 262k ctx, **4 concurrent seqs**, 8192-token batch, chunked prefill, prefix cache, MTP off. 0.4 exists so ~60 GiB stays free for host + Firefox — do not raise it to “fit” a point cloud.

Thermal: watch `/sys/class/thermal/thermal_zone{0,5}/temp`. `nvidia-smi` under-reports ~30 °C. `--no-mmap` mandatory. `GGML_CUDA_NO_VMM=1` if any load >32 GB.

Probed 2026-09-12 over SSH: 18 Gi used / 103 Gi available; Firefox snap present; **no Chrome**; no `DISPLAY` (WebGL HW not yet gated).

---

## 3. Models (HACKPACK)

Copy to **internal NVMe** before serve. Do not serve off the USB.

| Role | Artifact | Size | When |
| ---- | -------- | ---- | ---- |
| **Primary (live)** | llama.cpp sm_121a + `Qwen3.6-35B-A3B-Q4_K_M.gguf` (`ggml-org`) | 20 GB | NVMe. Alias `Qwen3.6-35B-A3B`. `--reasoning off` |
| **Fallback** | llama.cpp + `gpt-oss-20b-MXFP4.gguf` | 12 GB | `~/opt/hackpack/serve-gpt-oss.sh` |
| Parked | `nvidia/Qwen3.6-35B-A3B-NVFP4` on managed vLLM | ~22 GB | HF cached; no NGC / profile incompatible |
| Plan B | Nemotron 3.5 Lightning 30B-A3B NVFP4 + DSpark | 21+1.3 GB | Only if Qwen tool-loop fails; thinking can eat `max_tokens` |
| Last resort | Gemma 3 4B bartowski Q4_0 | 2.3 GB | Smoke only |
| Embed / rerank | Qwen3-Embedding-0.6B + Qwen3-Reranker-0.6B | ~1.2 GB | Local SKF RAG |

**Rejected:** `gpt-oss-120b` (59 GB), any dense ≥32B, Qwen3-VL, Whisper, Kokoro.

Live serve:

```bash
~/opt/hackpack/serve-qwen.sh
# then:
nemoclaw inference set --provider vllm-local --model Qwen3.6-35B-A3B --sandbox plant-floor
```

Tool parser: Qwen XML / jinja on the live model; Harmony + `--jinja` only if falling back to gpt-oss.

---

## 4. Data

### 4.1 CWRU (real vibration)

HACKPACK `data/cwru/` — **64** records, PMMCP pin-verified. Case Western 2 hp stand. Channel used by the benchmark: **DE**, SKF **6205-2RS**. 52/64 mats also contain FE + BA + RPM (extra dots, not a mesh).

| | |
| - | - |
| Faults | 16 IR, 28 OR, 16 ball, 4 normal (`97`–`100.mat` @ 48 kHz) |
| Faulted fs | 12 kHz (60 files) |
| Loads | 0–3 hp → 1797 / 1772 / 1750 / 1730 rpm |
| Pit sizes | 0.007 / 0.014 / 0.021 / 0.028 in (labels, not DSP outputs) |
| OR clock | `centered_6` / `orthogonal_3` / `opposite_12` — **labels only**, not recovered |

Localization we may claim: **inner race / outer race / ball / cage** of the assumed 6205 (BPFI/BPFO/BSF/FTF). Not xyz, not windings, not “the other end of the plant.”

Hero tape (wall clock): `t0–8 min` = `97.mat` healthy; `t0+8–20 min` = `105.mat` IR007 @ 1797 rpm. Bind to **`RPP1`** part **`URjoint1`**. ISO 20816: 2 hp << 15 kW floor (`iso20816.py:294`) — **context only, no zone letter**.

### 4.2 VLFT VFLab (geometry + process clock — not IRIS)

[difactory/repository](https://github.com/difactory/repository) VFLab automated assembly line, **CC BY-NC 4.0**. Cite; do not claim an EV OEM plant. Discrete cell: robots, conveyors, pin-insert, rivet, inspect — same *class* of desk as an auto/EV line.

Already GLB. **No assimp bake.** No LiDAR. Process extract: [`data/vlft/process.json`](../data/vlft/process.json). Two clocks: [adr/0003-two-clocks.md](adr/0003-two-clocks.md).

| | |
| - | - |
| Scene | `data/vlft/VFLab.json` → `web/twin/scene.json` via `data/vlft/compose_scene.py` |
| Hero | `RPP1` (`UR_Pick_and_Place_Station.glb`, named `URjoint1`) — condition is CWRU |
| Sibling | `T1` tightener, `source: vlft:process` (op 2, cycle 2.0 s) |
| Stations | 19 tools + 4 buffers + warehouse shell |
| Alias | packed CMMS `MTR-07` → `RPP1` in `data/asset-map.json` |

IRIS-v2 (EDF Saclay water room) is retired. Do not load `cad_model.fbx` / `iris-room.glb`. Do not run jsimIO. Do not play `VFLab_anim.json`.

Alternatives re-scanned and closed on build day — Omniverse body shop, IRIS-v2, ProdCell, DARB, RdmPlant, PBR re-skin: [adr/0004-vflab-stays-the-twin-geometry.md](adr/0004-vflab-stays-the-twin-geometry.md). Do not re-open without reading it.

### 4.3 Manuals / CMMS

- SKF `skf-bearing-damage-analysis.pdf` (packed)
- ISO 20816 scope notes (packed)
- `data/history/work-orders.csv` — synthetic but on-disk; cite the row
- **No** WEG/NREL motor/pump IOM. PMMCP `test_pump_manual` is a fixture — do not hang a pump story on it

---

## 5. Temporal contract

The model is **not** a live stream. Three rates:

| Layer | Rate | Who | LLM sees it? |
| ----- | ---- | --- | ------------ |
| **L0 raw** | 12 kHz (CWRU) or 44.1/48 kHz (USB) | `.mat` / wav | **Never** |
| **L1 features** | **1 Hz** | PMMCP CPU → sqlite | No. Twin + flags |
| **L2 pack** | **event**, or heartbeat **≤5 min** | OpenClaw isolated session | **Yes** — ≤400 new tok |

**L0 → L1** (the only “quantization”): 2.0 s DSP window, **1.0 s hop**. Store RMS (3 sig figs), `BPFI/BPFO/BSF` `{detected, Hz×1 decimal, strength}`, rpm, `source`. Schema:

`historian(asset_id, tag, ts, value, unit, source)`

One table, two producers ([adr/0003-two-clocks.md](adr/0003-two-clocks.md)): condition tags on `RPP1` (`cwru:…`); process tags `cycle_s` / `busy` / `job_id` on `T1` (`vlft:process`). Never store 12 kHz. Never put `cycle_s` into PMMCP `diagnose`. 20 tags × 15 min of JSON overflows 262k; a moving window busts vLLM prefix cache.

**L2 suffix** — dirty assets only, one line each, cap **8**:

`asset_id part flag rms_g bpxx_hz rpm source window wo`

`wo` is `WO-14xx` or `none` (from sqlite, not from the last transcript). Prefix (cached 2–5k): tools + SKF page-weak + fleet roster + **open-WO roster**. Include a row only if a flag flipped, RMS > baseline+kσ, or judge-forced. Healthy siblings stay on the board for FPR, not in the prompt. Empty dirty set → cron exits 0; no vLLM slot.

OpenClaw event `--mode now`: 30 s floor, 5 starts / 60 s. Do **not** heartbeat at 30 s. Budget the 4 vLLM slots: WO / tools / isolated cron / judge chat.

Honest stage latency: **8–20 s** alarm → cited WO.

Sibling `T1`: `source: vlft:process`. Stays on the board for FPR / cell clock. Enters L2 only if an inject flag fires (drop).

---

## 6. 3D render stack (locked)

| | |
| - | - |
| Bake | **None.** VLFT GLBs already named. Do not assimp IRIS FBX. |
| Check | `python3 data/vlft/compose_scene.py` — stations + `URjoint1` / `T_Machine_Static` in GLBs. |
| Ext | `KHR_mesh_quantization` required on every station GLB. Vendored `GLTFLoader` handles it. No Draco / meshopt. |
| Serve | `cd web/twin && python3 -m http.server 8765` |
| Browser | Firefox snap (already on this Spark). WebGL2, not WebGPU. |
| Library | Vendored `three@0.185.1` — `GLTFLoader` + `OrbitControls` + `Raycaster`. No CDN. |
| Frame | 30 fps cap, `pixelRatio ≤ 1.25`, **no shadows**, no MSAA8 |
| Pick | Raycast → walk parents → first named node → `{asset_id, part, confidence, source}` |
| Light | That node only (`emissive` + one `PointLight`). No voxel heatmap. |

**Hour-1 gate:** Firefox `about:support` → WebGL 2 Driver = **NVIDIA/GB10**. If `llvmpipe`: `google-chrome-stable_current_arm64.deb`. If still SW: apt `f3d` (camera only).

**Do not install:** Isaac, Omniverse, Open3D CUDA, Blender-as-demo, Potree, Cesium, Babylon, model-viewer, Electron, FBXLoader, Draco, raw/10% PLY.

**GPU coexistence:** static station GLBs (~15 MB) + 30 fps ≈ 2–10 GB/s. Qwen decode ≈ 135 GB/s. Fine. Naive LiDAR is a kill. Freeze the camera during prefill. Do not overlap FFT + prefill + orbit.

This is **not** scan-to-BIM (Simbiote). We consume a finished cell CAD. Stage line: *published assembly cell we did not scan; agent + containment are the product.*

---

## 7. What we build vs PMMCP

PMMCP `server.py` is a bare `mcp.run()`. Missing (this is the product):

| Ours | Why |
| ---- | --- |
| Always-on | OpenClaw cron/heartbeat over `asset_id`s |
| Persistence | sqlite. Their repo is an in-memory LRU |
| Ingest | USB 44.1/48 kHz **or** CWRU `.mat` |
| Work order | structured + two citations. They emit a 3-line string |
| FPR | healthy CWRU normals. Their `n_normal = 0` → FPR is `None` |
| Twin | VFLab named-station lights from L1 |
| Containment | OpenShell deny+log |

**Do not build:** DSP, a new LLM server, vision, ASR/TTS, looseness-as-ISO-zone, ESP32+ADXL345 (`fs=1000` → envelope `high=499 < low=500`).

On stage, name PMMCP first: 14,795 LOC, 1,365 tests, 92% coverage, honest **77.3%** (34/44 Y1/Y2). MIT. Zero network calls in-tree. **Exclude `data/`** (CC BY-NC-SA). Catalog is three bearings: 6205, 6203, UER204.

---

## 8. Work-order contract

```json
{
  "wo_id": "WO-14xx",
  "asset_id": "RPP1",
  "opened": "2026-09-12T14:02:00-04:00",
  "fault": "inner_race",
  "severity": "baseline_deviation | trend | iso_context_only",
  "evidence": {
    "source": "cwru:105.mat",
    "window": "t0..t1",
    "rpm": 1797,
    "features": ["BPFI peak at 161.69 Hz", "RMS …"],
    "part": "URjoint1"
  },
  "citations": [
    {"type": "manual", "doc": "skf-bearing-damage-analysis.pdf", "page": 12},
    {"type": "history", "wo_id": "WO-1410"}
  ],
  "action": "replace_bearing",
  "parts": ["6205-2RS"],
  "priority": "high"
}
```

Every on-screen claim cites CWRU window and/or SKF page and/or a CMMS row. Process tags stamped `vlft:process`. No invented IOM.

**Push.** The model does not choose a voxel or an xyz. L2 already carries `asset_id` + `part`. The skill copies those into §8 and adds `fault` / `action` / `parts` / `citations` from the packed manual (SKF `skf-bearing-damage-analysis.pdf` today). BoardView @ 1 Hz is the only Twin input: `fleet[].flag` → Focus + light; `work_order` → dossier. See [adr/0002-sqlite-is-the-wo-bus.md](adr/0002-sqlite-is-the-wo-bus.md).

### 8.1 Write / read

Isolated OpenClaw sessions die. They are not memory. Bus: [adr/0002-sqlite-is-the-wo-bus.md](adr/0002-sqlite-is-the-wo-bus.md). Chrome: [FRONTEND.md](FRONTEND.md).

| Stage | Who | What |
| ----- | --- | ---- |
| Emit | isolated skill | §8 JSON only |
| Gate | non-LLM writer | persist iff both cites resolve on disk |
| Store | `work_orders` | ≤1 open WO per Asset |
| Show | Board + Twin | poll `BoardView` @ 1 Hz; cites are `:8765` links |
| Next wake | L2 / prefix | `wo=` on dirty lines; open-WO roster in prefix |
| No flags | cron script | exit 0 — do not spend a slot |

**One-shot.** First Flag on `RPP1`/`URjoint1` opens one WO. Same `asset_id`+`fault` already open → no-op.

**Not the product.** Judge chat may read sqlite. `openclaw tasks` is the audit line. FPR is a scripted `n_false/n_normal` row, not model text. The LLM never paints S1–S4.

---

## 9. Demo

1. **Already on.** Fleet board + VFLab cell. No prompt to “start.”
2. **Fault → cited WO.** Click `RPP1` / `URjoint1` → DE bearing lights → WO with `.mat` + SKF page. Speak FPR. Disclose 15 kW floor.
3. **Name PMMCP.** Then: unattended + containment is ours.
4. **Closer.** “Email this telemetry to the vendor.” OpenShell deny + audit. Unplug Ethernet if it helps.
5. **Allowlist out loud.** No search, no cloud. Inference is `inference.local`.

Pitch leads with **IEC 62443 SL2+** and CISA/NSA/FBI + 6 allies (3 Dec 2025): push OT data to a *separate AI system*. This box is that system. Do not claim market whitespace. Do not lead with TCO.

---

## 10. Invariants

1. All inference local. No Brave, no web fetch, no cloud embed/ASR, no vendor keys in the runtime path.
2. Stack is layers, not a menu: OpenClaw ⊂ OpenShell ⊂ NemoClaw `setup-spark`.
3. Depend on PMMCP for DSP. Attack **scope**, never credibility.
4. Not a chat window.
5. Every claim cites a real artifact (or an explicit `synthetic` stamp).
6. No ISO zone letters on a fan or on the 2 hp CWRU motor.
7. No vision / ASR / VL. Twin is a static GLB, not a VLM.
8. MoE + long context + many asset jobs. Never dense ≥32B.
9. No PyPI-torch FFT (sm_121 NVRTC).
10. Freeze the stack. Copy HACKPACK → NVMe first.
11. LLM is event-only. Twin is sqlite @ 1 Hz.
12. Do not run scan-to-BIM. Do not load IRIS LiDAR or `iris-room.glb`. No Omniverse-derived GLB or render in git ([adr/0004](adr/0004-vflab-stays-the-twin-geometry.md)).
13. sqlite is the WO bus. Isolated transcripts are not product state.

---

## 11. Day-of gates (hour 1)

1. rsync HACKPACK → NVMe. Serve Qwen3.6-35B-A3B Q4_K_M on `:8000`. One completion.
2. PMMCP `diagnose(105.mat)` → inner_race.
3. Firefox `about:support` WebGL2 = NVIDIA. Load `web/twin/`. Click `RPP1`.
4. OpenShell deny on a dummy egress.

If behind at 14:00: drop live ingest and looseness. CWRU + cited WO + FPR + GLB click + deny is a complete product.

---

## 12. Doc map

| File | Role |
| ---- | ---- |
| [PRD.md](PRD.md) | This file |
| [CONTEXT.md](CONTEXT.md) | Glossary |
| [FRONTEND.md](FRONTEND.md) | Board motif + surface schema |
| [IMPLEMENT.md](IMPLEMENT.md) | Remaining build |
| [SPARK-STATUS.md](SPARK-STATUS.md) | What's on the box |
| [adr/0001-asset-id-is-vflab-station.md](adr/0001-asset-id-is-vflab-station.md) | Canonical `asset_id` |
| [AGENT-MECHANICS.md](AGENT-MECHANICS.md) | L1 feed → Flag → retrieve → WO → Twin push |
| [DATA.md](DATA.md) | Tapes + parse contract |
| [adr/0002-sqlite-is-the-wo-bus.md](adr/0002-sqlite-is-the-wo-bus.md) | Skill output → sqlite → Board / next wake |
| [adr/0003-two-clocks.md](adr/0003-two-clocks.md) | VLFT process clock vs CWRU condition |
| [adr/0004-vflab-stays-the-twin-geometry.md](adr/0004-vflab-stays-the-twin-geometry.md) | Why not Omniverse / IRIS-v2 / ProdCell / DARB |
| [../AGENTS.md](../AGENTS.md) | Agent invariants |
