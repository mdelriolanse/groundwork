#!/usr/bin/env python3
"""Cut hops 470–489 from the hero tape (10s healthy + 10s 97→105 flip)."""

from __future__ import annotations

import csv
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
HOP0 = 470
HOPS = 20
OUT = HERE / "slice20"


def main() -> None:
    src_manifest = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
    l0_lines = (HERE / "l0" / "rpp1-de.jsonl").read_text(encoding="utf-8").splitlines()
    sliced = l0_lines[HOP0 : HOP0 + HOPS]
    if len(sliced) != HOPS:
        raise SystemExit(f"expected {HOPS} L0 hops, got {len(sliced)}")

    first = json.loads(sliced[0])
    last = json.loads(sliced[-1])
    flag_at = src_manifest["flag_at"]

    out_l0 = OUT / "l0" / "rpp1-de.jsonl"
    out_l0.parent.mkdir(parents=True, exist_ok=True)
    out_l0.write_text("\n".join(sliced) + "\n", encoding="utf-8")

    want = {json.loads(line)["ts"] for line in sliced}
    src_l1 = HERE / "l1" / "historian.csv"
    out_l1 = OUT / "l1" / "historian.csv"
    out_l1.parent.mkdir(parents=True, exist_ok=True)
    with src_l1.open(encoding="utf-8", newline="") as fh, out_l1.open(
        "w", encoding="utf-8", newline=""
    ) as out:
        reader = csv.DictReader(fh)
        assert reader.fieldnames
        writer = csv.DictWriter(out, fieldnames=reader.fieldnames)
        writer.writeheader()
        kept = 0
        for row in reader:
            if row["ts"] in want:
                writer.writerow(row)
                kept += 1
    if kept != HOPS * 3:
        raise SystemExit(f"expected {HOPS * 3} L1 rows, got {kept}")

    src_l2 = HERE / "l2" / "dirty.jsonl"
    out_l2 = OUT / "l2" / "dirty.jsonl"
    out_l2.parent.mkdir(parents=True, exist_ok=True)
    out_l2.write_text(src_l2.read_text(encoding="utf-8"), encoding="utf-8")
    (OUT / "l2" / "dirty.txt").write_text(
        (HERE / "l2" / "dirty.txt").read_text(encoding="utf-8"), encoding="utf-8"
    )

    doc = {
        "schema": "pfa.tape.slice20.v1",
        "parent": "pfa.tape.v1",
        "t0": first["ts"],
        "t1": last["ts"],
        "duration_s": HOPS,
        "hop0": HOP0,
        "hops": HOPS,
        "hop_s": src_manifest["hop_s"],
        "window_s": src_manifest["window_s"],
        "flag_at": flag_at,
        "flag_hop": 10,
        "honesty": "Window pointers only. No invented RMS. Flip is hop 10 / flag_at.",
        "files": {
            "l0": "l0/rpp1-de.jsonl",
            "l1": "l1/historian.csv",
            "l2": "l2/dirty.jsonl",
            "l2_line": "l2/dirty.txt",
        },
    }
    (OUT / "manifest.json").write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT} hops {HOP0}-{HOP0 + HOPS - 1} {first['ts']} .. {last['ts']}")


if __name__ == "__main__":
    main()
