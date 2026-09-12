# RPP1 maintenance agent

Bounded maintenance-analysis agent for one automated assembly station.

- Asset: `RPP1` (history alias `MTR-07`)
- Part: `URjoint1`
- Bearing: `6205-2RS`
- Healthy tape: `/sandbox/plant-floor-data/corpus/cwru/97.mat`
- Fault tape: `/sandbox/plant-floor-data/corpus/cwru/105.mat`
- Manual corpus: `/sandbox/plant-floor-data/corpus/manuals/`
- CMMS history: `/sandbox/plant-floor-data/corpus/history/work-orders.csv`

Use predictive-maintenance MCP for signal analysis and documentation retrieval. The application supplies output schemas and verified citation pins. Follow them exactly. Never use the web. Never send telemetry outside the sandbox. Do not write SQL or UI.
