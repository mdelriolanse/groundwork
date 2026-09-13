# Data

What is on disk, what the writer parses, what must not be invented. Feed rates: [AGENT-MECHANICS.md](AGENT-MECHANICS.md). Clocks: [adr/0003-two-clocks.md](adr/0003-two-clocks.md). Legal inventory: [../data/README.md](../data/README.md).

---

## Inventory

| Path | Role | In git? |
| ---- | ---- | ------- |
| `data/tapes/manifest.json` | Clock + parse contract | Yes |
| `data/tapes/l0/rpp1-de.jsonl` | L0 DAQ drops (CWRU window pointers) | Yes |
| `data/tapes/l1/historian.csv` | L1 PI-narrow process tags (`T1`) | Yes |
| `data/tapes/l2/dirty.txt` | L2 dirty line (`_` = fill from L1) | Yes |
| `data/tapes/l2/dirty.jsonl` | Same event, structured | Yes |
| `data/tapes/generate.py` | Regen the tapes | Yes |
| `data/vlft/process.json` | 19 ops + cycle_s (T1 recipe) | Yes |
| `data/vlft/VFLab.json` | Geometry | Yes |
| `data/asset-map.json` | `RPP1` hero, `T1` sibling | Yes |
| `data/history/work-orders.csv` | CMMS cites (`MTR-07` alias) | Yes |
| `data/cwru/*.mat` | L0 waveforms | **No** — Spark NVMe / HACKPACK |
| SKF PDF | Manual cite | **No** — HACKPACK |

`.mat` is gitignored. Do not commit PMMCP `data/` (CC BY-NC-SA).

Regen tapes:

```
python3 data/tapes/generate.py
```

---

## Two clocks

Do not derive one from the other.

| Clock | Asset | Artifact | Writer does |
| ----- | ----- | -------- | ----------- |
| Condition | `RPP1` / `URjoint1` | L0 JSONL → CWRU `.mat` | Slice `t0..t1`, PMMCP `diagnose`, store 1 Hz RMS/BPFx/rpm |
| Process | `T1` / `T_Machine_Static` | L1 CSV | INSERT as-is. Never diagnose |

T1 never Flags this build. RPP1 Flag = BPFx flip or RMS > baseline+kσ after PMMCP.

---

## Tape clock

From `manifest.json` (`pfa.tape.v1`):

| | |
| - | - |
| `t0` | `2026-09-12T13:50:00.000-04:00` |
| Hop | 1.0 s (1200 hops) |
| Window | 2.0 s |
| Healthy | `t0`–`t0+8 min` → `97.mat` (`X097_DE_time`, 48 kHz) |
| Fault | `t0+8`–`t0+20 min` → `105.mat` (`X105_DE_time`, 12 kHz) |
| `flag_at` | `2026-09-12T13:58:00.000-04:00` (first 105 hop) |
| Quality | `192` = OPC UA Good |

Pre-seed. Do not wait 8 live minutes. Loop + wall-clock are the only synthetic part of the hero tape. Features are real DSP.

CWRU catalog lengths used by the generator (override only if a `.mat` is opened): `97.mat` 243938 samples; `105.mat` 121556. Window `t0` = `(hop * 1 s) % (duration − 2 s)` so every slice fits.

---

## L0 — DAQ drop (`pfa.l0.v1`)

Industry shape: one capture record per hop (drop-folder / PI-to-binary pointer). **No samples in the file.**

`data/tapes/l0/rpp1-de.jsonl` — 1200 lines. One JSON object per hop.

```
ts asset_id part sensor kind unit fs_hz window_s hop_s n_samples quality rpm source t0 t1 file channel
```

Parse: read line `i` as wall-clock `t0 + i s`. Open `data/cwru/{file}`, channel `{channel}`, slice `[t0, t1)`. Call PMMCP. Store RMS (3 sig figs), BPFx Hz (1 decimal), rpm. **Never store `n_samples` of g in sqlite.**

`source` stamp: `cwru:105.mat:X105_DE_time`. Evidence window: `cwru:105.mat:X105_DE_time:0.00..2.00`.

---

## L1 — PI-narrow (`historian.csv`)

Industry shape: OSIsoft / IP.21 export. Columns:

`ts,asset_id,part,tag,value,unit,quality,source`

`data/tapes/l1/historian.csv` — 3600 rows (1200 s × `cycle_s` / `busy` / `job_id`). All `T1`, `source=vlft:process`.

Takt 8 s (jsimIO `Dist.Determ(8)`). `cycle_s` always `2.0`. `busy=1` when `(t % 8) < 2`. `job_id = t // 8 + 1`.

Parse: `INSERT historian(asset_id, tag, ts, value, unit, source)`. Do not call PMMCP.

RPP1 L1 rows are **not** in this CSV. The condition writer creates them from L0 + PMMCP.

---

## L2 — dirty line

`data/tapes/l2/dirty.txt`:

```
RPP1 URjoint1 BPFI _ _ 1797 cwru:105.mat:X105_DE_time:0.00..2.00 none
```

Fields: `asset_id part flag rms_g bpxx_hz rpm source window wo`

`_` = fill from the L1 row just written for that asset. Do not invent RMS or BPFI Hz. Cap 8 lines, ≤400 new tokens. Empty dirty set → cron exits 0.

Structured twin: `data/tapes/l2/dirty.jsonl` (`rms_g` / `bpxx_hz` = null until L1).

---

## Honesty

- VLFT has no vibration. Never feed `cycle_s` into `diagnose`.
- Do not invent RMS from takt. Do not interpolate 97→105 into a wear curve.
- `quality=192` is a status code, not a severity.
- ISO 20816: 2 hp << 15 kW floor — context only, no zone letter.
- Language: `cwru:…` / `vlft:process` — not mock ([CONTEXT.md](CONTEXT.md)).

---

## Writer (not written yet)

IMPLEMENT #2. Reads `manifest.json`, walks L0+L1 in lockstep, Flags at `flag_at`, emits the L2 line with `_` replaced. sqlite schema stays `historian(asset_id, tag, ts, value, unit, source)`.
