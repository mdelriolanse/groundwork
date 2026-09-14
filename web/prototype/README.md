# Plant-floor operations prototype

Static chrome on `:4173` (or board `:8765/prototype/`). Live numbers from the board's 1 Hz mock hop loop (catalog process tags + recorded healthy RPP1 RMS) → sqlite `latest_hop` → `/api/hops/latest` + `/api/incidents`. Real `hop-loop.py` still wins when it is posting.

## Build the feed (on GB10)

```bash
python3 scripts/seed-l1-sensors.py
python3 data/tapes/slice20.py
python3 scripts/build-prototype-feed.py
```

`build-prototype-feed.py` prefers PMMCP, else RMS + envelope vs SKF 6205 catalog. Never invents RMS. Never interpolates 97→105. Fleet process tags come from `scripts/seed-l1-sensors.py` + `data/sensors/catalog.json`.

## Run on GB10

Serve through the board server so `/api/board` resolves — containment evidence is read live from the OpenShell gateway (`app/lib/openshell.mjs`: `openshell logs plant-floor --source sandbox` + `openshell policy get`), never from `feed.json`:

```bash
cd /home/dell/plant-floor-agent
node app/server.mjs        # then http://127.0.0.1:8765/prototype/
```

Static-only fallback (containment shows "gateway offline / unproven"):

```bash
python3 -m http.server 4173 --bind 0.0.0.0 --directory web/prototype
```

Replay is replaced by the always-on hop loop (`scripts/hop-loop.py`). UI shows a monotonic hop index — never `N/20`. `prefers-reduced-motion` still freezes the fallback animation.

## Required direct URLs

- Inbox (empty until flag): `http://127.0.0.1:4173/#/incidents`
- Incident after flag: `http://127.0.0.1:4173/#/incidents/INC-RPP1?incident=INC-RPP1`
- Floor, whole line (nav default): `http://127.0.0.1:4173/#/floor?rail=preview` — add `&view=top` for the top-down toggle
- Floor RPP1 (cell framed, as from `View on floor`): `http://127.0.0.1:4173/#/floor?asset=RPP1&rail=preview`
- Asset 360: `http://127.0.0.1:4173/#/assets/RPP1` — 3D render is open by default (`?render=off` closes); works for any station id, e.g. `#/assets/B3`
- Intelligence: `http://127.0.0.1:4173/#/intelligence`
- Signal evidence: `http://127.0.0.1:4173/#/incidents/INC-RPP1?incident=INC-RPP1&rail=evidence&evidence=signal`

## Maintenance Assist states

`assistState=ready|running|answered|failed|offline`. Unmonitored / unknown stations force `unsupported`. Fleet L1 tags are assistable; only RPP1 is diagnosed. Closed state is any route without `rail=assist`.

- Ready (hero): `#/incidents/INC-RPP1?rail=assist&assistState=ready`
- Ready (process tags): `#/floor?asset=PP3&rail=assist`
- Unsupported: `#/floor?asset=WAREHOUSE&rail=assist`

## Honesty

- All stations are monitored (25 in `asset-map.json` / scene). Only RPP1 is CWRU-diagnosed and may flag. Other stations show cited synthetic process/electrical tags from `data/sensors/catalog.json` — never invented vibration or ISO zones. Assist binds those L1 tags; it does not diagnose them.
- Floor is the live twin (`:8765/twin/?view=plan`) in a persistent iframe; the `:4173` static fallback still needs the board server up for geometry. Headless Firefox on the GB10 has no WebGL — capture the Floor with a windowed Firefox (`DISPLAY=:1`).
- Charts are the 20 RMS points. No 12 kHz waveform.
- Manual rail is a source-gap unless a real artifact is on the feed.
- Containment rail renders only OCSF `NET:OPEN DENIED` lines pulled from the gateway, plus the effective policy hash. No deny line → "Unproven". "Attempt telemetry POST from sandbox" runs `openshell sandbox exec … curl` and the state flips to CONTAINED only when the gateway logs the deny.
- CMMS rows are `data/history/work-orders.csv` aliased MTR-07 → RPP1.

## Live hop loop (demo)

```bash
# terminal A — board API
node app/server.mjs

# terminal B — 1 Hz hops (use project venv for numpy)
.venv/bin/python scripts/hop-loop.py

# induce IR on stage (or Alt+I in the prototype; Alt+Shift+I clears)
node scripts/inject-fault.mjs ir 30
# curl -s -X POST http://127.0.0.1:8765/api/demo/inject -H 'content-type: application/json' -d '{"source":"ir","hops":30}'
```

Seeded inbox (`data/demo/seed-incidents.json` on `store.seed()`): vibration only on `PP5` AC motor; process tags on other named click-nodes. Priorities cover critical / high / medium / low. Re-run `node scripts/seed-demo-incidents.mjs` to upsert.

Prototype polls `/api/incidents` + `/api/hops/latest` at 1 Hz. No auto `flag_hop`. Tape hops 0–9 are the RPP1 RMS palette only — hop index does not wrap.
