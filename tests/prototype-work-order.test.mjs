import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const prototype = fs.readFileSync("web/prototype/app.js", "utf8");
const detail = prototype.split("function incidentDetailPage")[1].split("function stationState")[0];
const asset = prototype.split("function assetPage")[1].split("function intelligencePage")[0];
const preview = prototype.split("function objectPreviewRail")[1].split("function assistContext")[0];
const assist = prototype.split("function answerContent")[1].split("function assistSuggestions")[0];
const intel = prototype.split("function intelligencePage")[1].split("function previewRail")[0];

test("incident detail binds the live work order, not the tape flag", () => {
  assert.match(prototype, /function resolveWorkOrder\(/);
  assert.match(detail, /resolveWorkOrder\(item\)/);
  assert.doesNotMatch(detail, /feed\.flag\.wo/, "incident detail must not read tape feed.flag.wo");
  assert.doesNotMatch(detail, /No L2 work order on this tape/);
});

test("asset 360 shows the current open work order for the asset", () => {
  assert.match(prototype, /function workOrderForAsset\(/);
  assert.match(asset, /workOrderForAsset\(asset\.id\)/);
  assert.match(asset, /Current work order/);
});

test("object preview and assist resolve the live work order", () => {
  assert.match(preview, /resolveWorkOrder\(incident\)/);
  assert.match(preview, /workOrderForAsset\(asset\.id\)/);
  assert.match(assist, /workOrderForAsset\(asset\.id\)/);
  assert.doesNotMatch(assist, /feed\.flag\.wo/, "assist fallback must not read tape feed.flag.wo");
});

test("assist context binds work order and L2 report when present", () => {
  const context = prototype.split("function assistBoundWorkOrder")[1].split("function applyContextOpen")[0];
  const suggestions = prototype.split("function assistSuggestions")[1].split("function assistPipeline")[0];
  assert.match(context, /resolveWorkOrder\(incident\) \|\| workOrderForAsset\(asset\.id\)/);
  assert.match(context, /Work order/);
  assert.match(context, /L2 report/);
  assert.match(suggestions, /What's in the L2 report\?/);
});

test("route changes carry the asset incident onto Asset 360", () => {
  assert.match(prototype, /function assetRouteParams\(/);
  assert.match(prototype, /assetRouteParams\(id, \{ render: "3d" \}\)/);
  assert.match(prototype, /assetRouteParams\(asset\.id/);
});

test("intelligence lists live current work orders", () => {
  assert.match(prototype, /function currentWorkOrderTable\(/);
  assert.match(prototype, /Current work orders/);
  assert.match(intel, /currentWorkOrderTable\(\)/);
});

test("current work order keeps a View L2 report control", () => {
  assert.match(detail, /Current work order/);
  assert.match(detail, /data-action="open-l2-report"/);
  assert.match(detail, /View L2 report/);
  assert.match(asset, /data-action="open-l2-report"/);
  assert.match(prototype, /function l2ReportRail\(/);
  assert.match(prototype, /isReportOpen\(route\) \? l2ReportRail/);
  assert.match(prototype, /action === "open-l2-report"/);
});

test("L2 report rail docks left and leaves the assist trigger visible", () => {
  const styles = fs.readFileSync("web/prototype/styles.css", "utf8");
  const overrides = fs.readFileSync("web/prototype/overrides.css", "utf8");
  const l2Css = styles.split(".l2-report-rail {")[1].split("}")[0];
  assert.match(prototype, /data-rail-side="left"/);
  assert.match(prototype, /has-left-rail/);
  assert.match(prototype, /has-right-rail/);
  assert.match(prototype, /rightRail \? "" : /);
  assert.match(l2Css, /left:\s*0/);
  assert.match(l2Css, /right:\s*auto/);
  assert.doesNotMatch(l2Css, /right:\s*0/);
  assert.match(styles, /\.rail-trigger[^{]*\{[^}]*z-index:\s*50/);
  assert.match(overrides, /\.workspace-body\.has-right-rail \.rail-trigger/);
  assert.doesNotMatch(overrides, /\.workspace-body\.has-rail \.rail-trigger \{ display: none/);
});

test("L2 report and Maintenance Assist can stay open together", () => {
  const styles = fs.readFileSync("web/prototype/styles.css", "utf8");
  const overrides = fs.readFileSync("web/prototype/overrides.css", "utf8");
  const openL2 = prototype.split('if (action === "open-l2-report")')[1].split("if (action ===")[0];
  const openAssist = prototype.split('if (action === "open-assist")')[1].split("if (action ===")[0];
  const closeRail = prototype.split('if (action === "close-rail")')[1].split("if (action ===")[0];
  const closeL2 = prototype.split('if (action === "close-l2-report")')[1].split("if (action ===")[0];
  assert.match(prototype, /function persistReport\(/);
  assert.match(prototype, /params.get\("report"\) === "1"/);
  assert.match(openL2, /report: "1"/);
  assert.doesNotMatch(openL2, /rail: "report"/);
  assert.match(openAssist, /persistReport\(/);
  assert.doesNotMatch(openAssist, /report:\s*null/);
  assert.doesNotMatch(closeRail, /report:\s*null/);
  assert.match(prototype, /data-action="close-l2-report"/);
  assert.match(closeL2, /report:\s*null/);
  assert.doesNotMatch(closeL2, /rail:\s*null, evidence/);
  const leftIdx = overrides.indexOf(".workspace-body.has-left-rail .rail-trigger");
  const rightIdx = overrides.indexOf(".workspace-body.has-right-rail .rail-trigger");
  assert.ok(rightIdx > leftIdx, "right-rail trigger hide must win when both rails are open");
  assert.match(styles, /has-left-rail\.has-right-rail \.l2-report-rail/);
});
