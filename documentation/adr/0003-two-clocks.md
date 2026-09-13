# Two clocks: VLFT process, CWRU condition

VFLab in-repo is geometry. CWRU is a 10 s snapshot, not a hinge-line run. Mixing them into one RMS series would invent a waveform.

**Decision.** One historian table, two producers. Do not derive one clock from the other.

| Clock | Asset | Tags | Source stamp | Wakes a Flag? |
| ----- | ----- | ---- | ------------ | ------------- |
| Process | `T1` | `cycle_s`, `busy`, `job_id` | `vlft:process` | No (this build) |
| Condition | `RPP1` / `URjoint1` | `rms`, BPFx, `rpm` | `cwru:97.mat` then `cwru:105.mat` | Yes |

Process table: [data/vlft/process.json](../../data/vlft/process.json) — 19 published ops. Cycle seconds are jsimIO `Dist.Determ` or `VFLab_anim.json` dwell/pulse. xlsx `taskTime` is empty; do not fill it. DES parameters, not measured OT.

Condition tape: PRD §4.1. Loop-replay `97.mat` then `105.mat`. 2.0 s window, 1.0 s hop, 1 Hz rows. Pre-seed sqlite — do not wait 8 live minutes. Loop + wall-clock are the only synthetic part; features are real DSP.

Never feed `cycle_s` into PMMCP `diagnose`. Never invent RMS from takt. Kalman/RUL only if we later hand PMMCP the CWRU feature history — skip this build.

**Rejected.** Process-as-the-story (kills the `.mat` cite). Playing `VFLab_anim.json` on the Twin (motion txt pack; static GLBs stay).

Supersedes “T1 is `synthetic:healthy` with an empty tape.”
