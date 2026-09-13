# Canonical asset id is the VLFT station name

We persist, cron, and cite one string. Options were a plant-style id (`MTR-07`), a CWRU file id (`105.mat`), a retired IRIS node (`MEQUI_017`), or a VLFT station (`RPP1`). We use the station name so a click, a historian row, and a work order are the same key.

**Hero** is `RPP1` (UR pick-and-place). CWRU tape binds to part `URjoint1`. Packed CMMS `MTR-07` is an alias in `data/asset-map.json` — do not rewrite `data/history/work-orders.csv`.

**Sibling** `T1` (tightener) is `source: vlft:process` for FPR / board contrast. Process table: [`data/vlft/process.json`](../../data/vlft/process.json). Clocks: [0003-two-clocks.md](0003-two-clocks.md).

Supersedes the IRIS-node id (`MEQUI_*`). Geometry is VFLab, not EDF Saclay.
