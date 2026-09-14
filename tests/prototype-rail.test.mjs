import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const prototype = fs.readFileSync("web/prototype/app.js", "utf8");
const styles = fs.readFileSync("web/prototype/styles.css", "utf8");
const spec = fs.readFileSync("docs/FRONTEND-SPEC.md", "utf8");
const previewRail = prototype.split("function previewRail")[1].split("function previewIdentity")[0];
const assistRail = prototype.split("function assistRail")[1].split("function containment")[0];
const l2Rail = prototype.split("function l2ReportRail")[1].split("function evidenceRail")[0];
const evidenceRail = prototype.split("function evidenceRail")[1].split("function captureTypedField")[0];

test("utility rails size from CSS variables with a dual-open clamp", () => {
  assert.match(styles, /--rail-right-width:\s*400px/);
  assert.match(styles, /--rail-left-width:\s*min\(480px,\s*42vw\)/);
  assert.match(styles, /\.utility-rail[^{]*\{[^}]*width:\s*var\(--rail-right-width\)/);
  const l2Css = styles.split(".l2-report-rail {")[1].split("}")[0];
  assert.match(l2Css, /width:\s*var\(--rail-left-width\)/);
  assert.match(
    styles,
    /has-left-rail\.has-right-rail \.l2-report-rail[^{]*\{[^}]*min\(var\(--rail-left-width\),\s*calc\(100% - var\(--rail-right-width\)\)\)/,
  );
});

test("every overlay rail mounts an inner-edge resize separator", () => {
  assert.match(styles, /\.rail-resize[^{]*\{[^}]*cursor:\s*ew-resize/);
  assert.match(prototype, /function railResizeGrip\(/);
  assert.match(prototype, /role="separator"/);
  assert.match(prototype, /aria-orientation="vertical"/);
  for (const [label, src, side] of [
    ["preview", previewRail, "right"],
    ["assist", assistRail, "right"],
    ["l2", l2Rail, "left"],
    ["evidence", evidenceRail, "right"],
  ]) {
    assert.match(src, /railResizeGrip\(/, `${label} rail missing resize grip`);
    assert.match(src, new RegExp(`railResizeGrip\\("${side}"\\)`), `${label} rail grip side`);
  }
  assert.equal([...l2Rail.matchAll(/railResizeGrip\("left"\)/g)].length, 2);
});

test("rail resize persists locally and is keyboard operable", () => {
  assert.match(prototype, /groundwork-rail-widths/);
  assert.match(prototype, /localStorage\.setItem/);
  assert.match(prototype, /localStorage\.getItem/);
  assert.match(prototype, /pointerdown/);
  assert.match(prototype, /setPointerCapture/);
  assert.match(prototype, /if \(railDrag\) return/);
  assert.match(prototype, /data-rail-resize/);
  assert.match(prototype, /event\.key === "ArrowLeft"/);
  assert.match(prototype, /event\.key === "ArrowRight"/);
  assert.match(prototype, /event\.key === "Home"/);
  assert.match(prototype, /event\.key === "End"/);
  assert.match(prototype, /has-left-rail\.has-right-rail/);
  assert.match(prototype, /RAIL_MIN = 280/);
  assert.match(prototype, /RAIL_MAX = 720/);
});

test("FRONTEND-SPEC records default rail widths as user-resizable, not URL state", () => {
  assert.match(spec, /user-resizable/i);
  assert.match(spec, /localStorage/);
});

test("left navigation collapses to an icon rail and persists locally", () => {
  assert.match(prototype, /data-action="toggle-nav"/);
  assert.match(prototype, /groundwork-nav-collapsed/);
  assert.match(prototype, /function applyNavCollapsed\(/);
  assert.match(prototype, /aria-expanded/);
  assert.match(styles, /\.app-shell\.is-nav-collapsed/);
  assert.match(styles, /\.nav-toggle/);
  assert.match(styles, /pointer-events:\s*none/);
  assert.match(spec, /collapsible to 56 px/);
  assert.match(spec, /Collapse state lives in localStorage/);
});
