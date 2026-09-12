# Dependency: predictive-maintenance-mcp

Repo: https://github.com/lgdimaggio/predictive-maintenance-mcp  
Docs: https://lgdimaggio.github.io/predictive-maintenance-mcp/  
License: **MIT** (code). `data/` is **CC BY-NC-SA — do not vendor, do not ship, do not call.**

Politecnico di Torino. 14,795 source LOC. 1,365 tests, 92% coverage, ~27s. 258 commits, last push 2026-08-20. README honestly reports **77.3%**, does not inflate it. **Zero** `requests`/`urllib`/`httpx`/`socket` in the tree — cannot violate the no-cloud rule. ARM64: manylinux aarch64 wheels exist for numpy/scipy/pandas/sklearn/faiss-cpu; core path has no torch/numba/librosa.

34 tools. Transports: stdio / SSE / streamable-http. MCP-generic.

**On stage, say this first:** we depend on it; we did not rebuild diagnosis.

## What it substitutes (do not reimplement)

Envelope analysis, BPFO/BPFI/BSF/FTF, ISO zone tables, trend / Kalman / RUL, chunked RAG over manuals.

## What it structurally cannot do (this is our product)

Evidence from a 2026-09-03 code pass:

1. **No always-on.** `server.py:400-430` is a bare `mcp.run()`. Zero `while True` / `Thread(` / `create_task` / scheduler. (Grep "cron" hits are substrings of "acronym".)
2. **No live ingest.** Zero OPC-UA / MQTT / Modbus / pyserial / kafka. Maintainer issues **#58/#59/#60** ask for these as *"External adapter"* — out of scope by design.
3. **No memory.** Zero sqlite/sqlalchemy/duckdb/redis. `repository.py:1-9` is an **in-memory LRU**. Prognostics without time.
4. **No work order.** Zero `work_order` / `CMMS` / `torque` / `part_number` / `procedure`. Output is a 3-line string table (`recommendations.py:19-21`).
5. **Our demo faults are thin or missing.** Imbalance/misalignment ≈ 10 lines of dominant-peak ratio (`diagnosis_pipeline.py:425-434`). **Looseness has no detector.** Gear is a prompt template (`prompts.py:303-360`), not a detector.
6. **No governance.** "egress" hits are "regression". No `asset_id` / fleet concept. Bearing catalog = **3** entries (6205, 6203, UER204).

## Benchmark honesty (use this; do not trash it)

- Headline **77.3% (34/44)** on Smith-Randall Y1/Y2 "cleanly diagnosable" strata. 64 labelled, 44 scored.
- `n_normal = 0` → **false-positive rate is literally `None`**. We include healthy baselines and own a number they do not have.
- **RPM is a required float.** No RPM estimation / tacho / order tracking in `src/`. Variable-speed machines unsupported.

## Academic cousin: PARAM

arXiv 2508.04714 — serialises bearing frequencies into language, multi-agent RAG → structured recs. **Fully cloud** (Gemini Flash + live web search). "Accuracy" is GPT-4-as-judge 1–5 over 30 inferences, not a diagnostic benchmark. Their headline contribution (prescriptive work-order shape) is exactly what we do locally.

## Adjacent: do not fear `claude-stwinbox-diagnostics`

Same author, ST hardware bridge. Streaming path raises unimplemented (`serial_comm.py:267-270`). Does not undercut live ingest as our gap.

## How we wire it

Vendor from HACKPACK `vendor/predictive-maintenance-mcp/` (already cloned, `data/` excluded) or `git clone` at the event. Register as an OpenClaw / NemoClaw **managed MCP** server (stdio is enough). Agent tools call diagnose / trend; we persist and turn the result into a WO.
