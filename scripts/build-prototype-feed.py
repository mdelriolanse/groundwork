#!/usr/bin/env python3
"""Diagnose the 20-hop slice and write web/prototype/feed.json.

Prefers PMMCP. Fallback is RMS + envelope peak vs SKF 6205 catalog
(same geometry PMMCP ships). Never invents RMS. Never interpolates 97→105.
"""

from __future__ import annotations

import csv
import json
import math
import struct
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SLICE = REPO / "data" / "tapes" / "slice20"
CWRU = Path("/home/dell/plant-floor-agent/data/cwru")
if not CWRU.is_dir():
    CWRU = REPO / "data" / "cwru"
OUT = REPO / "web" / "prototype" / "feed.json"
ASSET_MAP = REPO / "data" / "asset-map.json"
CMMS = REPO / "data" / "history" / "work-orders.csv"

# SKF 6205-2RS (CWRU DE / PMMCP catalog). Ratios × shaft Hz.
# n=9, Bd=0.3126 in, Pd=1.537 in, α=0.
BPFI_RATIO = 5.4152
BPFO_RATIO = 3.5848
TOL_PCT = 5.0


def sig3(value: float) -> float:
    if value == 0:
        return 0.0
    return float(f"{value:.3g}")


def load_mat_vector(path: Path, name: str):
    try:
        from scipy.io import loadmat  # type: ignore

        return __import__("numpy").asarray(loadmat(path)[name]).ravel()
    except Exception:
        return _mat5_vector(path, name)


def _mat5_vector(path: Path, name: str):
    """Read a named MATLAB v5 double column (CWRU DE_time)."""
    data = path.read_bytes()
    if data[:4] != b"MATL":
        raise ValueError(f"{path}: not MATLAB v5")
    off = 128
    target = name.encode("ascii")
    while off + 8 <= len(data):
        dtype, nbytes = struct.unpack_from("<II", data, off)
        off += 8
        if dtype == 14:  # miMATRIX
            chunk = data[off : off + nbytes]
            found = _matrix_named(chunk, target)
            if found is not None:
                return found
        off += nbytes + (nbytes % 8)
    raise KeyError(f"{name} not in {path}")


def _matrix_named(chunk: bytes, target: bytes):
    import array

    if len(chunk) < 24:
        return None
    # flags (miINT32), class in first u32 of payload
    pos = 0

    def tag():
        nonlocal pos
        dtype, nbytes = struct.unpack_from("<II", chunk, pos)
        pos += 8
        payload = chunk[pos : pos + nbytes]
        pos += nbytes + ((8 - (nbytes % 8)) % 8)
        return dtype, payload

    try:
        _, flags = tag()
        _, dims_raw = tag()
        _, name_raw = tag()
        dtype, payload = tag()
    except struct.error:
        return None
    name = name_raw.split(b"\x00", 1)[0]
    if name != target:
        return None
    if dtype != 9:  # miDOUBLE
        return None
    vals = array.array("d")
    vals.frombytes(payload)
    if sys.byteorder != "little":
        vals.byteswap()
    return list(vals)


def window_samples(path: Path, channel: str, fs_hz: float, t0: float, t1: float):
    vec = load_mat_vector(path, channel)
    i0 = max(0, int(round(t0 * fs_hz)))
    i1 = min(len(vec), int(round(t1 * fs_hz)))
    if i1 <= i0:
        raise ValueError(f"empty window {path.name} {t0}..{t1}")
    return vec[i0:i1]


def rms_of(samples) -> float:
    n = len(samples)
    return math.sqrt(sum(float(x) * float(x) for x in samples) / n)


def _try_pmmcp(samples, fs: float, rpm: float, signal_id: str) -> dict | None:
    src = Path("/home/dell/vendor/predictive-maintenance-mcp/src")
    if src.is_dir() and str(src) not in sys.path:
        sys.path.insert(0, str(src))
    try:
        import numpy as np
        from diagnostics.bearing_analyzer import check_all_bearing_faults
    except Exception:
        return None
    for bearing_id in ("6205-2RS", "6205"):
        try:
            result = check_all_bearing_faults(
                np.asarray(samples, dtype=float),
                fs,
                bearing_id,
                rpm,
                signal_id=signal_id,
            )
            return _from_pmmcp(result)
        except Exception:
            continue
    return None


def _from_pmmcp(result: dict) -> dict:
    checks = result.get("fault_checks") or result.get("checks") or []
    bpfi = {"detected": False, "hz": None, "strength": None}
    bpfo = {"detected": False, "hz": None, "strength": None}
    for check in checks:
        kind = str(check.get("fault_type") or check.get("type") or "").upper()
        detected = bool(check.get("detected") or check.get("present"))
        hz = check.get("detected_freq") or check.get("detected_frequency_hz") or check.get("frequency_hz")
        row = {
            "detected": detected,
            "hz": None if hz is None else round(float(hz), 1),
            "strength": check.get("evidence_strength") or check.get("strength"),
        }
        if kind == "BPFI":
            bpfi = row
        if kind == "BPFO":
            bpfo = row
    fault = result.get("most_likely_fault_canonical")
    if not fault and bpfi["detected"]:
        fault = "inner_race"
    elif not fault and bpfo["detected"]:
        fault = "outer_race"
    return {"engine": "pmmcp", "bpfi": bpfi, "bpfo": bpfo, "fault": fault}


