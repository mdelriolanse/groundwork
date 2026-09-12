# Plant-floor agent assistance implementation

The port-8765 Board connects a bounded RPP1 maintenance agent to the VFLab Twin without exposing model or Gateway endpoints to the browser.

## Runtime path

`historian/flag -> SQLite -> RunManager -> OpenClaw Gateway -> maintenance agent -> PMMCP -> gpt-oss -> contract/citation gate -> SQLite -> BoardView/SSE -> Twin + dossier`

- Host checkout and Node server: `/home/dell/plant-floor-agent`
- NemoClaw sandbox: `plant-floor`
- OpenClaw agent: `maintenance`, workspace `/sandbox/.openclaw/workspace-maintenance`
- Local model route: `inference.local`; llama-server remains private from browser code
- PMMCP: stdio MCP inside sandbox with an explicit maintenance-tool allowlist
- Bus/state: `data/plant-floor.db` (WAL); model emits JSON and never writes SQL or HTML

## Evidence and RAG

Automatic `inner_race` work orders use a server-owned SKF PDF page pin plus exact CMMS alias resolution (`RPP1` -> `MTR-07`). The verified action page is PDF page 214. Scoped questions call PMMCP `search_documentation`; the corpus includes a page-preserving extraction of page 214 because PMMCP indexes only the first 50 pages of a PDF by default. Backend resolves returned passage text back to the original PDF and rejects absent/ambiguous citations.

Corpus registry is `config/corpus.json`; agent/workflow registry is `config/agents.json`. Extend another workflow by adding an agent entry, prompt adapter, retriever declaration, and contract validator. Shared Gateway, store, SSE, citation, and Board primitives remain unchanged.

## UI contract

Root `/` serves the Acaysia-derived Board: proof masthead, cream dossier, full-bleed ink Twin, cell roster, and bottom proof tape. Automatic diagnosis is primary. The only text input is **Ask this work order**, bounded to selected asset/work-order context. Twin API exposes `focusAsset`, `lightPart`, and `setFrozen` for run-state orchestration.

## Operations

```bash
cd /home/dell/plant-floor-agent
./scripts/provision-agent.sh
/home/dell/.local/bin/node scripts/index-corpus.mjs
./scripts/install-board-service.sh
/home/dell/.local/bin/node scripts/replay-hero.mjs
curl http://127.0.0.1:8765/api/health
```

Open `http://10.50.14.139:8765/`. `POST /api/containment/attempt` performs a real sandboxed external POST and records the resulting denial; it does not fake the proof state.

## Verification

`/home/dell/.local/bin/node --test tests/*.test.mjs` checks contracts, one-open-work-order idempotency, citation gates/page resolution, Gateway tool-history extraction, question bounds, and frontend motifs. Real E2E verification additionally replays `105.mat`, observes `load_signal` and `diagnose_vibration` in the ledger, asks one scoped PMMCP question, confirms one page-resolved PDF citation, and verifies an unrelated question returns `out_of_scope` without citations.
