import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const prototype = fs.readFileSync("web/prototype/app.js", "utf8");
const styles = fs.readFileSync("web/prototype/styles.css", "utf8");
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

test("left navigation collapses to an icon rail and persists locally", () => {
  assert.match(prototype, /data-action="toggle-nav"/);
  assert.match(prototype, /groundwork-nav-collapsed/);
  assert.match(prototype, /function applyNavCollapsed\(/);
  assert.match(prototype, /aria-expanded/);
  assert.match(styles, /\.app-shell\.is-nav-collapsed/);
  assert.match(styles, /\.nav-toggle/);
  assert.match(styles, /pointer-events:\s*none/);
  assert.match(styles, /\.left-nav \{[^}]*transition:\s*width 240ms cubic-bezier\(\.4, 0, \.2, 1\)/);
  assert.match(styles, /\.brand \.mark \{[^}]*contain:\s*strict/);
  assert.match(styles, /\.nav-toggle \.icon \{[^}]*transition:\s*transform 240ms cubic-bezier\(\.4, 0, \.2, 1\)/);
  assert.doesNotMatch(styles, /is-nav-collapsed \.brand \{[^}]*flex-direction:\s*column/);
  assert.doesNotMatch(styles, /is-nav-collapsed \.nav-link \{[^}]*justify-content:\s*center/);
});

test("plant scope lives in header controls, not the left-nav brand", () => {
  const brand = prototype.split("class=\"brand\"")[1].split("nav-section-label")[0];
  assert.match(brand, /<strong>Groundwork<\/strong>/);
  assert.doesNotMatch(brand, /feed\.cell\.name/);
  assert.match(prototype, /function scopeLabel\(/);
  assert.match(prototype, /data-action="toggle-scope"/);
  assert.match(prototype, /class="header-scope"/);
  assert.equal([...prototype.matchAll(/data-action="toggle-scope"/g)].length, 2);
  assert.doesNotMatch(styles, /header-scope > span \{ display: none/);
});

test("assist holds a Thinking state for 3-6s before the prepared answer", () => {
  assert.match(prototype, /assistState: "running"/);
  assert.match(prototype, /3000 \+ Math\.random\(\) \* 3000/);
  assert.match(prototype, /<strong>\$\{icon\("spark"\)\}Thinking<\/strong>/);
  assert.match(prototype, /assist-state\[aria-busy\]/);
});

test("L2 report overlay fills the workspace body with no header gap", () => {
  assert.match(styles, /\.utility-rail\.l2-report-rail \{ top: 0/);
});
