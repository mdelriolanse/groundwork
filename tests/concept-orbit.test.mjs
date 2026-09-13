import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { CONCEPT_ASSETS, isolateFiles, placementFor, shouldAutoOrbit } from "../web/landing/orbit.mjs";

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