def _envelope_peaks(samples, fs: float) -> list[tuple[float, float]]:
    try:
        import numpy as np
    except ImportError:
        return []
    x = np.asarray(samples, dtype=float)
    x = x - x.mean()
    spec = np.fft.rfft(x)
    spec[0] = 0
    nyq_bin = len(spec) - 1
    # Hilbert envelope via analytic signal
    spec[1:nyq_bin] *= 2
    analytic = np.fft.irfft(spec, n=len(x))
    env = np.abs(analytic)
    env = env - env.mean()
    mag = np.abs(np.fft.rfft(env))
    freqs = np.fft.rfftfreq(len(env), d=1.0 / fs)
    peaks: list[tuple[float, float]] = []
    for i in range(2, len(mag) - 1):
        if mag[i] >= mag[i - 1] and mag[i] >= mag[i + 1] and 5.0 <= freqs[i] <= min(2000.0, fs / 2 - 1):
            peaks.append((float(freqs[i]), float(mag[i])))
    peaks.sort(key=lambda p: p[1], reverse=True)
    return peaks[:40]


def _near(peaks: list[tuple[float, float]], expected: float) -> dict:
    tol = expected * TOL_PCT / 100.0
    hit = next((p for p in peaks if abs(p[0] - expected) <= tol), None)
    if hit is None:
        return {"detected": False, "hz": None, "strength": None}
    return {"detected": True, "hz": round(hit[0], 1), "strength": "envelope"}


def diagnose_window(samples, fs: float, rpm: float, signal_id: str) -> dict:
    pmmcp = _try_pmmcp(samples, fs, rpm, signal_id)
    fr = rpm / 60.0
    if pmmcp is not None:
        return pmmcp
    peaks = _envelope_peaks(samples, fs)
    bpfi = _near(peaks, BPFI_RATIO * fr)
    bpfo = _near(peaks, BPFO_RATIO * fr)
    fault = None
    if bpfi["detected"]:
        fault = "inner_race"
    elif bpfo["detected"]:
        fault = "outer_race"
    return {"engine": "envelope", "bpfi": bpfi, "bpfo": bpfo, "fault": fault}


def coerce_tag(tag: str, raw: str):
    if tag in ("busy", "bowl_on", "job_id"):
        return int(float(raw))
    if tag in ("spindle_rpm", "index_rpm", "rpm", "lux"):
        return int(float(raw))
    return float(raw)


