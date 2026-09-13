# sqlite is the work-order bus

Isolated OpenClaw cron (`sessionTarget: isolated`) starts empty and is pruned. The Control UI is not the Board. L2 is inbound only. Agent output has nowhere to go unless we persist it.

**Decision.** sqlite is the only bus between the skill, the Board, and the next wake. The model emits [PRD.md](../PRD.md) §8 JSON. A non-LLM writer persists it. The Board polls a `BoardView` projection ([FRONTEND.md](../FRONTEND.md) §5). The Twin still reads L1. The LLM never paints UI.

## Write

1. Isolated skill sees the L2 pack. It emits §8 JSON only — no SQL, no HTML.
2. Writer checks both citations resolve on disk (CWRU window and/or SKF page and/or `data/history/work-orders.csv` row). Fail → reject, no row.
3. `INSERT` `work_orders`. At most one **open** Work Order per Asset.
4. Session dies. Transcript is not product state.

First **Flag** on the hero tape (`RPP1` / `URjoint1`, `97.mat` → `105.mat`) opens one WO. Later heartbeats **no-op** if the same `asset_id`+`fault` is already open.

## Read

| Consumer | Reads | Does not read |
| -------- | ----- | ------------- |
| Board / Twin | sqlite → `BoardView` @ 1 Hz | OpenClaw transcripts, token streams |
| Next isolated wake | prefix open-WO roster + L2 `wo=` | Prior session chat |
| Judge chat (1 of 4 slots) | sqlite, if anyone types | — |
| `openclaw tasks` | run audit only | WO body |

Citations are local links on `:8765`. Twin lights come from L1 flags + selection, not from the WO text.

## Twin push (not voxels)

The pitch — *telemetry → explainable diagnosis + the exact repair a technician needs* — is this bus, not a point cloud.

There are **no voxels**. The cell is named meshes. The map is one string:

`historian.asset_id` / `evidence.part` = Three.js node name (`RPP1`, `URjoint1`)

**Push** (Board polls `BoardView` @ 1 Hz):

1. L1 writes a **Flag** on an Asset + Part.
2. `fleet[].flag` is set. Twin **Focus**es that Asset and lights that Part.
3. Isolated skill sees the L2 line (already has `asset_id` + `part`). It does **not** invent a location. It writes §8 JSON: `fault`, `action`, `parts[]`, `citations[]`.
4. Writer persists iff cites exist on disk. `work_order` appears on the Board.
5. Dossier shows the diagnosis + repair. Citation rows open the **manual page** (SKF today; other IOM only if the file is on disk).

“Deep understanding of the equipment” = page-weak retrieve over packed manuals, cited. Mechanics: [AGENT-MECHANICS.md](../AGENT-MECHANICS.md). Not a learned 3D occupancy of the machine. Do not add LiDAR, voxel grids, or a VLM that “finds the bearing.”

The model never paints the Twin. It only emits the WO. The Twin already knew *where* from L1.

## Next wake

Cached prefix (stable): tools + SKF page-weak + fleet roster + **open-WO roster**.

L2 dirty line (≤8, ≤400 new tok):

`asset_id part flag rms_g bpxx_hz rpm source window wo`

`wo` is `WO-14xx` or `none`. Empty dirty set → cron exits 0; **no** vLLM slot.

## Not the model

FPR is a scripted `n_false / n_normal` row (normals `97`–`100.mat`). PMMCP’s headline is `None`. Do not ask the LLM for the number.

## Rejected

- OpenClaw session memory / Control UI as the Board
- Streaming model tokens onto S2
- LLM-driven Twin frames
- Heartbeat that calls the model when L2 is empty
- Model-written SQL

Schema sketch: `work_orders` holds the §8 object plus `status` (`open|rejected`); unique open row per `asset_id`. FPR is a singleton row. Historian stays L1-only.
