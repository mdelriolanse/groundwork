# Build plan

Budget from **18:30**. Video must exist by then. Slides 19:00.

## Hour-by-hour

| Window | Work | Done when |
| ------ | ---- | --------- |
| 09:50–10:30 | `nemoclaw setup-spark` **or** llama.cpp path. Copy HACKPACK → NVMe. OpenShell ≥0.0.7. Host inference smoke (one completion). | Model answers locally |
| 10:30–12:00 | PMMCP MCP registered. One CWRU record diagnoses. Local tool allowlist applied. | `diagnose(105.mat)` returns a fault |
| 12:00–14:00 | sqlite asset registry + cron/heartbeat + work-order skill + citations | Cron writes a WO with two citations |
| 14:00–16:00 | CWRU batch + FPR number + five-screen Palantir Workshop-style static prototype, then approved incident UI (not a chat). Live ingest only if the rig is actually there | FPR on a slide; approved Inbox shows multiple assets/incidents |
| 16:00–17:30 | OpenShell egress deny. Record the demo video | Deny+log captured on camera |
| 17:30–18:30 | Freeze. Submit video + project. Do not update the stack | Submitted |

If behind at 14:00: **drop live ingest and looseness.** CWRU + cited WO + FPR + deny is a complete product.

## Workstreams (3–4 people)

Parallel after inference is up. Do not all sit on setup.

| Seat | Owns | Does not touch |
| ---- | ---- | -------------- |
| **Box** | HACKPACK copy, NemoClaw/OpenShell, inference, allowlist, thermal | Product UI |
| **DSP** | PMMCP MCP, CWRU runner, FPR script, RPM input | Pitch deck |
| **Agent** | Skills, cron, sqlite, incident/WO schema, operations read model | Stack install |
| **Demo** (or Agent if 3) | Beats, video, slides, ISO disclosure line, PMMCP credit | DSP internals |

Agents on each laptop: read [AGENTS.md](../AGENTS.md) and this file. Implement only your seat. Share the WO JSON contract in [ARCHITECTURE.md](ARCHITECTURE.md).

## Definition of a shippable demo

Must have all four:

1. Background loop has produced at least one WO before a human types.
2. That WO cites a real file the judge can open.
3. A number for false positives on healthy records (even if ugly).
4. A recorded OpenShell deny.

Nice: live fan, looseness, multi-asset fan-out, ethernet unplug.

## Freeze discipline

- Update nothing after inference works.
- Monitor `/sys/class/thermal/thermal_zone{0,5}/temp`, not `nvidia-smi`.
- Copy models to internal NVMe **before** `--no-mmap` load.
- Unload unused models (`keep_alive:0` if anyone touches Ollama).
