import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const proto = fs.readFileSync("web/prototype/app.js", "utf8");
const styles = fs.readFileSync("web/prototype/styles.css", "utf8");
const html = fs.readFileSync("web/prototype/index.html", "utf8");
const feed = JSON.parse(fs.readFileSync("web/prototype/feed.json", "utf8"));
const amap = JSON.parse(fs.readFileSync("data/asset-map.json", "utf8"));
const twinMap = JSON.parse(fs.readFileSync("web/twin/asset-map.json", "utf8"));
const hops = fs.readFileSync("scripts/hop_catalog.py", "utf8");
const loop = fs.readFileSync("scripts/hop-loop.py", "utf8");

const BELT = { B1: "97.mat", B2: "98.mat", B3: "99.mat", B4: "100.mat" };
const MOTORS = ["RPP1", "PP5", "B1", "B2", "B3", "B4"];

test("condition is a fifth route and is not swallowed by intelligence", () => {
  const active = proto.split("function activeModule(path)")[1].split("function selectedIncident")[0];
  assert.match(active, /"\/condition"\)\) return "condition"/);
  assert.ok(active.indexOf("/condition") < active.indexOf('return "intelligence"'));
  assert.match(proto, /function conditionPage\(/);
  assert.match(proto, /"\/condition"\)\) main = conditionPage/);
  assert.match(html, /app\.js\?v=/);
  assert.match(html, /styles\.css\?v=/);
});

test("nav has Condition and Assets opens the 24-card board", () => {
  assert.match(proto, /navLink\("assets", "Assets", "asset", "\/assets"\)/);
  assert.doesNotMatch(proto, /navLink\("assets", "Assets", "asset", "\/assets\/RPP1"\)/);
  assert.match(proto, /navLink\("condition", "Condition", "pulse", "\/condition"\)/);
  assert.match(html, /id="i-pulse"/);
});

test("assets board is separate from Asset 360", () => {
  assert.match(proto, /function assetsBoardPage\(/);
  assert.match(proto, /route\.path === "\/assets"\) main = assetsBoardPage/);
  assert.match(proto, /"\/assets"\)\) main = assetPage/);
  assert.match(proto, /24 stations\. Not a vibration dashboard/);
  assert.match(proto, /Open Condition/);
  assert.match(styles, /\.station-board/);
  assert.match(styles, /\.condition-grid/);
});

test("condition tiles are six motors with sparkline, label, cite, ISO note, FPR", () => {
  for (const id of MOTORS) assert.match(proto, new RegExp(`"${id}"`));
  assert.match(proto, /function sparkSvg\(/);
  assert.match(proto, /function falsePositiveRate\(/);
  assert.match(proto, /iso20816\.py:294/);
  assert.match(proto, /No zone letter/);
  assert.doesNotMatch(proto.split("function conditionPage")[1].split("function assetPage")[0], /zone [A-D]|ISO 20816 zone/i);
  assert.match(styles, /\.condition-tile/);
});

test("intelligence fleet accordion is a pointer, not the chip-strip dashboard", () => {
  const intel = proto.split("function intelligencePage")[1].split("function previewRail")[0];
  assert.match(intel, /href="#\/assets"/);
  assert.match(intel, /href="#\/condition"/);
  assert.doesNotMatch(intel, /processStrip\(/);
  assert.match(intel, /Pointer only/);
});

test("B1–B4 bind unique CWRU normals and never reuse 105 or Mendeley", () => {
  for (const map of [amap, twinMap]) {
    for (const [id, file] of Object.entries(BELT)) {
      const row = map.assets.find((a) => a.asset_id === id);
      assert.equal(row.source, `cwru:${file}`, id);
      assert.deepEqual(row.tape, [file], id);
      assert.equal(row.role, "condition", id);
      assert.doesNotMatch(JSON.stringify(row), /105\.mat|mendeley/i);
    }
  }
  const bind = feed.condition.bindings;
  for (const [id, file] of Object.entries(BELT)) {
    assert.equal(bind[id].fault, "none", id);
    assert.equal(bind[id].file, file, id);
    assert.equal(bind[id].source, `cwru:${file}`, id);
    assert.ok(bind[id].rms > 0 && bind[id].rms < 0.2, `${id} rms cited ${bind[id].rms}`);
  }
  assert.match(hops, /BELT_BINDINGS/);
  assert.match(loop, /BELT_BINDINGS/);
  assert.doesNotMatch(loop.split("for belt_id, fname in BELT_BINDINGS")[1].split("for mendeley_id")[0], /diagnose\(/);
});

test("only RPP1 / PP5 may flag; belts stay none on every hop", () => {
  assert.match(proto, /FLAG_ASSETS = new Set\(\["RPP1", "PP5"\]\)/);
  assert.match(proto, /BELT_IDS.includes\(id\)\s*\n\s*\? "none"/);
  for (const hop of feed.hops) {
    for (const id of Object.keys(BELT)) {
      const slot = hop.assets[id];
      assert.equal(slot.fault, "none", `${id} hop ${hop.i}`);
      assert.equal(slot.vibration.fault, "none");
      assert.ok(slot.vibration.rms != null);
      assert.ok(NORMAL_FILE(slot.vibration.file), slot.vibration.file);
    }
    assert.notEqual(hop.assets.B1.vibration.file, hop.assets.B2.vibration.file);
  }
  function NORMAL_FILE(file) {
    return Object.values(BELT).includes(file);
  }
});

test("feed FPR inputs are real negatives plus existing 97.mat hops", () => {
  assert.equal(feed.condition.pmmcp_invoked, false);
  const tnBelts = 4;
  const healthyHops = feed.hops.filter((h) => h.rpp1.file === "97.mat" && !h.rpp1.fault).length;
  assert.equal(healthyHops, 10);
  assert.ok(tnBelts + healthyHops >= 14);
  assert.match(proto, /tnBelts \+ tnHops/);
});

test("hop historian carries per-asset RMS for the six motors", () => {
  const hop0 = feed.hops[0];
  assert.ok(hop0.assets.B1.rms !== hop0.assets.B2.rms || hop0.assets.B1.file !== hop0.assets.B2.file);
  assert.equal(hop0.assets.PP5.vibration.source, "mendeley:0Nm_BPFI_10__ch0.mat");
  assert.equal(hop0.assets.PP5.vibration.rms, 1.352);
  const b1 = feed.hops.map((h) => h.assets.B1.rms);
  assert.ok(new Set(b1).size >= 2, "B1 sparkline is hop windows, not one diagnose snapshot");
});
