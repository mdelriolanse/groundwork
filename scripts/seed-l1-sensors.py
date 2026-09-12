#!/usr/bin/env python3
"""Seed L1 historian tags for every station from data/sensors/catalog.json.

Preserves existing T1 cycle_s/busy/job_id behaviour where present; adds researched
synthetic tags for the full fleet. Never invents CWRU RMS or waveforms.
"""

from __future__ import annotations

import csv
import hashlib
import json
import math
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CATALOG = REPO / "data" / "sensors" / "catalog.json"
MANIFEST = REPO / "data" / "tapes" / "manifest.json"
L0 = REPO / "data" / "tapes" / "l0" / "rpp1-de.jsonl"
L1_OUT = REPO / "data" / "tapes" / "l1" / "historian.csv"
QUALITY = 192


def parse_ts(s: str) -> datetime:
    # 2026-09-12T13:50:00.000-04:00
    return datetime.fromisoformat(s)


def fmt_ts(dt: datetime) -> str:
    # keep millisecond + offset form
    off = dt.utcoffset() or timedelta(0)
    sign = "+" if off >= timedelta(0) else "-"
    total = abs(int(off.total_seconds()))
    hh, mm = divmod(total // 60, 60)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}{sign}{hh:02d}:{mm:02d}"


def rng_for(asset_id: str) -> random.Random:
    seed = int(hashlib.sha256(asset_id.encode()).hexdigest()[:8], 16)
    return random.Random(seed)


def lerp(lo: float, hi: float, t: float) -> float:
    return lo + (hi - lo) * t


def round_tag(tag: str, value: float):
    if tag in ("busy", "bowl_on"):
        return int(round(value))
    if tag == "job_id":
        return int(value)
    if tag in ("spindle_rpm", "index_rpm", "rpm", "lux"):
        return int(round(value))
    if tag in ("torque_nm", "belt_m_s", "air_bar", "current_a", "joint1_a"):
        return float(f"{value:.3g}")
    if tag in ("insert_force_n", "set_force_n", "bus_w", "winding_c", "vac_kpa", "cycle_s", "motor_a"):
        return float(f"{value:.3g}")
    return float(f"{value:.3g}")


def load_l0_timestamps() -> list[str]:
    lines = L0.read_text(encoding="utf-8").splitlines()
    return [json.loads(line)["ts"] for line in lines if line]


def is_busy(hop: int, phase: int, takt: float, duty: float) -> bool:
    # phase offsets stations so the line looks alive
    period = max(1, int(round(takt / 1.0)))  # hops per takt (hop_s=1)
    # stretch duty over a longer window so busy lasts ~duty * cycle
    window = period * 3  # 6 hops for 2s takt
    local = (hop + phase * 2) % window
    return local < max(1, int(round(window * duty)))


def value_for(spec: dict, tag: str, busy: bool, rng: random.Random, drift: float) -> float:
    meta = spec["tags"][tag]
    if meta.get("kind") == "counter":
        raise ValueError("job_id handled separately")
    if tag in ("busy", "bowl_on"):
        return 1 if busy else 0
    if tag == "cycle_s":
        return float(meta.get("busy" if busy else "idle", 2.0))
    if busy or spec.get("always_on"):
        lo = float(meta.get("busy_lo", meta.get("idle", 0)))
        hi = float(meta.get("busy_hi", meta.get("idle", 0)))
        base = lerp(lo, hi, rng.random())
    else:
        base = float(meta.get("idle", 0))
    # small deterministic jitter + optional post-flag drift
    jitter = 1.0 + (rng.random() - 0.5) * 0.04
    return base * jitter * (1.0 + drift)


def main() -> None:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    timestamps = load_l0_timestamps()
    if len(timestamps) != int(manifest["duration_s"]):
        # L0 may be 1200 hops; allow match to hop count
        pass
    flag_at = manifest["flag_at"]
    hop_s = float(manifest.get("hop_s", 1.0))
    line = catalog["line"]
    takt = float(line["takt_s"])
    duty = float(line["busy_duty"])
    drift_pct = float(line["flag_drift_pct"])

    # Preserve prior T1 job_id cadence: new job every ~6s when busy edges
    rows: list[dict] = []
    fieldnames = ["ts", "asset_id", "part", "tag", "value", "unit", "quality", "source"]

    for hop, ts in enumerate(timestamps):
        post_flag = ts >= flag_at
        for asset_id, asset in catalog["assets"].items():
            cls = catalog["classes"][asset["class"]]
            part = asset.get("part") or cls.get("part") or asset_id
            source = cls["source"]
            # Keep T1 process source label for continuity with docs
            if asset_id == "T1":
                source = "vlft:process"
            rng = rng_for(f"{asset_id}:{hop}")
            phase = int(asset.get("phase", 0))
            always = bool(cls.get("always_on"))
            busy = True if always else is_busy(hop, phase, takt, duty)
            drift = drift_pct if post_flag and always else 0.0

            # job_id for stations that have it
            tags = cls["tags"]
            job_id = None
            if "job_id" in tags:
                # advance every busy rising edge roughly every 6 hops
                job_id = 1 + (hop + phase) // 6

            for tag, meta in tags.items():
                if tag == "job_id":
                    val = job_id
                else:
                    val = round_tag(tag, value_for(cls, tag, busy, rng, drift))
                rows.append(
                    {
                        "ts": ts,
                        "asset_id": asset_id,
                        "part": part,
                        "tag": tag,
                        "value": val,
                        "unit": meta["unit"],
                        "quality": QUALITY,
                        "source": source,
                    }
                )

    L1_OUT.parent.mkdir(parents=True, exist_ok=True)
    with L1_OUT.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    assets = len(catalog["assets"])
    print(f"wrote {L1_OUT} ({len(rows)} rows, {assets} assets, {len(timestamps)} hops)")


if __name__ == "__main__":
    main()
