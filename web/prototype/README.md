# Plant-floor operations prototype

Static chrome on `:4173` (or board `:8765/prototype/`). Live numbers from hop-loop → sqlite → `/api/hops/latest` + `/api/incidents`. `feed.json` remains the offline fallback (healthy hops 0–9 loop).

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

Replay advances 1 Hz through 20 hops. Flag at hop 10 (`flag_at`). `prefers-reduced-motion` jumps to the last hop.

## Required direct URLs

- Inbox (empty until flag): `http://127.0.0.1:4173/#/incidents`
- Incident after flag: `http://127.0.0.1:4173/#/incidents/INC-RPP1?incident=INC-RPP1&rail=preview`
- Floor, whole line (nav default): `http://127.0.0.1:4173/#/floor?rail=preview` — add `&view=top` for the top-down toggle
- Floor RPP1 (cell framed, as from `View on floor`): `http://127.0.0.1:4173/#/floor?asset=RPP1&rail=preview`
- Asset 360: `http://127.0.0.1:4173/#/assets/RPP1` — `?render=3d` opens the single-station grayscale render (click a part for its facts); works for any station id, e.g. `#/assets/B3?render=3d`
- Intelligence: `http://127.0.0.1:4173/#/intelligence?run=TAPE-20`
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

Seeded inbox (High OR on `MTR07-CAD`, Medium process drop on `T1`): loaded from `data/demo/seed-incidents.json` on `store.seed()`. Re-run with `node scripts/seed-demo-incidents.mjs` after clearing `demo_seeded` (script does that).

Prototype polls `/api/incidents` + `/api/hops/latest` at 1 Hz. No auto `flag_hop`. Healthy tape hops 0–9 loop only if hop-loop is down.
