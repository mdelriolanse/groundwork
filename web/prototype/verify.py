#!/usr/bin/env python3
"""Offline acceptance checks for the tape-backed prototype."""
from pathlib import Path
import json
import re
import struct
import sys

ROOT = Path(__file__).resolve().parent
REQUIRED = [ROOT / name for name in ("index.html", "styles.css", "app.js", "README.md", "feed.json")]
ROUTES = ("/incidents", "/incidents/INC-RPP1", "/floor", "/assets/RPP1", "/intelligence")
STATES = ("closed", "ready", "running", "answered", "unsupported", "failed", "offline")
BANNED = ("INC-2048", "INC-2045", "MTR-12", "PMP-03", "CNC-07", "FAN-04", "RUN-8821")
SHOTS = (
    "incident-inbox.png", "incident-detail.png", "floor.png", "floor-asset.png", "asset-360.png", "asset-render.png",
    "intelligence.png", "maintenance-assist.png", "evidence-viewer.png",
)


def png_size(path: Path):
    with path.open("rb") as handle:
        if handle.read(8) != b"\x89PNG\r\n\x1a\n":
            raise AssertionError(f"{path.name}: not a PNG")
        handle.read(8)
        return struct.unpack(">II", handle.read(8))


def main():
    missing = [str(path.relative_to(ROOT)) for path in REQUIRED if not path.exists()]
    assert not missing, f"missing source files: {', '.join(missing)}"
    bundle = "\n".join(path.read_text() for path in REQUIRED if path.suffix != ".json")
    external = re.findall(r'(?:src|href)=["\']https?://', bundle)
    assert not external, "external runtime dependencies found"
    for route in ROUTES:
        assert route in bundle, f"missing route {route}"
    for state in STATES:
        assert state in bundle, f"missing assistant state {state}"
    for token in BANNED:
        assert token not in bundle, f"seeded fixture still present: {token}"
    assert "feed.json" in bundle, "app does not load feed.json"
    assert "@media (max-width: 1280px)" in bundle, "missing overlay breakpoint"
    assert "prefers-reduced-motion" in bundle, "missing reduced-motion handling"
    assert "overflow-x: hidden" in bundle, "missing page overflow guard"
    # Floor = live plan-view twin (web/twin ?view=plan|top) with parent-drawn labels; every station belongs to a cell.
    for token in ("data-floor-mount", "twin:layout", "twin:stations", "twin:select", "view=", "floor-fit", "data-part-mount", "twin:part", "view=part", "toggle-render"):
        assert token in bundle, f"floor plan view missing {token}"
    scene = json.loads((ROOT.parent / "twin" / "scene.json").read_text(encoding="utf-8"))
    cell_ids = {cell["id"] for cell in scene.get("cells", [])}
    stations = [p for p in scene["placements"] if p["kind"] == "station"]
    assert cell_ids and stations, "scene.json lacks cells or stations"
    orphans = [p["asset_id"] for p in stations if p.get("cell") not in cell_ids]
    assert not orphans, f"stations without a cell: {orphans}"
    viewer = (ROOT.parent / "twin" / "viewer.js").read_text(encoding="utf-8")
    for token in ("twin:layout", "twin:fit", "twin:view", "OrthographicCamera", "twin:part", "partMode"):
        assert token in viewer, f"twin viewer missing {token}"
    feed = json.loads((ROOT / "feed.json").read_text(encoding="utf-8"))
    assert feed["schema"] == "pfa.prototype.feed.v1"
    assert len(feed["hops"]) == 20, f"expected 20 hops, got {len(feed['hops'])}"
    assert feed["manifest"]["flag_hop"] == 10
    ids = {row["asset_id"] for row in feed["fleet"]}
    assert ids == {"RPP1", "T1"}, ids
    existing = [ROOT / "screenshots" / name for name in SHOTS if (ROOT / "screenshots" / name).exists()]
    for path in existing:
        assert png_size(path) == (1440, 900), f"{path.name}: expected 1440x900, got {png_size(path)}"
    print(f"PASS: feed 20 hops, no seeded ids; {len(existing)}/{len(SHOTS)} screenshots verified")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        raise SystemExit(1)
