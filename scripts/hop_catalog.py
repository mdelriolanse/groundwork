"""Shared CWRU hop inject catalog. Window pointers only — no invented RMS."""

from __future__ import annotations

# fs_hz: CWRU normals 97–100 are 48 kHz; faulted DE mats are 12 kHz.
CATALOG: dict[str, dict] = {
    "97.mat": {
        "key": "clear",
        "file": "97.mat",
        "channel": "X097_DE_time",
        "fs_hz": 48000.0,
        "rpm": 1797.0,
        "expected_fault": None,
        "label": "normal",
    },
    "105.mat": {
        "key": "ir",
        "file": "105.mat",
        "channel": "X105_DE_time",
        "fs_hz": 12000.0,
        "rpm": 1797.0,
        "expected_fault": "inner_race",
        "label": "IR007",
    },
    "118.mat": {
        "key": "ball",
        "file": "118.mat",
        "channel": "X118_DE_time",
        "fs_hz": 12000.0,
        "rpm": 1797.0,
        "expected_fault": "ball",
        "label": "B007",
    },
    "130.mat": {
        "key": "or",
        "file": "130.mat",
        "channel": "X130_DE_time",
        "fs_hz": 12000.0,
        "rpm": 1797.0,
        "expected_fault": "outer_race",
        "label": "OR007",
    },
}

KEY_TO_FILE = {
    "clear": "97.mat",
    "ir": "105.mat",
    "ball": "118.mat",
    "or": "130.mat",
    "97": "97.mat",
    "105": "105.mat",
    "118": "118.mat",
    "130": "130.mat",
}


def resolve_entry(source: str) -> dict:
    """Accept key, bare filename, or cwru:NNN.mat."""
    raw = (source or "").strip()
    if raw.startswith("cwru:"):
        raw = raw[5:]
    raw = raw.removeprefix("./")
    if raw in KEY_TO_FILE:
        raw = KEY_TO_FILE[raw]
    if not raw.endswith(".mat"):
        raw = f"{raw}.mat"
    if raw not in CATALOG:
        raise KeyError(f"unknown hop source {source!r}; allow {sorted(CATALOG)}")
    return dict(CATALOG[raw])
