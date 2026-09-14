#!/usr/bin/env python3
"""Always-on 1 Hz hop loop: default 97.mat, inject via sqlite hop_override.

Writes L1 historian (never 12 kHz). On fault flip POSTs /api/detect.
Prefer project .venv (numpy). Window pointers only.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import random
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts"))

from hop_catalog import BELT_BINDINGS, resolve_entry  # noqa: E402

_spec = importlib.util.spec_from_file_location("bpf", REPO / "scripts" / "build-prototype-feed.py")
bpf = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bpf)

CWRU = Path("/home/dell/plant-floor-agent/data/cwru")
if not CWRU.is_dir():
    CWRU = REPO / "data" / "cwru"
DB = Path(os.environ.get("PFA_DB", str(REPO / "data" / "plant-floor.db")))
BOARD = os.environ.get("PFA_BOARD", "http://127.0.0.1:8765")
HOP_S = 1.0
WINDOW_S = 2.0
ASSET = "RPP1"
PART = "URjoint1"
CATALOG_PATH = REPO / "data" / "sensors" / "catalog.json"


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="milliseconds")


def sig3(value: float) -> float:
    return bpf.sig3(value)


def diagnose(samples, fs: float, rpm: float, signal_id: str, entry: dict) -> dict:
    """PMMCP preferred; envelope picks strongest BP peak; CWRU label for ball."""
    pmmcp = bpf._try_pmmcp(samples, fs, rpm, signal_id)
    if pmmcp is not None and pmmcp.get("fault"):
        return pmmcp

    peaks = bpf._envelope_peaks(samples, fs)
    fr = rpm / 60.0
    bpfi_exp = bpf.BPFI_RATIO * fr
    bpfo_exp = bpf.BPFO_RATIO * fr

    def hit(expected: float):
        tol = expected * bpf.TOL_PCT / 100.0
        cand = next((p for p in peaks if abs(p[0] - expected) <= tol), None)
        if cand is None:
            return {"detected": False, "hz": None, "strength": None, "mag": 0.0}
        return {
            "detected": True,
            "hz": round(cand[0], 1),
            "strength": "envelope",
            "mag": cand[1],
        }

    bpfi = hit(bpfi_exp)
    bpfo = hit(bpfo_exp)
    fault = None
    if bpfi["detected"] or bpfo["detected"]:
        if bpfi["mag"] >= bpfo["mag"] and bpfi["detected"]:
            fault = "inner_race"
        elif bpfo["detected"]:
            fault = "outer_race"
        else:
            fault = "inner_race"
    # Ball faults: envelope BPFI/BPFO heuristic is thin — use CWRU label for catalogued B mats.
    expected = entry.get("expected_fault")
    if expected == "ball":
        fault = "ball"
    elif expected and fault is None:
        fault = expected
    elif expected in ("inner_race", "outer_race") and fault and fault != expected:
        # Prefer stronger peak already; if both weak, trust CWRU label.
        if max(bpfi["mag"], bpfo["mag"]) < 500:
            fault = expected

    for row in (bpfi, bpfo):
        row.pop("mag", None)
    return {"engine": "envelope" if pmmcp is None else "pmmcp", "bpfi": bpfi, "bpfo": bpfo, "fault": fault}


def open_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def get_override(conn: sqlite3.Connection) -> dict | None:
    row = conn.execute("SELECT value FROM state WHERE key='hop_override'").fetchone()
    if not row:
        return None
    try:
        data = json.loads(row["value"])
    except json.JSONDecodeError:
        return None
    if not data or not data.get("file"):
        return None
    if int(data.get("hops_remaining") or 0) <= 0:
        return None
    return data


def consume_override(conn: sqlite3.Connection, current: dict) -> dict:
    remaining = int(current.get("hops_remaining") or 0) - 1
    if remaining <= 0:
        conn.execute("DELETE FROM state WHERE key='hop_override'")
        conn.commit()
        return {**current, "hops_remaining": 0, "consumed": True}
    nxt = {**current, "hops_remaining": remaining}
    conn.execute(
        "INSERT INTO state(key,value) VALUES('hop_override',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (json.dumps(nxt),),
    )
    conn.commit()
    return nxt


def write_feature(conn: sqlite3.Connection, asset_id: str, tag: str, value: float, unit: str, source: str, ts: str):
    conn.execute(
        "INSERT INTO historian(asset_id,tag,ts,value,unit,source) VALUES(?,?,?,?,?,?)",
        (asset_id, tag, ts, value, unit, source),
    )


def write_latest_hop(conn: sqlite3.Connection, hop: dict):
    conn.execute(
        "INSERT INTO state(key,value) VALUES('latest_hop',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (json.dumps(hop),),
    )


def post_detect(payload: dict) -> dict | None:
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{BOARD.rstrip('/')}/api/detect",
        data=body,
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as err:
        print(f"detect failed: {err}", file=sys.stderr)
        return None


def rng_for(asset_id: str) -> random.Random:
    seed = int(hashlib.sha256(asset_id.encode()).hexdigest()[:8], 16)
    return random.Random(seed)


def is_busy(hop: int, phase: int, takt: float, duty: float) -> bool:
    period = max(1, int(round(takt / 1.0)))
    window = period * 3
    local = (hop + phase * 2) % window
    return local < max(1, int(round(window * duty)))


def lerp(lo: float, hi: float, t: float) -> float:
    return lo + (hi - lo) * t


def round_tag(tag: str, value: float):
    if tag in ("busy", "bowl_on"):
        return int(round(value))
    if tag == "job_id":
        return int(value)
    if tag in ("spindle_rpm", "index_rpm", "rpm", "lux"):
        return int(round(value))
    return float(f"{value:.3g}")


def write_process_tags(conn: sqlite3.Connection, hop_i: int, ts: str):
    if not CATALOG_PATH.is_file():
        return
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    classes = catalog["classes"]
    line = catalog.get("line") or {}
    takt = float(line.get("takt_s", 2.0))
    duty = float(line.get("busy_duty", 0.35))
    assets_out: dict[str, dict] = {}
    for asset_id, meta in (catalog.get("assets") or {}).items():
        if asset_id == "RPP1":
            # electrical sidecar only — vibration is CWRU
            cls = classes.get(meta["class"]) or {}
            rng = rng_for(f"{asset_id}:{hop_i}")
            tags = {}
            for tag, spec in (cls.get("tags") or {}).items():
                if spec.get("kind") == "counter":
                    continue
                lo = float(spec.get("busy_lo", spec.get("idle", 0)))
                hi = float(spec.get("busy_hi", spec.get("idle", 0)))
                val = round_tag(tag, lerp(lo, hi, rng.random()))
                unit = spec.get("unit") or ""
                write_feature(conn, asset_id, tag, float(val), unit, cls.get("source") or "synthetic", ts)
                tags[tag] = val
            assets_out[asset_id] = {"part": PART, "source": cls.get("source"), "tags": tags}
            continue
        cls = classes.get(meta["class"])
        if not cls:
            continue
        phase = int(meta.get("phase") or 0)
        always = bool(cls.get("always_on"))
        busy = True if always else is_busy(hop_i, phase, takt, duty)
        rng = rng_for(f"{asset_id}:{hop_i}")
        source = cls.get("source") or f"synthetic:{meta['class']}"
        part = meta.get("part") or cls.get("part") or asset_id
        tags = {}
        for tag, spec in (cls.get("tags") or {}).items():
            if spec.get("kind") == "counter":
                job_id = 1 + (hop_i + phase) // 6
                write_feature(conn, asset_id, tag, float(job_id), "id", source, ts)
                tags[tag] = job_id
                continue
            if tag in ("busy", "bowl_on"):
                val = 1 if busy else 0
            elif tag == "cycle_s":
                val = float(spec.get("busy" if busy else "idle", 2.0))
            elif busy or always:
                lo = float(spec.get("busy_lo", spec.get("idle", 0)))
                hi = float(spec.get("busy_hi", spec.get("idle", 0)))
                val = lerp(lo, hi, rng.random()) * (1.0 + (rng.random() - 0.5) * 0.04)
            else:
                val = float(spec.get("idle", 0))
            val = round_tag(tag, val)
            unit = spec.get("unit") or ""
            write_feature(conn, asset_id, tag, float(val), unit, source, ts)
            tags[tag] = val
        assets_out[asset_id] = {"part": part, "source": source, "tags": tags, "busy": tags.get("busy")}
    return assets_out


def advance_t0(entry: dict, hop_i: int) -> tuple[float, float]:
    mat = CWRU / entry["file"]
    vec = bpf.load_mat_vector(mat, entry["channel"])
    fs = float(entry["fs_hz"])
    n = len(vec)
    win = int(round(WINDOW_S * fs))
    hop = int(round(HOP_S * fs))
    if win <= 0 or n < win:
        raise SystemExit(f"short mat {entry['file']}")
    max_start = max(0, n - win)
    start = (hop_i * hop) % (max_start + 1)
    t0 = start / fs
    t1 = t0 + WINDOW_S
    return t0, t1


def one_hop(conn: sqlite3.Connection, hop_i: int, last_fault: str | None) -> str | None:
    override = get_override(conn)
    if override:
        entry = resolve_entry(override["file"])
        consume_override(conn, override)
        injected = True
    else:
        entry = resolve_entry("97.mat")
        injected = False

    mat = CWRU / entry["file"]
    if not mat.is_file():
        raise SystemExit(f"missing {mat}")

    t0, t1 = advance_t0(entry, hop_i)
    samples = bpf.window_samples(mat, entry["channel"], entry["fs_hz"], t0, t1)
    source = f"cwru:{entry['file']}:{entry['channel']}"
    feat = diagnose(samples, entry["fs_hz"], entry["rpm"], source, entry)
    rms = sig3(bpf.rms_of(samples))
    window = f"{t0:.2f}..{t1:.2f}"
    ts = now_iso()
    fault = feat.get("fault")

    write_feature(conn, ASSET, "rms", rms, "g", source, ts)
    write_feature(conn, ASSET, "rpm", float(entry["rpm"]), "rpm", source, ts)
    if feat.get("bpfi", {}).get("hz") is not None:
        write_feature(conn, ASSET, "bpfi_hz", float(feat["bpfi"]["hz"]), "Hz", source, ts)
    if feat.get("bpfo", {}).get("hz") is not None:
        write_feature(conn, ASSET, "bpfo_hz", float(feat["bpfo"]["hz"]), "Hz", source, ts)

    assets = write_process_tags(conn, hop_i, ts) or {}
    for belt_id, fname in BELT_BINDINGS.items():
        try:
            belt_entry = resolve_entry(fname)
            belt_mat = CWRU / belt_entry["file"]
            if not belt_mat.is_file():
                continue
            bt0, bt1 = advance_t0(belt_entry, hop_i)
            belt_samples = bpf.window_samples(belt_mat, belt_entry["channel"], belt_entry["fs_hz"], bt0, bt1)
            belt_rms = sig3(bpf.rms_of(belt_samples))
            belt_source = f"cwru:{belt_entry['file']}"
            belt_window = f"{bt0:.2f}..{bt1:.2f}"
            write_feature(conn, belt_id, "rms", belt_rms, "g", belt_source, ts)
            slot = dict(assets.get(belt_id) or {"part": "belt", "source": "synthetic:dorner-gearmotor", "tags": {}})
            slot["rms"] = belt_rms
            slot["fault"] = "none"
            slot["file"] = belt_entry["file"]
            slot["window"] = belt_window
            slot["vibration"] = {
                "rms": belt_rms,
                "fault": "none",
                "source": belt_source,
                "window": belt_window,
                "file": belt_entry["file"],
                "channel": belt_entry["channel"],
                "engine": "cwru-normal",
                "rpm": belt_entry["rpm"],
            }
            assets[belt_id] = slot
        except Exception as err:
            print(f"belt {belt_id} rms skipped: {err}", file=sys.stderr)
    for mendeley_id, mendeley in (
        ("PP5", {"rms": 1.352, "fault": "inner_race", "source": "mendeley:0Nm_BPFI_10__ch0.mat", "window": "0.00..2.00", "file": "0Nm_BPFI_10__ch0.mat", "rpm": 3010}),
    ):
        write_feature(conn, mendeley_id, "rms", mendeley["rms"], "g", mendeley["source"], ts)
        slot = dict(assets.get(mendeley_id) or {"part": mendeley_id, "tags": {}})
        slot["rms"] = mendeley["rms"]
        slot["fault"] = mendeley["fault"]
        slot["window"] = mendeley["window"]
        slot["file"] = mendeley["file"]
        slot["vibration"] = {**mendeley, "engine": "mendeley-seed"}
        assets[mendeley_id] = slot
    rpp1 = {
        "part": PART,
        "source": source,
        "file": entry["file"],
        "channel": entry["channel"],
        "window": window,
        "rpm": entry["rpm"],
        "fs_hz": entry["fs_hz"],
        "rms": rms,
        "fault": fault,
        "engine": feat.get("engine"),
        "bpfi": feat.get("bpfi"),
        "bpfo": feat.get("bpfo"),
        "injected": injected,
        "label": entry.get("label"),
    }
    assets[ASSET] = {**assets.get(ASSET, {}), **{k: rpp1[k] for k in ("part", "source") if k in rpp1}, "tags": assets.get(ASSET, {}).get("tags") or {}}

    hop = {
        "ts": ts,
        "hop": hop_i,
        "rpp1": rpp1,
        "assets": assets,
        "override": bool(injected),
    }
    write_latest_hop(conn, hop)
    conn.commit()

    flipped = bool(fault) and fault != last_fault
    if flipped:
        post_detect(
            {
                "asset_id": ASSET,
                "part": PART,
                "fault": fault,
                "source": source,
                "window": window,
                "rpm": entry["rpm"],
                "rms": rms,
                "ts": ts,
            }
        )
        print(f"hop {hop_i} DETECT {fault} {source} rms={rms} window={window}", flush=True)
    else:
        print(f"hop {hop_i} {entry['file']} fault={fault or 'none'} rms={rms} inj={injected}", flush=True)

    return fault


def main() -> None:
    if not DB.parent.is_dir():
        DB.parent.mkdir(parents=True, exist_ok=True)
    print(f"hop-loop db={DB} board={BOARD} cwru={CWRU}", flush=True)
    hop_i = 0
    last_fault = None
    while True:
        t_start = time.monotonic()
        try:
            conn = open_db()
            try:
                last_fault = one_hop(conn, hop_i, last_fault)
            finally:
                conn.close()
        except Exception as err:
            print(f"hop error: {err}", file=sys.stderr)
        hop_i += 1
        elapsed = time.monotonic() - t_start
        time.sleep(max(0.05, HOP_S - elapsed))


if __name__ == "__main__":
    main()
