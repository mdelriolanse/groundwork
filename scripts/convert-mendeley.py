#!/usr/bin/env python3
"""Flatten Mendeley LMS Test.Lab .mat structs into PMMCP-loadable single-array .mat files.

Source: "Vibration, Acoustic, Temperature, and Motor Current Dataset of Rotating
Machine Under Varying Load Conditions for Fault Diagnosis" (Mendeley, DOI ztmf3m7h5x).
Each source file is Signal.x_values (increment, number_of_values) / Signal.y_values
(values: N x 4 channels, quantity.label unit) - not CWRU's flat X097_DE_time layout.

PMMCP's own .mat loader (predictive-maintenance-mcp/src/signal_acquisition/repository.py:916-928)
calls scipy.io.loadmat() and takes the first non-dunder numeric array it finds - it does not
require any particular variable name. So the only real conversion work is: flatten the nested
struct to one 1-D float64 array per channel, and carry the fs/rpm/unit metadata PMMCP wants
passed explicitly to load_signal()/diagnose_vibration() (it does not read metadata from the file).

Fixed test condition per the dataset's paper (page 14): motor shaft 1770 rpm, gearbox x2.07,
bearing housing (measurement point) speed = 3010 rpm. That 3010 rpm is what diagnose_vibration
should receive, since the accelerometers are on the bearing housings, not the motor shaft.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import numpy as np
import scipy.io as sio

RPM_BEARING_HOUSING = 3010.0  # gearbox output speed; see module docstring
SIGNAL_UNIT = "g"

NAME_RE = re.compile(
    r"^(?P<load>\d+)Nm_(?P<fault>BPFI|BPFO|Misalign|Unbalance|Normal)(?:_(?P<severity>[\w.]+))?$"
)


def parse_name(stem: str) -> dict:
    m = NAME_RE.match(stem)
    if not m:
        return {"load_nm": None, "fault": None, "severity": None}
    d = m.groupdict()
    return {"load_nm": int(d["load"]), "fault": d["fault"], "severity": d["severity"]}


def load_signal_struct(path: Path) -> tuple[float, np.ndarray, str, float]:
    """Return (fs_hz, data[N,channels], unit_label, unit_factor) from one Mendeley .mat file.

    The file stores raw values in MKS (m/s^2 for acceleration - see quantity_terms:
    LENGTH^1 * TIME^-2) and carries its own unit_transformation.factor to convert to
    the displayed unit label (here 'g'). The label alone is not the stored scale -
    the factor must be applied, or values are 9.80665x too large.
    """
    m = sio.loadmat(str(path), simplify_cells=True)
    sig = m["Signal"]
    fs = 1.0 / sig["x_values"]["increment"]
    data = np.asarray(sig["y_values"]["values"], dtype=np.float64)
    quantity = sig["y_values"]["quantity"]
    unit = quantity["label"]
    factor = float(quantity["unit_transformation"]["factor"])
    return fs, data, unit, factor


def convert_one(src: Path, out_dir: Path, channels: list[int]) -> list[dict]:
    fs, data, unit, factor = load_signal_struct(src)
    if unit != SIGNAL_UNIT:
        raise SystemExit(f"{src.name}: unexpected unit {unit!r}, expected {SIGNAL_UNIT!r}")
    data = data * factor  # raw MKS (m/s^2) -> true g, per the file's own conversion factor
    n_total, n_channels = data.shape
    meta_common = parse_name(src.stem)
    records = []
    for ch in channels:
        if ch >= n_channels:
            raise SystemExit(f"{src.name}: channel {ch} out of range (file has {n_channels})")
        flat = np.ascontiguousarray(data[:, ch], dtype=np.float64)
        out_stem = f"{src.stem}__ch{ch}"
        mat_path = out_dir / f"{out_stem}.mat"
        json_path = out_dir / f"{out_stem}.json"
        sio.savemat(str(mat_path), {"signal": flat})
        record = {
            **meta_common,
            "source_file": src.name,
            "channel_index": ch,
            "n_samples": int(n_total),
            "sampling_rate_hz": fs,
            "duration_s": n_total / fs,
            "signal_unit": SIGNAL_UNIT,
            "rpm": RPM_BEARING_HOUSING,
            "mat_file": mat_path.name,
            "source": f"mendeley:{src.stem}:ch{ch}",
        }
        json_path.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
        records.append(record)
    return records


def verify_pmmcp_extraction(mat_path: Path, expected_len: int) -> None:
    """Replay PMMCP's exact extraction loop (repository.py:916-928) against our output."""
    mat = sio.loadmat(str(mat_path))
    found = None
    for k, v in mat.items():
        if k.startswith("__"):
            continue
        if isinstance(v, np.ndarray):
            candidate = v.flatten()
            if len(candidate) > 0:
                found = candidate.astype(np.float64)
                break
    if found is None:
        raise SystemExit(f"{mat_path}: PMMCP-style extraction found no numeric array")
    if len(found) != expected_len:
        raise SystemExit(
            f"{mat_path}: PMMCP-style extraction got {len(found)} samples, expected {expected_len}"
        )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--src", required=True, type=Path, help="dir of raw Mendeley .mat files")
    ap.add_argument("--out", required=True, type=Path, help="output dir (e.g. runtime/corpus/mendeley)")
    ap.add_argument(
        "--channels",
        default="0",
        help="comma-separated channel indices to extract (0-3). Default: 0 only.",
    )
    ap.add_argument("--verify", action="store_true", help="replay PMMCP's extraction check on each output")
    args = ap.parse_args()

    channels = [int(c) for c in args.channels.split(",")]
    args.out.mkdir(parents=True, exist_ok=True)

    manifest = {
        "schema": "pfa.mendeley.v1",
        "source_doi": "10.17632/ztmf3m7h5x.6",
        "rpm": RPM_BEARING_HOUSING,
        "rpm_note": "bearing-housing speed after 2.07x gearbox step-up from 1770 rpm motor shaft (paper p.14)",
        "signal_unit": SIGNAL_UNIT,
        "channels_extracted": channels,
        "files": [],
    }

    mat_files = sorted(args.src.glob("*.mat"))
    if not mat_files:
        raise SystemExit(f"no .mat files found under {args.src}")

    for src in mat_files:
        records = convert_one(src, args.out, channels)
        for r in records:
            if args.verify:
                verify_pmmcp_extraction(args.out / r["mat_file"], r["n_samples"])
            manifest["files"].append(r)
        print(f"{src.name}: {len(records)} channel(s) -> {args.out}")

    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"\n{len(mat_files)} source files, {len(manifest['files'])} signal files written to {args.out}")
    print(f"manifest: {args.out / 'manifest.json'}")


if __name__ == "__main__":
    main()
