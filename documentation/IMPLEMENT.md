# Remaining implementation

What is **not** on the box yet. Live stack is [SPARK-STATUS.md](SPARK-STATUS.md). Design: [PRD.md](PRD.md). Language: [CONTEXT.md](CONTEXT.md).

No application code exists in this repo. Everything below is still to write, on `spark`.

---

## Already done — do not touch

- HACKPACK → NVMe weights, CWRU mats at `~/plant-floor-agent/data/cwru/`
- `llama-server` serving **Qwen3.6-35B-A3B** Q4_K_M on `0.0.0.0:8000` (`--alias --no-mmap --jinja --reasoning off -c 32768`). gpt-oss-20b unloaded fallback.
- NemoClaw 0.0.123 + OpenShell **0.0.106** user-local; sandbox `plant-floor` Ready
- OpenClaw v2026.7.1, dashboard `:18789`, inference healthy
- PMMCP cloned at `~/vendor/predictive-maintenance-mcp` (not registered)
- Node 22.19.0

**Parked (not a build item this session):** NVFP4 Qwen/Nemotron via vLLM (no NGC; profiles incompatible). Embed/rerank. Apt OpenShell 0.0.109 — LKG max is 0.0.106.

---

## Build (in order)

### 1. PMMCP as MCP + one diagnose

Register `~/vendor/predictive-maintenance-mcp` on the `plant-floor` sandbox. Call `diagnose` on `105.mat` (path inside the sandbox or a mounted `~/plant-floor-agent/data/cwru/`).

**Done when:** tool returns `inner_race` / BPFI with a `.mat` window. No UI.

### 2. sqlite historian (L1)

Table `historian(asset_id, tag, ts, value, unit, source)` plus baselines. Also `work_orders` (PRD §8 + `status`) and a singleton FPR row — the Board reads those, not transcripts. Two producers, one table ([adr/0003-two-clocks.md](adr/0003-two-clocks.md)). Never store 12 kHz. Never diagnose `cycle_s`.

Condition writer (`RPP1` / `URjoint1`): read [`data/tapes/l0/rpp1-de.jsonl`](../data/tapes/l0/rpp1-de.jsonl) (one hop per line). Slice `source[t0:t1]`, PMMCP `diagnose`, 1 Hz RMS/BPFx/rpm. Round RMS 3 sig figs, Hz 1 decimal. Do not invent those numbers.

Process writer (`T1`): INSERT [`data/tapes/l1/historian.csv`](../data/tapes/l1/historian.csv) as-is. Stamp already `vlft:process`. Do not diagnose.

Flag at `manifest.json` `flag_at` (97→105). L2 line: [`data/tapes/l2/dirty.txt`](../data/tapes/l2/dirty.txt) — fill `_` from the L1 row just written.

Alias packed CMMS `MTR-07` → `RPP1` in `data/asset-map.json`. Other VFLab stations stay scenery.

**Done when:** `SELECT` shows 1 Hz condition features for the hero across the tape and process tags for `T1`.

### 3. Work-order skill + citations

OpenClaw skill: on a flag (BPFx flip or RMS > baseline+kσ), draft the WO JSON in [PRD.md](PRD.md) §8. Isolated session. L2 pack ≤8 dirty rows, ≤400 new tokens. No moving 1 Hz dump into the prompt.

Writer (not the model) validates cites and INSERTs `work_orders` — [PRD.md](PRD.md) §8.1 / [adr/0002-sqlite-is-the-wo-bus.md](adr/0002-sqlite-is-the-wo-bus.md). Cites must open: `105.mat` window + SKF PDF page and/or `data/history/work-orders.csv` row. Same `asset_id`+`fault` already open → no-op. Empty dirty set → exit 0.

Cron/heartbeat ≤5 min **or** `system event --mode now` on flag. Not 30 s.

**Done when:** a background run writes a `work_orders` row the Board can poll; two cites open. No one typed “start.”

### 4. FPR

Run diagnose on `97`–`100.mat`. Report n_false / n_normal. PMMCP’s headline FPR is `None`.

**Done when:** the number is on the board (ugly is fine).

### 5. VFLab twin (parallel with 3–4 once 1 works)

Geometry already in-repo (`web/twin/glb/`). No assimp. On Spark:

```
cd web/twin && python3 -m http.server 8765
# regenerate placements: python3 data/vlft/compose_scene.py
```

Vendored `three@0.185.1`. Firefox `about:support` WebGL2 = NVIDIA/GB10 (else Chrome arm64 deb). Raycast → station `asset_id` + named part (`URjoint1`). Light that mesh only. 30 fps, no shadows.

Sidecar `web/twin/asset-map.json` (copy of `data/asset-map.json`): hero `RPP1` ↔ CWRU. sqlite drives color; LLM does not.

**Done when:** `compose_scene.py` exits 0 and click `RPP1` lights `URjoint1` / `cwru:105.mat`.

### 6. Fleet board

Not a chat box. Poll `BoardView` from sqlite @ 1 Hz ([FRONTEND.md](FRONTEND.md) §5). Rows: assets, last L1 scan, open WOs, citation links. VFLab pane is optional chrome on this board. ≥2 assets (hero `RPP1` + sibling `T1`).

**Done when:** judges walk up and the WO is already there.

### 7. OpenShell deny demo

Tighten sandbox policy off **balanced** (still brew/hf/npm/pypi). Deny email/POST of telemetry. Record deny + audit line.

**Done when:** that clip exists. Optionally unplug Ethernet.

---

## Drop if behind

Live USB ingest, looseness, synth siblings, embed/rerank, NVFP4/vLLM. Ship: diagnose + one cited WO + FPR + GLB click + deny.

---

## Do not implement

Anything in [SPARK-STATUS.md](SPARK-STATUS.md). New LLM server. DSP. Vision/ASR. Scan-to-BIM. LiDAR/PLY viewer. Isaac/Omniverse. A geometry swap — closed in [adr/0004-vflab-stays-the-twin-geometry.md](adr/0004-vflab-stays-the-twin-geometry.md). ISO zone letters on the 2 hp motor. Invented IOM pages. `apt install` OpenShell 0.0.109. Express `install-vllm`. Bind llama-server to loopback only.
