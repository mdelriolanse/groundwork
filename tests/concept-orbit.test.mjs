import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { CONCEPT_ASSETS, isolateFiles, placementFor, shouldAutoOrbit, focusProgress } from "../web/landing/orbit.mjs";

const scene = JSON.parse(fs.readFileSync("web/twin/scene.json", "utf8"));
const view = fs.readFileSync("web/landing/orbit-view.js", "utf8");

test("ConceptOrbit allows only PP1, RPP1, and T1 and isolates one station file", () => {
  assert.deepEqual([...CONCEPT_ASSETS], ["PP1", "RPP1", "T1"]);
  assert.equal(placementFor(scene, "PP1").file, "Pick_and_Place_Station.glb");
  assert.equal(placementFor(scene, "RPP1").file, "UR_Pick_and_Place_Station.glb");
  assert.equal(placementFor(scene, "T1").file, "Tightener_Station.glb");
  assert.equal(placementFor(scene, "B1"), null);
  assert.equal(placementFor(scene, "MTR07-CAD"), null);
  assert.deepEqual(isolateFiles(scene, "PP1"), ["Pick_and_Place_Station.glb"]);
  assert.deepEqual(isolateFiles(scene, "unknown"), []);
});

test("ConceptOrbit orbits unless reduced motion is requested", () => {
  assert.equal(shouldAutoOrbit(false), true);
  assert.equal(shouldAutoOrbit(true), false);
});

test("orbit view is a mute display — no Twin bridge, HUD, or labels", () => {
  assert.match(view, /shouldAutoOrbit/);
  assert.match(view, /isolateFiles|placementFor/);
  assert.match(view, /prefers-reduced-motion/);
  assert.doesNotMatch(view, /postMessage|twin:select|twin:part|twin:issues|#hud|asset_id<\/|innerHTML/);
  assert.doesNotMatch(view, /Siemens_1LE1003_Motor/);
});


test("scroll focus clamps the travel and reduced motion shows the final diagnosis", () => {
  assert.equal(focusProgress(200, 800, false), 0);
  assert.equal(focusProgress(0, 800, false), 0);
  assert.equal(focusProgress(-400, 800, false), 0.5);
  assert.equal(focusProgress(-1000, 800, false), 1);
  assert.equal(focusProgress(-10, 0, false), 1);
  assert.equal(focusProgress(200, 800, true), 1);
});


test("line status distinguishes live data from recorded replay and preserves flags", async () => {
  const { lineStatus } = await import("../web/landing/line-state.mjs");
  const recorded = { assets: { PP1: { busy: 1 }, T1: { busy: 0 } } };
  const flag = { asset_id: "RPP1" };
  const offline = lineStatus({ live: false }, null, recorded, flag);
  assert.deepEqual(offline.running, ["PP1"]);
  assert.deepEqual(offline.flagged, ["RPP1"]);
  const live = lineStatus({ live: true, latest: {}, assets: { T1: { busy: true } } }, { fleet: [{ asset_id: "T1", flag: "process_drop" }] }, recorded, flag);
  assert.deepEqual(live.running, ["T1"]);
  assert.deepEqual(live.flagged, ["T1"]);
  assert.deepEqual(lineStatus(null, null, null, null).running, []);
});


test("line tour is playback-only and never captures page navigation", () => {
  const line = fs.readFileSync("web/landing/line-view.js", "utf8");
  const landing = fs.readFileSync("web/landing/index.html", "utf8");
  assert.doesNotMatch(line, /OrbitControls|keydown|pointerdown|preventDefault/);
  assert.doesNotMatch(landing, /line-tour|line-fit|Drag to pan/);
});
