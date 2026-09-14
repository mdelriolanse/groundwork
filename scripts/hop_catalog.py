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
    "98.mat": {
        "key": "clear_1hp",
        "file": "98.mat",
        "channel": "X098_DE_time",
        "fs_hz": 48000.0,
        "rpm": 1772.0,
        "expected_fault": None,
        "label": "normal",
    },
    "99.mat": {
        "key": "clear_2hp",
        "file": "99.mat",
        "channel": "X099_DE_time",
        "fs_hz": 48000.0,
        "rpm": 1750.0,
        "expected_fault": None,
        "label": "normal",
    },
    "100.mat": {
        "key": "clear_3hp",
        "file": "100.mat",
        "channel": "X100_DE_time",
        "fs_hz": 48000.0,
        "rpm": 1730.0,
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
    "clear_1hp": "98.mat",
    "clear_2hp": "99.mat",
    "clear_3hp": "100.mat",
    "ir": "105.mat",
    "ball": "118.mat",
    "or": "130.mat",
    "97": "97.mat",
    "98": "98.mat",
    "99": "99.mat",
    "100": "100.mat",
    "105": "105.mat",
    "118": "118.mat",
    "130": "130.mat",
}

# One unique healthy CWRU normal per belt. Do not reuse 105.mat / Mendeley.
BELT_BINDINGS = {
    "B1": "97.mat",
    "B2": "98.mat",
    "B3": "99.mat",
    "B4": "100.mat",
}

CONDITION_IDS = ("RPP1", "PP5", "B1", "B2", "B3", "B4")
FLAG_ASSETS = ("RPP1", "PP5")


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
