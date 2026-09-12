# Demo and pitch

## Demo faults

| Fault | How | Honesty |
| ----- | --- | ------- |
| Bearing IR / OR / ball | CWRU labelled set | Legitimate ISO *context* only; 2 hp rig still below 15 kW — say so |
| Imbalance | Washers on a benchtop fan/motor | PMMCP has a thin 1× peak-ratio heuristic only |
| Looseness | Shims | **PMMCP has no detector** — either skip or treat as our add, not as "ISO looseness" |
| Misalignment | If time | Same thin heuristic |

RPM from an IR tachometer. Pre-recorded waveforms from *our* rig were **not** packed. If hardware is missing at 09:50, CWRU is the whole demo — that is fine.

## Citation rule

Every claim on screen points at a real artifact:

- CWRU record id + time window, and/or
- SKF `skf-bearing-damage-analysis.pdf` page, and/or
- a row in `data/history/work-orders.csv`

No invented motor/pump IOM pages. Those PDFs are **not** on HACKPACK (WEG/NREL pulls were attempted; treat as absent unless you verify the files).

## Demo beats (record before 18:30)

1. **Already on.** Fleet board with open WOs. No one types a prompt to "start."
2. **Fault → cited WO.** Live or CWRU. Show the manual page and the sensor window. Speak the FPR number. Disclose the ISO 15 kW floor.
3. **Name PMMCP.** 14,795 LOC, 77.3% on CWRU, MIT. *"Diagnosis is solved. Unattended + containment is not."*
4. **Closer.** "Email this telemetry to the vendor." OpenShell deny + audit line. Unplug Ethernet if it helps the room see it. Physical moment.
5. **Allowlist out loud.** "No search, no browser, no cloud. Inference is `inference.local`."

Turn the network off on stage if the closer still reads. Costs nothing.

## 5-minute pitch (top 8)

1. **Regulation (90s).** IEC 62443 SL2+ = outbound is a control violation. CISA/NSA/FBI + 6 allies, 3 Dec 2025: LLM-based AI and agents; push OT data to a *separate AI system*. This box is that system. Aguascalientes dairy plant already did zero-egress 70B-class models in-plant.
2. **Already running (60s).** Work orders on the fleet. Persona: night-shift tech, motor trending, manuals no one has time to search.
3. **Receipts (90s).** One WO, two citations, FPR, ISO disclosure.
4. **Dependency + gap (45s).** PMMCP named first. Our layer is unattended + proof.
5. **Containment (45s).** Exfil denied. Unplug.

## Numbers you may cite

| Claim | Source |
| ----- | ------ |
| CISA joint OT-AI guidance, 3 Dec 2025 | https://www.cisa.gov/sites/default/files/2025-12/joint-guidance-principles-for-the-secure-integration-of-artificial-intelligence-in-operational-technology-508c.pdf |
| Aguascalientes dairy, in-plant 70B/32B, zero egress | https://doi.org/10.5281/zenodo.20480414 |
| 20% of breached orgs traced a breach to shadow AI, +$670K | IBM 2025 / Ponemon, n=600 |
| 91% prefer on-prem/private/hybrid for sensitive AI; 58% delayed initiatives | Cloudian 2026, n=203 |
| Signal65 day/night on this box: 8 users on 30B, LoRA overnight, **under $600/seat** one-time | https://signal65.com/research/ai/rag-inference-by-day-fine-tuning-by-night/ |

## Do not say

- "No software competition in industrial OT." False.
- Italian Garante €15M OpenAI fine as EU-on-prem pressure. **Annulled 18 Mar 2026.**
- Gartner "76%" or FinOps $1.2M→$7M unless you have the primary.
- ISO Zone B/C/D on the desk fan.
- "We beat PMMCP's 77.3%." We report FPR and always-on; we do not pick a fight on their metric.
- Pure TCO: self-hosted H100 at 23% util is **more expensive** per token than API ($2.01 vs $0.90).
