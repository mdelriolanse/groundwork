#!/usr/bin/env python3
"""Bind B1–B4 to unique CWRU healthy normals and persist hop RMS.

Diagnose once at seed (PMMCP if present). Hop loop must not re-diagnose.
Never invent RMS. Belts stay fault=none even if envelope guesses a peak.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts"))

from hop_catalog import BELT_BINDINGS, CATALOG, CONDITION_IDS, FLAG_ASSETS  # noqa: E402

_spec = importlib.util.spec_from_file_location("bpf", REPO / "scripts" / "build-prototype-feed.py")
bpf = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bpf)

CWRU = Path("/home/dell/plant-floor-agent/data/cwru")
if not CWRU.is_dir():
    CWRU = REPO / "data" / "cwru"
FEED = REPO / "web" / "prototype" / "feed.json"
ASSET_MAP = REPO / "data" / "asset-map.json"
WINDOW_S = 2.0
HOP_S = 1.0

MENDELEY_SEED = {
    "PP5": {
        "fault": "inner_race",
        "source": "mendeley:0Nm_BPFI_10__ch0.mat",
        "file": "0Nm_BPFI_10__ch0.mat",
        "window": "0.00..2.00",
        "rms": 1.352,
        "rpm": 3010,
        "engine": "mendeley-seed",
    },
}


def advance_window(n_samples: int, fs: float, hop_i: int) -> tuple[float, float, int, int]:
    win = int(round(WINDOW_S * fs))
    hop = int(round(HOP_S * fs))
    max_start = max(0, n_samples - win)
    start = (hop_i * hop) % (max_start + 1)
    t0 = start / fs
    t1 = t0 + WINDOW_S
    return t0, t1, start, start + win


def seed_belt(asset_id: str, n_hops: int = 20) -> dict:
    fname = BELT_BINDINGS[asset_id]
    entry = CATALOG[fname]
    mat = CWRU / fname
    if not mat.is_file():
        raise FileNotFoundError(mat)
    vec = bpf.load_mat_vector(mat, entry["channel"])
    fs = float(entry["fs_hz"])
    series = []
    for i in range(n_hops):
        t0, t1, i0, i1 = advance_window(len(vec), fs, i)
        rms = bpf.sig3(bpf.rms_of(vec[i0:i1]))
        series.append({"i": i, "window": f"{t0:.2f}..{t1:.2f}", "rms": rms, "t0": t0, "t1": t1})
    t0, t1, i0, i1 = advance_window(len(vec), fs, 0)
    feat = bpf.diagnose_window(vec[i0:i1], fs, entry["rpm"], f"cwru:{fname}")
    engine = feat.get("engine") or "cwru-normal"
    # Persist a real negative. Envelope peaks on a CWRU normal are not a belt flag.
    if engine != "pmmcp":
        engine = "cwru-normal"
    return {
        "binding": {
            "fault": "none",
            "source": f"cwru:{fname}",
            "file": fname,
            "channel": entry["channel"],
            "engine": engine,
            "window": series[0]["window"],
            "rms": series[0]["rms"],
            "rpm": entry["rpm"],
            "fs_hz": fs,
        },
        "series": series,
        "pmmcp": engine == "pmmcp",
        "pmmcp_fault": feat.get("fault"),
    }


def vibration_payload(binding: dict, hop_row: dict | None = None) -> dict:
    row = hop_row or {}
    return {
        "rms": row.get("rms", binding["rms"]),
        "fault": binding["fault"],
        "source": binding["source"],
        "window": row.get("window", binding["window"]),
        "file": binding["file"],
        "channel": binding.get("channel"),
        "engine": binding.get("engine"),
        "rpm": binding.get("rpm"),
    }


def attach_vibration(assets: dict, hop_i: int, bindings: dict, series: dict) -> dict:
    out = dict(assets or {})
    for asset_id, binding in bindings.items():
        slot = dict(out.get(asset_id) or {})
        hops = series.get(asset_id) or []
        row = hops[hop_i] if hop_i < len(hops) else (hops[-1] if hops else None)
        slot["vibration"] = vibration_payload(binding, row)
        if row and row.get("rms") is not None:
            slot["rms"] = row["rms"]
            slot["window"] = row["window"]
            slot["file"] = binding["file"]
            slot["fault"] = binding["fault"]
        out[asset_id] = slot
    return out


def patch_feed(feed: dict) -> dict:
    amap = json.loads(ASSET_MAP.read_text(encoding="utf-8"))
    by_id = {a["asset_id"]: a for a in amap["assets"]}
    for row in feed.get("fleet") or []:
        src = by_id.get(row["asset_id"])
        if not src:
            continue
        row["role"] = src["role"]
        row["source"] = src["source"]
        row["part"] = src["part"]
        if src.get("aliases"):
            row["aliases"] = src["aliases"]

    n_hops = len(feed.get("hops") or [])
    belt_seeds = {aid: seed_belt(aid, n_hops or 20) for aid in BELT_BINDINGS}
    bindings = {aid: seed["binding"] for aid, seed in belt_seeds.items()}
    series = {aid: seed["series"] for aid, seed in belt_seeds.items()}
    for aid, seed in MENDELEY_SEED.items():
        bindings[aid] = dict(seed)
        series[aid] = [
            {"i": i, "window": seed["window"], "rms": seed["rms"]}
            for i in range(n_hops or 20)
        ]

    for hop in feed.get("hops") or []:
        hop["assets"] = attach_vibration(hop.get("assets") or {}, hop.get("i") or 0, bindings, series)

    pmmcp_any = any(s["pmmcp"] for s in belt_seeds.values())
    feed["condition"] = {
        "motors": list(CONDITION_IDS),
        "flag_assets": list(FLAG_ASSETS),
        "belts": list(BELT_BINDINGS),
        "bindings": bindings,
        "iso": "context only — all 6 << 15 kW (iso20816.py:294)",
        "honesty": (
            "B1–B4 persist fault=none from cited CWRU normals 97–100.mat. "
            "Hop loop writes RMS only. Flags stay on RPP1 / PP5. "
            + ("Seed diagnose via PMMCP." if pmmcp_any else "PMMCP not invoked on this host; fault=none cited as CWRU normal.")
        ),
        "pmmcp_invoked": pmmcp_any,
    }
    if feed.get("manifest"):
        feed["manifest"]["honesty"] = (
            "L1 scalars from CWRU windows for RPP1 and B1–B4. "
            "PP5 cites Mendeley. Fleet process tags are synthetic. "
            "Only RPP1 / PP5 may flag. No ISO zone letters."
        )
    return feed


def main() -> None:
    feed = json.loads(FEED.read_text(encoding="utf-8"))
    patch_feed(feed)
    FEED.write_text(json.dumps(feed, indent=2) + "\n", encoding="utf-8")
    cond = feed["condition"]
    print(
        f"wrote {FEED} belts={list(BELT_BINDINGS)} pmmcp={cond['pmmcp_invoked']} "
        + " ".join(f"{k}:{cond['bindings'][k]['rms']}" for k in BELT_BINDINGS)
    )


if __name__ == "__main__":
    main()
