# VFLab twin

Served by `app/server.mjs` on `:8765` under `/twin/`. One scene graph, two modes:

| Mode | URL | Camera | Focus | Materials | Used by |
| --- | --- | --- | --- | --- | --- |
| inspection (default) | `/twin/?asset=RPP1` | perspective + orbit, hero framing | hides other stations | original VLFT | incident detail "3D inspection" |
| plan | `/twin/?view=plan` (isometric) or `?view=top` | fixed orthographic bird's-eye, line turned left→right, fitted to viewport minus parent inset | dims others, outlines footprint, frames the station's cell | neutral grey | prototype Floor page |
| part | `/twin/?view=part&asset=RPP1` | perspective + orbit around one station at the origin; only that GLB is loaded | click a part → highlight sub-tree blue, post `twin:part`; `twin:light` pre-highlights the sensor-bound part | neutral grey | Asset 360 “Open 3D render” |

Click a station in plan mode to open its Asset 360 (parent handles `twin:select`). In inspection mode `?asset=` deep-links. Hero `RPP1` / `URjoint1` → `cwru:105.mat`.

## Bridge (postMessage, origin-checked against `:4173`)

Parent → twin: `twin:focus {assetId}`, `twin:fit`, `twin:view {view, inset:{left,top,right,bottom}}`, `twin:light {assetId, part}` (inspection only).

Parent → twin (part mode): `twin:light {assetId, part}` highlights a part, `twin:part:clear` clears it.

Twin → parent (part mode): `twin:part {asset_id, part|null}` on click.

Twin → parent: `twin:stations {cells, stations[{asset_id, model, cell, monitored, source}]}`, `twin:ready {view}`, `twin:layout {view, width, height, anchors[{asset_id, x, y, w, h}]}` (screen-space bbox per station, posted after every camera change), `twin:select {asset_id}`, `twin:hover {asset_id|null}`.

The parent draws labels, markers, tree, and legend from `twin:layout`; the twin draws only geometry, grid, and the selection outline.

## Data

- `scene.json` — placements (position/rotation per station, `kind`: station|scenery) plus `cells` and a `cell` per station used for the Floor tree and cell framing. Hand-maintained; the original `compose_scene.py` is not in this checkout.
- `asset-map.json` — which stations are monitored (`RPP1` hero, `T1` process sibling), their clickable nodes and signal source.

Geometry: VLFT CC BY-NC 4.0 (`https://github.com/difactory/repository`). Warehouse shell is omitted in both modes (occludes the line).
