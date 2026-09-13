# Agent mechanics

How the copilot turns a sensor window into a cited repair. The Twin and the Board only **read**. The model only **writes a work order**. sqlite is the bus ([adr/0002-sqlite-is-the-wo-bus.md](adr/0002-sqlite-is-the-wo-bus.md)).

---

## Loop

```
raw vibration (.mat / USB)
        ↓  2 s window, 1 s hop
DSP (PMMCP) → sqlite historian  (1 Hz features — the Twin may read these)
        ↓  Flag (fault class flipped, or RMS above baseline)
L2 pack (≤8 dirty lines, ≤400 new tokens)
        ↓  isolated OpenClaw skill
model emits work-order JSON (PRD §8)
        ↓  non-LLM writer
persist iff every citation opens a file on disk
        ↓
Board + Twin poll BoardView @ 1 Hz
  Twin: Focus the Asset, light the Part   (named mesh = same string as the row)
  Board: diagnosis + Guidance             (action, parts, openable manual page)
```

The model is not in the render path. It does not pick a location. L2 already has `asset_id` and `part`.

Empty dirty set → cron exits 0. No model call.

---

## Feed (batches)

The agent is **not** the anomaly loop. Constant eval is L1, CPU-only. The model sees a dirty batch only after a Flag (or a ≤5 min heartbeat). Two clocks: [adr/0003-two-clocks.md](adr/0003-two-clocks.md).

```
tape cursor  (pre-seed wall-clock; do not wait 8 live minutes)
   ├─ RPP1 condition   loop 97.mat → 105.mat
   │     2 s window / 1 s hop → PMMCP diagnose → 1 Hz historian
   │     Flag = BPFx flip or RMS > baseline+kσ
   └─ T1 process       loop process.json op 2 (cycle_s 2.0)
         1 Hz cycle_s / busy / job_id   stamp vlft:process
         never diagnose   never Flag this build
        ↓
sqlite historian
        ↓  Flag or heartbeat ≤5 min   (not 30 s)
L2 dirty pack  ≤8 lines, ≤400 new tok
        ↓  isolated OpenClaw   empty → exit 0
WO JSON → cite gate → BoardView
```

**L1 batch** = one hop: one 2 s CWRU window (or one T1 process tick). Writer calls PMMCP per condition hop. Not a 12 kHz dump. Not a trend/Kalman batch this build.

**L2 batch** = dirty assets only, one line each:

`asset_id part flag rms_g bpxx_hz rpm source window wo`

1 Hz dump never enters the prompt. T1 stays on the Board for FPR / cell clock. OpenClaw `event --mode now`: 30 s floor, 5 starts / 60 s. Budget the 4 vLLM slots.

Tapes: [DATA.md](DATA.md). Writer still IMPLEMENT #2.

---

## Manual retrieval (RAG-like — page-weak)

“Deep understanding of the equipment” is **cited pages from manuals that live on this box**, not a 3D occupancy of the machine and not a web search.

### Corpus (on disk only)

| File | Role | Allowed cite? |
| ---- | ---- | ------------- |
| `skf-bearing-damage-analysis.pdf` (HACKPACK) | Inner/outer/ball damage pictures + what to do | **Yes** |
| `data/manuals/iso-20816-scope-notes.md` | 15 kW floor honesty | Context only — not a repair cite |
| `data/history/work-orders.csv` | Prior jobs on the alias `MTR-07` | **Yes** (`type: history`) |
| PMMCP `data/` | CC BY-NC-SA | **No** — do not ship or cite |
| Pump / motor IOM we do not have | — | **No**. Do not invent a page |

A new manual is in-corpus only after the file is on NVMe. No fetch at runtime.

### Query

Not a chat. The query **is the Flag**:

`fault=inner_race  part=URjoint1  asset=RPP1  rpm=1797  source=cwru:105.mat`

That string retrieves. The technician never types.

### Retrieve (two rungs — stop at the first that holds)

**1. Page-weak pin (default, day-of).** A static map from fault class → `{doc, page}` that we have already opened and checked.

| Flag | Doc | Page | Why |
| ---- | --- | ---- | --- |
| `inner_race` | `skf-bearing-damage-analysis.pdf` | 12 | SKF inner-ring damage |
| `outer_race` | same | (the outer-ring plate we verified on disk) | |
| `ball` | same | (the rolling-element plate we verified on disk) | |
| `normal` | — | — | no work order |

Put those pages (text extract, not the whole PDF) in the **cached prefix**. The model is told: copy `doc` + `page` into `citations[]`. Do not pick a different page.

**2. Optional local retrieve.** If the packed embedder / reranker is already served (`Qwen3-Embedding-0.6B` + `Qwen3-Reranker-0.6B`, ~1.2 GB), chunk the **same** PDFs by page, retrieve top-k for the Flag string, rerank. The winner must still be a real `{doc, page}` on disk. PMMCP’s chunked manual RAG may be called over MCP for this — **do not rebuild it**. Still no network.

Do not stand up embeddings “to be more RAG.” Pin first. Embed only if the pin is wrong for a Flag we actually fire.

### Generate

Isolated skill. Prefix (cached): tools + pinned manual pages + fleet roster + open-work-order roster.

Suffix (new, dirty only):

`asset_id part flag rms_g bpxx_hz rpm source window wo`

Output is **only** PRD §8 JSON. No SQL. No HTML. No extra prose.

The model:

- copies `asset_id` / `part` from the suffix
- names `fault` from the Flag (DSP already decided)
- fills `action`, `parts[]`, `citations[]` from the retrieved page + the CMMS row if one matches

It does not diagnose from the PDF. DSP already did. The PDF tells the technician **what to do** given that diagnosis.

### Gate

Writer, not the model:

1. Every `citations[]` entry resolves: PDF exists and that page number is in range, or the CMMS `wo_id` is a real row.
2. `evidence.source` is a file we have (`105.mat`). Process rows stamp `vlft:process` and do not open a WO.
3. Same Asset + same fault already **open** → no-op.
4. Fail → reject, no row. The Board never shows an unopenable cite.

### Push

`BoardView` @ 1 Hz:

- `fleet[].flag` → Twin **Focus** + light `evidence.part`
- `work_order` → dossier Guidance (`action` + `parts` + citation controls)

Same strings as the mesh names. No voxels.

---

## What this is not

| Temptation | Why not |
| ---------- | ------- |
| Chat “ask the manual” | Not a chat window. Retrieval is Flag-driven. |
| Web search / Brave | Air gap. Corpus is the USB + repo. |
| Embeddings as the product | Pin is enough for one bearing story. |
| VLM / “find the bearing in 3D” | Twin is a named mesh. Location is L1. |
| Invented IOM pages | Writer rejects. |
| PMMCP `data/` | Non-commercial. Exclude. |
| Model-written SQL | Writer owns the bus. |

---

## Day-of check

1. Open `skf-bearing-damage-analysis.pdf` page for `inner_race`. Put that number in the pin table.
2. Fire the hero tape (`97.mat` → `105.mat` on `RPP1` / `URjoint1`).
3. Work order appears with two openable cites: the `.mat` window and that SKF page.
4. Twin Focuses `RPP1` without a click.
