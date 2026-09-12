# Event constraints

Source: https://builderbase.com/event/dell-x-nvidia-ai-hackathon-cornell (scraped 2026-09-02).

## Clock

| Time | Event |
| ---- | ----- |
| 09:00 | Doors, mingle, finalise teams |
| 09:50 | **Hacking starts** |
| 14:00 | Lunch |
| 18:30 | **Code freeze — demo video & project submission** |
| 19:00 | Slides / pitch deck |
| 19:30 | Top 8 live pitch (5 min) |
| 20:30 | Wrap |

Budget backwards from **18:30**, not 20:30. Build window ~8h45m.

- 40 teams hard cap, one GB10 each. Teams **3–4**, rosters **lock at kickoff**, no swaps.
- 1st = the GB10 (~$6,500). 2nd/3rd = Dell laptop. Hardware except prizes goes back.
- **IP: we keep it.** BuilderBase / Dell / NVIDIA take no ownership.
- Venue Wi-Fi will not pull weights. HACKPACK exists for this.

## Rules that shape the product

1. **All inference local.** "No remote LLM/API calls in the agent's runtime path." No cloud fallback for embeddings or ASR.
2. **Required stack: NemoClaw, OpenClaw, or OpenShell.** Sibling NYC/SF pages say **and**. Install all three.
3. **Real business/corporate workflow** — ops, sales, support, knowledge, devops, research. "Toy demos, joke projects, and personal-assistant clones won't be judged." OpenClaw's *default* use case is explicitly out.
4. **Built during the event.** Starter scaffolds and existing libraries are fine. **Anything materially built before doors open is a DQ.** Legal prep: weights, containers, caches, architecture, datasets, rehearsed setup. This repo's first commit is architecture. Application code starts after 09:50.
5. **Rubric:** technical execution, usefulness, **local-first**, pitch. Local-first is scored, not a checkbox.

## Traps

**Brave Search.** First-class NemoClaw integration = remote API in the runtime path. Same for default OpenClaw web/browser tools. Curate a local-only allowlist. Design as if search is **not** exempt.

**Category vs Seattle.** Simbiote (1st, Seattle) was physical AI / digital twins. Cornell's business-workflow rule is new. Do not reason from Seattle about what is allowed. Simbiote *did* use the full OpenClaw+NemoClaw+OpenShell stack, so the "requirement" formalises a winner, it does not add a new primitive.

**Nazar clone.** 2nd place, same series: air-gapped IT incident triage, ethernet-cable UI, 122B + BM25 evidence graph. Mentors overlap. We are plant OT + vibration + work orders + containment proof — not log staring.

**Other anti-patterns:** chat-with-PDFs RAG; personal assistant (NVIDIA ships this as a NemoClaw tutorial); adversarial code-mutation (ZeroWall, Adversary already won).

## Prior art to study, not copy

- Nazar — https://github.com/Dhruv-0-Arora/Nazar — citations + physical UI
- ZeroWall — https://github.com/DDjohnson21/ZeroWall — "Not a chatbot"
- SparkClaw — https://github.com/ZZZZJJJ0928/sparkclaw-new — multi-model residency
- Superhero/DreamBook — sm_121 notes: unload LLM (`keep_alive:0`) before a second heavy model
