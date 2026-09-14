<p align="center">
  <img src="web/prototype/groundwork-mark.svg" alt="Groundwork" width="120">
</p>

# Groundwork

Groundwork is an AI maintenance engineer that lives on the plant floor. It watches rotating equipment on its own and flags a developing fault before the line goes down.

When the hop-level sensor data changes, it diagnoses the fault, reads the equipment manuals and the CMMS history, and opens a work order with citations. A technician does not have to ask first.

NemoClaw runs the whole agent on one Dell Pro Max GB10 with Qwen3.6-35B-A3B. Inference stays on the box. There are no cloud calls. OpenShell sandboxes the process and records a deny if anything tries to send telemetry out.

The technician board is a live plant view: what needs attention, why it happened, and the next action.

Built for the Dell × NVIDIA AI Hackathon at Cornell, 12 Sep 2026.

Public demo: [get-groundwork.vercel.app](https://get-groundwork.vercel.app). Pushes to `main` deploy it through GitHub Actions. `groundwork.vercel.app` and `try-groundwork.vercel.app` are already taken on other Vercel accounts.

## How it works

The always-on hop loop writes L1 historian tags (not raw 12 kHz waveforms) into SQLite. Diagnosis goes through [predictive-maintenance-mcp](https://github.com/lgdimaggio/predictive-maintenance-mcp). Groundwork does not rebuild that DSP. Every claim on screen points at a real artifact: a CWRU or Mendeley window, an SKF manual page, or a CMMS row.

If you tell it to email or POST plant data off-box, OpenShell's L7 policy denies the call and the gateway audit log is what the board shows. Containment is not a seeded string.

## Run on the GB10

```bash
git clone https://github.com/mdelriolanse/groundwork.git
cd groundwork
node app/server.mjs
```

Landing: `http://127.0.0.1:8765/`
Board: `http://127.0.0.1:8765/prototype/`

Hop loop (separate process):

```bash
python3 scripts/hop-loop.py
```

Inject a catalogued fault for the demo:

```bash
./demo/inject/inject-ir.sh
```

Local inference is `http://127.0.0.1:8000` serving Qwen3.6-35B-A3B. Copy weights to internal NVMe before serving. Do not serve off the HACKPACK USB.

```bash
npm test
```

## Layout

- `app/` board API, assist, OpenShell evidence
- `web/prototype/` technician workspace
- `web/twin/` 3D plant
- `scripts/hop-loop.py` 1 Hz watcher
