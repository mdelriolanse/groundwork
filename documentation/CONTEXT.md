# Plant-floor operations

An air-gapped maintenance desk: one discrete assembly cell, vibration evidence, cited work orders. Not a chatbot. Not a scan-to-BIM product. Not a water plant.

## Language

**Asset**:
A maintainable machine we persist, cron, and write a work order against. Canonical id is its VLFT station name (`RPP1`).
_Avoid_: machine, equipment, motor (as an id), record

**Part**:
A named location on an **Asset** (drive-end bearing, `URjoint1`, spindle). A work order names one Asset and cites one Part.
_Avoid_: component, sensor (the sensor is how we observe a Part)

**Node**:
A VFLab mesh name (`RPP1`, `URjoint1`, `T_Machine_Static`, conveyor belts). A click target. Only some Nodes are Assets.
_Avoid_: mesh, object, BIM element (in speech)

**Fleet**:
The set of Assets in sqlite. Not every station mesh.
_Avoid_: plant, site, room (the cell is geometry)

**Hero**:
The one Asset bound to real CWRU vibration (`RPP1`, alias `MTR-07` in packed CMMS).
_Avoid_: primary motor, demo asset

**Fault**:
PMMCP canonical class: `inner_race` | `outer_race` | `ball` | `cage` | `normal`.
_Avoid_: error, anomaly, issue, broken

**Evidence**:
A cited window of a source (`cwru:105.mat:X105_DE_time:t0..t1` or `vlft:process`).
_Avoid_: telemetry dump, timeseries (in the prompt)

**Feature**:
One 1 Hz historian row. Condition: RMS, BPFx, rpm from a 2 s DSP window. Process: `cycle_s` / `busy` / `job_id`. Never raw samples.
_Avoid_: sample, waveform, L0

**Source**:
Stamp on every Feature and Evidence: `cwru:…` | `pmmcp:…` | `vlft:process` | `synthetic:…`.
_Avoid_: real, fake, mock (say synthetic; process times are `vlft:process`, not mock)

**Work Order**:
A structured, cited job for one Asset. At most one open Work Order per Asset. This *is* the explainable diagnosis and the repair guidance.
_Avoid_: ticket, recommendation (PMMCP's 3-line string)

**Guidance**:
The repair a technician can do: `action` + `parts[]` + a manual **citation** that opens.
_Avoid_: advice, suggestion, voxel, heatmap

**Flag**:
A Feature crossing a rule (BPFx `detected` flip or RMS > baseline+kσ). Wakes the agent. Not a 1 Hz firehose.
_Avoid_: alert storm, stream

**Board**:
The fleet UI. Work already done when a judge walks up.
_Avoid_: chat, dashboard (OpenClaw Control UI is not this)

**Twin**:
The VFLab GLB pane. Sqlite drives lights. The LLM does not drive frames.
_Avoid_: digital twin (as the product), scan, heatmap

**Focus**:
The Twin showing one **Asset**; other **Nodes** are hidden.
_Avoid_: isolate, localize, zoom (localize already means a **Fault** on a **Part**)

## Relationships

- A **Fleet** contains **Assets**
- An **Asset** has one or more **Parts**; it may have one open **Work Order**
- A **Node** may identify an **Asset** or a **Part**; most Nodes are scenery
- A **Feature** belongs to one **Asset** and one **Source**
- A **Flag** is raised from **Features** and may create a **Work Order**. Same Asset + Fault already open → no-op ([adr/0002-sqlite-is-the-wo-bus.md](adr/0002-sqlite-is-the-wo-bus.md))
- A **Work Order** cites **Evidence** and one **Part**
- The **Hero** is an **Asset**; CWRU windows are its **Evidence**
- The **Twin** displays **Nodes**; the **Board** displays **Assets** and **Work Orders**
- The **Twin** may **Focus** one **Asset**

## Example dialogue

> **Dev:** "Judge clicked a conveyor belt. Do we open a **Work Order**?"
> **Domain expert:** "No. That's a **Node**, not an **Asset**. Show the name. A **Work Order** is only for an **Asset** — today that's the **Hero** `RPP1` when a **Flag** fires on CWRU **Evidence**."
>
> **Dev:** "Do we stream 12 kHz into the model so the **Twin** stays live?"
> **Domain expert:** "The **Twin** reads **Features** at 1 Hz. The model wakes on a **Flag** and drafts the **Work Order**. Raw samples never leave the `.mat`."
>
> **Dev:** "Judge wants only the broken robot on screen. Is that localizing the **Fault**?"
> **Domain expert:** "No. The **Fault** is already on a **Part**. **Focus** the **Hero**. That's a Twin view, not a new diagnosis."

## Flagged ambiguities

- `asset_id` vs packed CMMS `MTR-07` — resolved: canonical id is the VLFT station (`RPP1`); `MTR-07` is an alias. See [adr/0001-asset-id-is-vflab-station.md](adr/0001-asset-id-is-vflab-station.md).
- "error" / "localize on the machine" — resolved: we name a **Fault** on a **Part**, not an xyz point. Showing one machine is **Focus**, not localize.
- "digital twin" — resolved: **Twin** is a pane, not the product. Product is unattended **Work Orders** + containment.
- "this is a Tesla factory" — resolved: VFLab is a published hinge-assembly cell. Pitch the *buyer* (discrete-manufacturing maintenance), not a fake OEM layout.
- how WO output reaches the Board / the next isolated wake — resolved: sqlite is the bus. Model emits JSON; a writer gates cites; Board polls `BoardView`. See [adr/0002-sqlite-is-the-wo-bus.md](adr/0002-sqlite-is-the-wo-bus.md).
