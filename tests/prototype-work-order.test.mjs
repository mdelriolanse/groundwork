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

test("route changes carry the asset incident onto Asset 360", () => {
  assert.match(prototype, /function assetRouteParams\(/);
  assert.match(prototype, /assetRouteParams\(id, \{ render: "3d", rail: "preview" \}\)/);
  assert.match(prototype, /assetRouteParams\(asset\.id/);
});

test("intelligence lists live current work orders", () => {
  assert.match(prototype, /function currentWorkOrderTable\(/);
  assert.match(prototype, /Current work orders/);
  assert.match(intel, /currentWorkOrderTable\(\)/);
});
