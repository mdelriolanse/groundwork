import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const prototype = fs.readFileSync("web/prototype/app.js", "utf8");
const styles = fs.readFileSync("web/prototype/styles.css", "utf8");
const incidentBranch = prototype
  .split("  if (hasIncident) {")[1]
  .split("  if (asset.unmonitored) {")[0];

test("object previews share one shell and expose all supported states", () => {
  assert.match(prototype, /function previewRail\(/);
  for (const label of [
    "What happened",
    "What should I do",
    "Why trust it",
    "Monitored asset",
    "Process-monitored asset",
    "Unmonitored station",
  ]) {
    assert.match(prototype, new RegExp(label), `missing preview state: ${label}`);
  }
});

test("incident preview uses the incident snapshot, not the moving hop", () => {
  for (const field of ["first", "window", "rpm", "rms"]) {
    assert.match(prototype, new RegExp(`${field}: row\\.${field}`), `live incident drops ${field}`);
  }
  assert.match(incidentBranch, /const source = incident\.source/);
  assert.match(incidentBranch, /const window = incident\.window/);
  assert.match(incidentBranch, /incident\.rms/);
  assert.doesNotMatch(incidentBranch, /now\.rpp1/, "incident branch must not substitute current-hop measurements");
});

test("preview states communicate evidence gaps and unsupported diagnostics", () => {
  for (const label of [
    "Exact signal unavailable",
    "No manual cite",
    "No vibration diagnosis",
    "No condition data",
    "Assist unavailable",
  ]) {
    assert.match(prototype, new RegExp(label), `missing honest state: ${label}`);
  }
  assert.match(prototype, /L2 work order \$\{workOrder \? "ready" : "pending"\}/);
});

test("signal citations carry incident context into the evidence viewer", () => {
  assert.match(prototype, /data-evidence-source/);
  assert.match(prototype, /data-evidence-window/);
  assert.match(prototype, /data-evidence-incident/);
  assert.match(prototype, /current-hop values are not substituted/);
});

test("object preview actions stay pinned beneath a scrolling body", () => {
  assert.match(styles, /\.object-preview-rail\s*\{\s*grid-template-rows:\s*52px minmax\(0,\s*1fr\) auto/);
  assert.match(styles, /\.preview-actions\s*\{/);
  assert.match(styles, /\.preview-actions-secondary\s*\{/);
});

test("assist composer survives live rerenders and stays above the twin overlay", () => {
  assert.match(prototype, /function captureTypedField\(/);
  assert.match(prototype, /function restoreTypedField\(/);
  assert.match(prototype, /function softLiveTick\(/);
  assert.match(prototype, /event\.target\.id === "assist-question"/);
  assert.match(prototype, /#assist-question, \[data-assist-form\]/);
  assert.match(prototype, /rr\.left - r\.left/);
  assert.match(styles, /\.utility-rail[^{]*\{[^}]*z-index:\s*40/);
});
