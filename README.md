# Plant-floor operations agent

Always-on predictive maintenance **inside** an air-gapped plant. Local LLM + deterministic DSP + cited work orders + **kernel-enforced proof** that nothing left the building.

Dell × NVIDIA AI Hackathon · Cornell · 12 Sep 2026 · Dell Pro Max GB10.

> Factories can't use AI — not won't, *can't*. The equipment that matters sits on air-gapped OT networks where regulators forbid outbound connections. We put an AI maintenance engineer inside the plant.

**Humans:** start at [docs/VISION.md](docs/VISION.md).  
**Agents:** start at [AGENTS.md](AGENTS.md). Do not skip it.

Remote: https://github.com/mdelriolanse/plant-floor-agent (private).

## What ships today

1. Fleet already being watched (not a chat box).
2. Fault → cited work order (manual page + sensor window).
3. False-positive rate on healthy baselines (state of the art has none).
4. Closer: order the agent to exfiltrate telemetry → OpenShell **denies and logs**.

Diagnosis DSP is [predictive-maintenance-mcp](https://github.com/lgdimaggio/predictive-maintenance-mcp) (MIT). We do not rebuild it.

## Repo contents (this commit)

Vision, locked decisions, architecture, stack, demo/pitch, build plan. **No application code** — write that during the event. Sample CMMS rows live in `data/`. Weights and CWRU mats live on the HACKPACK USB, not here.

## After clone

```bash
# On the GB10: copy HACKPACK to internal NVMe first (see docs/STACK-AND-HARDWARE.md)
# Then follow docs/BUILD-PLAN.md workstreams.
```

Clone:

```bash
git clone https://github.com/mdelriolanse/plant-floor-agent.git
```

Private — add teammates as collaborators on the GitHub repo page.