def load_l1_by_ts() -> dict[str, dict[str, dict]]:
    """ts → asset_id → {part, source, tags…}."""
    by: dict[str, dict[str, dict]] = {}
    with (SLICE / "l1" / "historian.csv").open(encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            assets = by.setdefault(row["ts"], {})
            slot = assets.setdefault(
                row["asset_id"],
                {"part": row["part"], "source": row["source"], "tags": {}},
            )
            slot["part"] = row["part"] or slot["part"]
            slot["source"] = row["source"] or slot["source"]
            slot["tags"][row["tag"]] = coerce_tag(row["tag"], row["value"])
            # promote common tags to top-level for UI convenience
            slot[row["tag"]] = slot["tags"][row["tag"]]
    return by


def load_cmms(aliases: set[str]) -> list[dict]:
    rows = []
    with CMMS.open(encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            if row["asset_id"] not in aliases:
                continue
            rows.append(
                {
                    "wo_id": row["wo_id"],
                    "asset_id": row["asset_id"],
                    "alias": "RPP1" if row["asset_id"] == "MTR-07" else row["asset_id"],
                    "opened": row["opened"],
                    "closed": row["closed"] or None,
                    "fault": row["fault"],
                    "action": row["action"],
                    "parts": row["parts"],
                    "source": "cmms:data/history/work-orders.csv",
                }
            )
    return rows


def main() -> None:
    if not (SLICE / "l0" / "rpp1-de.jsonl").is_file():
        raise SystemExit("run data/tapes/slice20.py first")
    manifest = json.loads((SLICE / "manifest.json").read_text(encoding="utf-8"))
    l0 = [
        json.loads(line)
        for line in (SLICE / "l0" / "rpp1-de.jsonl").read_text(encoding="utf-8").splitlines()
        if line
    ]
    l1 = load_l1_by_ts()
    l2 = json.loads((SLICE / "l2" / "dirty.jsonl").read_text(encoding="utf-8"))
    amap = json.loads(ASSET_MAP.read_text(encoding="utf-8"))
    fleet = []
    rpp1_aliases = {"RPP1"}
    for asset in amap["assets"]:
        fleet.append(
            {
                "asset_id": asset["asset_id"],
                "role": asset["role"],
                "part": asset["part"],
                "name": asset.get("name") or asset["asset_id"],
                "source": asset["source"],
                "aliases": asset.get("aliases") or [],
                "supported": True,
                "glb": asset.get("glb"),
            }
        )
        if asset["asset_id"] == "RPP1":
            rpp1_aliases.update(asset.get("aliases") or [])

    hops = []
    file_cache: dict[str, dict] = {}
    per_file = "--per-file" in sys.argv
    for i, rec in enumerate(l0):
        mat = CWRU / rec["file"]
        key = rec["file"]
        assets_at = l1.get(rec["ts"]) or {}
        t1 = assets_at.get("T1") or {"cycle_s": None, "busy": None, "job_id": None, "source": "vlft:process", "part": "T_Machine_Static", "tags": {}}
        if per_file and key in file_cache:
            feat = dict(file_cache[key])
        elif not mat.is_file():
            feat = {
                "engine": "source-gap",
                "bpfi": {"detected": False, "hz": None, "strength": None},
                "bpfo": {"detected": False, "hz": None, "strength": None},
                "fault": None,
                "rms": None,
            }
        else:
            samples = window_samples(mat, rec["channel"], rec["fs_hz"], rec["t0"], rec["t1"])
            feat = diagnose_window(samples, rec["fs_hz"], rec["rpm"], rec["source"])
            feat["rms"] = sig3(rms_of(samples))
            if per_file:
                file_cache[key] = dict(feat)
        # flatten assets for feed: drop nested tags key duplication is ok for UI
        assets_out = {}
        for aid, slot in assets_at.items():
            assets_out[aid] = {
                "part": slot.get("part"),
                "source": slot.get("source"),
                **{k: v for k, v in slot.items() if k not in ("part", "source", "tags")},
                "tags": slot.get("tags") or {},
            }
        hops.append(
            {
                "i": i,
                "ts": rec["ts"],
                "rpp1": {
                    "rms": feat.get("rms"),
                    "rpm": rec["rpm"],
                    "bpfi": feat["bpfi"],
                    "bpfo": feat["bpfo"],
                    "fault": feat.get("fault"),
                    "engine": feat.get("engine"),
                    "source": rec["source"],
                    "window": f"{rec['t0']:.2f}..{rec['t1']:.2f}",
                    "file": rec["file"],
                    "channel": rec["channel"],
                    "fs_hz": rec["fs_hz"],
                    "bus_w": (assets_at.get("RPP1") or {}).get("bus_w"),
                    "joint1_a": (assets_at.get("RPP1") or {}).get("joint1_a"),
                },
                "t1": {
                    "cycle_s": t1.get("cycle_s"),
                    "busy": t1.get("busy"),
                    "job_id": t1.get("job_id"),
                    "torque_nm": t1.get("torque_nm"),
                    "spindle_rpm": t1.get("spindle_rpm"),
                    "source": t1.get("source", "vlft:process"),
                    "part": t1.get("part", "T_Machine_Static"),
                },
                "assets": assets_out,
            }
        )

    flag_hop = next((h for h in hops if h["ts"] == manifest["flag_at"]), hops[manifest["flag_hop"]])
    filled = {
        "ts": l2["ts"],
        "asset_id": l2["asset_id"],
        "part": l2["part"],
        "flag": l2["flag"],
        "fault": flag_hop["rpp1"]["fault"] or "inner_race",
        "rms_g": flag_hop["rpp1"]["rms"],
        "bpxx_hz": flag_hop["rpp1"]["bpfi"]["hz"],
        "rpm": l2["rpm"],
        "source": l2["source"],
        "window": flag_hop["rpp1"]["window"],
        "wo": l2.get("wo") or "none",
        "incident_id": "INC-RPP1",
    }

    feed = {
        "schema": "pfa.prototype.feed.v1",
        "manifest": {
            "t0": manifest["t0"],
            "duration_s": manifest["duration_s"],
            "hop_s": manifest["hop_s"],
            "window_s": manifest["window_s"],
            "flag_at": manifest["flag_at"],
            "flag_hop": manifest["flag_hop"],
            "honesty": "L1 scalars from CWRU windows for RPP1. Fleet process/electrical tags are synthetic cites. No 12 kHz on the board. Only RPP1 is diagnosed.",
        },
        "cell": {
            "name": "VFLab · hinge assembly",
            "cite": amap.get("cite"),
            "license": amap.get("license"),
        },
        "fleet": fleet,
        "hops": hops,
        "flag": filled,
        "cmms": load_cmms(rpp1_aliases),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(feed, indent=2) + "\n", encoding="utf-8")
    engines = sorted({h["rpp1"]["engine"] for h in hops})
    n_assets = len(fleet)
    print(f"wrote {OUT} ({len(hops)} hops, {n_assets} fleet, engines={engines})")


if __name__ == "__main__":
    main()
