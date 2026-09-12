# Vision

An **AI maintenance engineer that lives inside the plant**, not a chatbot that talks about machines.

## The bad moment

A rotating asset (motor, pump, fan) is drifting. The knowledge to catch it is already in the building — thousand-page manuals, decades of work orders, historian traces — but none of it can leave an IEC 62443 SL2+ OT zone. Cloud AI is a *control violation*, not a preference. The technician finds out when something breaks.

We put a box on that network. It watches vibration. When a machine leaves its baseline, a deterministic DSP layer names the signature (1×/2× running speed, harmonics, bearing defect frequencies, RMS). The local LLM correlates that diagnosis against the equipment manual and the CMMS history, then drafts a work order a human can verify: **this page, this window, this part**.

Nothing leaves the building. We **prove** it: the last beat of the demo is ordering the agent to exfiltrate plant telemetry and watching the kernel deny and log the attempt.

## Spoken elevator

Factories can't use AI — not won't, can't. The equipment that matters sits on air-gapped networks where safety regulators forbid outbound connections, so every cloud AI tool is off the table by rule. Meanwhile the knowledge to fix that equipment is scattered across thousand-page manuals, decades of maintenance logs, and sensor data nobody reads until something breaks. So we put an AI maintenance engineer inside the plant.

## Why local is mandatory (the only argument that survives a judge)

- **IEC 62443 SL2+:** OT zones do not permit arbitrary outbound connections to cloud endpoints. That is a control requirement.
- **CISA / NSA / FBI + 6 allied agencies, 3 Dec 2025:** explicitly covers "large language model-based AI, and AI agents." Operators should push OT data to a *separate AI system* and assess whether in-house AI-OT development gives more long-term control. **The GB10 is that system.**
  - https://www.cisa.gov/sites/default/files/2025-12/joint-guidance-principles-for-the-secure-integration-of-artificial-intelligence-in-operational-technology-508c.pdf
- **Deployed precedent:** 2026 dairy plant in Aguascalientes running Llama-3.3-70B and DeepSeek-R1-32B at 4-bit inside the plant boundary, zero egress. DOI: https://doi.org/10.5281/zenodo.20480414

Do **not** claim we invented industrial PdM software. The category is crowded (Oxmaint on NVIDIA DGX + SAP + FIPS 140-2, iFactory Plant Copilot, Premsys, Tractian, SKF, Emerson, Augury, Senseye/Siemens, Aspen Mtell, IBM Maximo). What is unclaimed: every vendor **asserts** air-gapped operation; **none prove containment**. OpenShell is the proof.

Do **not** lead with cost. At 23% GPU util a self-hosted H100 is ~$2.01/M tokens vs ~$0.90 API. The honest economic line: *fixed cost changes what you are allowed to run at all.*

## Category and hardware fit

Allowed category: **ops**. No collision with prior winners (Nazar = air-gapped IT triage; Simbiote = robotics; ZeroWall = code-mutation defense). No ASR (dodges the GB10 sm_121 NVRTC crash). Per-asset fan-out maps onto batch-32. Manuals are why 262k context and strong prefill exist.

## Winning pattern we are copying (not the product)

From the same series (Seattle, Jul 2026) and adjacent Spark hackathons:

1. Physical / visceral moment (Nazar: "plugging in an ethernet cable is the entire UI").
2. Every claim footnoted to a real artifact.
3. Named persona in a specific bad moment.
4. Autonomous loop, not a chat window. ZeroWall's README opens *"Not a chatbot."*
5. "Nothing ever leaves the building" is the thesis, not a footnote.
6. If the demo would work identically with an API key, local-first score is **zero**.

Our physical moment: **unplug / order exfil → deny + audit log.**
