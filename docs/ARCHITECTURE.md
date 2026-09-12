# Architecture

```
Sensors / CWRU .mat
        │
        ▼
  ingest (skill or small Python)  ──► sqlite per asset (baseline, windows)
        │
        ▼
  PMMCP MCP tools (diagnose, ISO-if-in-scope, trend)
        │
        ▼
  OpenClaw agent (Qwen3.6-35B-A3B NVFP4 or gpt-oss-20b)
        ├── retrieve manuals (local embed + rerank)
        ├── draft work order with citations
        └── cron / heartbeat: re-scan fleet
        │
        ▼
  OpenShell policy: deny 0.0.0.0/0 except inference.local
        └── demo: "email this telemetry out" → deny + audit log
```

On the box:

```
Dell Pro Max GB10 (Ubuntu 24.04, cgroup v2)
└── Docker (cgroupns=host)
    └── OpenShell gateway
        └── k3s
            └── NemoClaw sandbox
                └── OpenClaw agent
                    ├── MCP: predictive-maintenance-mcp
                    ├── skill: work-order + citation
                    ├── automations/cron + heartbeat
                    └── inference.local → host llama.cpp :8000 or vLLM
```

GPU stays on the **host**. We do not need GPU passthrough into the sandbox (listed "Untested on Spark"). Validate inference on the host in hour one; if passthrough is broken, keep serving on the host and point `inference.local` at it.

## Build-vs-depend

| Layer | Source |
| ----- | ------ |
| FFT, envelope, BPFO/BPFI/BSF/FTF, ISO tables, trend/Kalman/RUL, manual RAG | **PMMCP** (MCP) |
| Always-on — cron/heartbeat, per-asset scheduling, case lifecycle | **Build** |
| Persistence — asset baselines, signal history over time | **Build** (sqlite) |
| Live / file ingest | **Build** |
| Work order — parts, procedure, priority, citations | **Build** |
| Governance — egress deny + audit trail | **OpenShell** (configure, do not reimplement) |

OpenClaw primitives we must **not** rebuild: `openclaw automations` / cron, heartbeat, task ledger (`openclaw tasks audit`), skills (`SKILL.md` watcher), MCP client, subagents.

## Work-order contract

Every drafted WO is structured and citation-complete. Suggested fields:

```json
{
  "wo_id": "WO-14xx",
  "asset_id": "MTR-07",
  "opened": "2026-09-12T14:02:00-04:00",
  "fault": "outer_race",
  "severity": "baseline_deviation | trend | iso_context_only",
  "evidence": {
    "source": "cwru:105.mat | live:window-id",
    "window": "t0..t1",
    "rpm": 1797,
    "features": ["BPFO peak at … Hz", "RMS velocity …"]
  },
  "citations": [
    {"type": "manual", "doc": "skf-bearing-damage-analysis.pdf", "page": 12},
    {"type": "history", "wo_id": "WO-1041"}
  ],
  "action": "replace_bearing",
  "parts": ["6205-2RS"],
  "priority": "high"
}
```

`severity` must never be an ISO zone letter unless the machine is in-scope (≥15 kW) **and** we say so. For the live fan: `baseline_deviation` + trend slope.

## Ingest

- **Preferred live:** USB audio interface + piezo or accelerometer, 44.1/48 kHz. Downsample in software to what PMMCP wants. **RPM is a required float** — IR tachometer, not guessed.
- **Fallback (expected):** CWRU 12 kHz drive-end `.mat` from HACKPACK `data/cwru/` (64 files, checksummed).
- **Dead:** ESP32 + ADXL345 @ 1 kHz.

## Persistence

PMMCP `repository.py` is an in-memory LRU. RUL math exists but the *client* must supply history. We own time: sqlite table keyed by `asset_id` with baseline spectrum/RMS, subsequent windows, drafted WOs.

## UI

Not a prompt box. A **fleet board**: assets, last scan, open WOs, citations clickable to the artifact. Background work is already there when judges walk up.

## Allowlist

Allow: PMMCP MCP, local data dirs, `inference.local`.  
Deny: Brave Search, browser, `*.openai.com`, outbound email/HTTP — except as the thing we demonstrate being denied.
