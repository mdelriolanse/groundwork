# VFLab stays the twin geometry

Scanned the open-geometry world on build day because VFLab reads as a teaching cell, not a plant. Nothing survives our own rules. **VFLab stays.** Geometry only — this decides nothing about DSP, clocks, or the board.

Keep: VLFT VFLab, **CC BY-NC 4.0**, already in `web/twin/glb/` — 13 GLB, 15 MB, 37 placements, ~1.16M tris, stations named at the node the raycast needs. Attribution: [`data/vlft/ATTRIBUTION.md`](../../data/vlft/ATTRIBUTION.md). Ids: [0001-asset-id-is-vflab-station.md](0001-asset-id-is-vflab-station.md).

---

## Rejected, with the rule each one breaks

| Candidate | Verified | Rejected because |
| --------- | -------- | ---------------- |
| **NVIDIA Omniverse `USD_Explorer_Sample`** — automotive welding body shop: 8 KUKA arms on pedestals, KRC4 cabinet, weld power racks, light curtains, car lift, hood rack, vehicle hanger | 549 MB zip, plain CloudFront, no login. Curated to 24 GLB / 34.9 MB / 1.49M unique tris / ~101 draw calls / `extensionsUsed=[]` / root node == `asset_id`. Converted on `spark` with conda-forge `openusd` 26.08 (aarch64 exists; **`pip install usd-core` has no aarch64 wheel**). Renders headless via EGL. Best-looking candidate by a wide margin | **License.** The NVIDIA Omniverse agreement grants modification and incorporation but forbids distributing Content "on a stand-alone basis" — so converted GLBs cannot live in this repo, and derived renders should not be committed either. Second strike: the curated set has **no named rotating equipment** (no conveyor drive, gearbox, motor, pump), so a bearing WO would hang on a robot joint |
| **IRIS-v2** — EDF Lab Saclay industrial room, 530 m², the real-facility option ([Zenodo 18671364](https://doi.org/10.5281/zenodo.18671364) v2.0) | `cad_model.zip` 81.8 MB → `cad_model.fbx` 72.6 MB, **897 named meshes in 16 categories** (287 VALVES, 130 SUPPORTS, 90 PIPING, 88 ELEC-BOXES, 50 MECHANICAL, 42 ELEC-EQUIPS, 5 HVAC). P&ID `piping_and_instrumentation_diagram.pdf` 3.2 MB. Point clouds 2.1B points, ~2.5 GB **per station** × 14 | Three strikes. (1) **CC BY-NC-ND 4.0** — ND forbids the FBX→glTF adaptation we would have to display. (2) Leaf names are non-functional codes (`MEQUI_017`, `VANNE_045`, `DIVERS_031`); nothing is tagged as a pump or motor, so any part cite would be **asserted**, breaking invariant 5. (3) The P&ID is one raster sheet with **zero extractable text** — citing it needs OCR we do not have. Point clouds remain a GPU kill (invariant 12) |
| **VLFT `DFProductionCell`** — 2-lathe turning cell, undocumented in the VLFT README | 11 GLB / 17 MB / 19 placements / 462k tris / 6.0 × 2.3 × 3.3 m. Nodes `Lathe_Machine1_Static` **and** `Lathe_Machine1_Rotating`, product `shaft.1`–`shaft.8`. Same license, same JSON schema, no conversion | Nothing wrong with it — **timing**. A spindle is a better home for 2 hp / SKF 6205 than a UR joint, but switching re-binds the CWRU tape, `asset-map.json`, and ADRs 0001/0003 on demo day. **First thing to try after the event** |
| **VLFT `DARB`** — battery-disassembly lab, Comau NJ220 (220 kg) + KUKA KR50 R2500 | Only **4 of 9** GLBs were ever published: no Omron, no controllers, no tables. 20 MB / 549k tris | Not a scene — three objects in empty space. Robots are loadable as props if we ever want a heavier-looking arm |
| **VLFT `RdmPlant`** — reconfigurable electronics plant | 33 GLB / 48 MB / 67 placements / **3.24M tris**, untextured grey, `context.RepoPath` wrong, bbox resolves to 3.6 km | Over the tri budget, wrong industry, needs scale surgery |
| **VLFT `AssemblyLine/PBR`** — PBR re-skin of the stations we already load | 17 GLB / **91 MB**, filenames match `glb/` 1:1 | A/B rendered at our lighting: indistinguishable from what we ship. 6× the bytes for no visible delta |
| **Compose our own** — ROS-Industrial ABB IRB 6640/6700 (Apache-2.0), KUKA KR150 (Apache-2.0), Fanuc R-2000iC (BSD), + Sketchfab CC-BY cells, + Poly Haven CC0 dressing | Permissive and per-link named by construction. ABB `abb_irb6640_support` visual DAE 18.2 MB | We would author the layout, decimate, and re-light — hours we do not have, on the axis judges care least about. Sketchfab also gates every download behind a login |

**No CC-licensed automotive body shop, battery line, or press shop exists.** Checked Sketchfab (license-filtered API), Poly Haven, Gazebo Fuel, AWS RoboMaker, Khronos samples, Zenodo, Isaac Sim assets. Open industrial geometry is either building shells with no machines, machines with no layout, or proprietary complete scenes. Isaac `/Isaac/Environments` is separately blocked: its supplement licenses the content "without modifications", which forbids the glTF conversion outright, and there is no factory environment in the bucket anyway.

---

## Consequences

- Invariant 12 stands and gains a clause: no scan-to-BIM, no LiDAR, no `iris-room.glb` — **and no Omniverse-derived GLB or render in git.** The `spark` preview lives at `/home/dell/scout/preview/` and stays there.
- Stage line is unchanged and now defensible with numbers: a published assembly cell we did not scan; agent + containment are the product.
- Free pitch citation, no data attached: [arXiv 2602.15584](https://arxiv.org/abs/2602.15584) (IRIS-v2, EDF R&D + Centre Borelli) states that aligning functional schematics to 3D acquisitions is manual and does not scale. The best public real-plant scan on earth ships 897 objects with **no functional tag on any of them** — that is why a published cell beats a scan for this demo.
- If a scene swap ever happens: a composer must **skip `#fragment` sub-assets**. VLFT addresses sub-parts as `Robot_Arm.glb#RA_J3`; placing them as their own nodes loads 12 duplicate robots (5,417 meshes instead of 1,631). `data/vlft/compose_scene.py` dodges this today only because it filters on `MachineTool`/`BufferElement`.

**Rejected framings.** "It's an EV plant" (it is not — see `ATTRIBUTION.md`). "Swap the mesh to fix the pitch" (the geometry gap is a story problem; the buyer story is the desk that owns robots and conveyors on any discrete line).

Supersedes the open question left in PRD §4.2 — IRIS-v2 is now closed with reasons, not retired by preference.
