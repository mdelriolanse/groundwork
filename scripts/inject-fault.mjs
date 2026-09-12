#!/usr/bin/env node
/** Operator CLI: inject next hops onto a catalogued CWRU fault file. */
import { createStore } from "../app/lib/store.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = {
  clear: { file: "97.mat", channel: "X097_DE_time", fs_hz: 48000, rpm: 1797, expected_fault: null },
  ir: { file: "105.mat", channel: "X105_DE_time", fs_hz: 12000, rpm: 1797, expected_fault: "inner_race" },
  or: { file: "130.mat", channel: "X130_DE_time", fs_hz: 12000, rpm: 1797, expected_fault: "outer_race" },
  ball: { file: "118.mat", channel: "X118_DE_time", fs_hz: 12000, rpm: 1797, expected_fault: "ball" },
  "97": null, "105": null, "118": null, "130": null,
};
for (const [k, v] of Object.entries({ "97": "clear", "105": "ir", "118": "ball", "130": "or" })) CATALOG[k] = CATALOG[v];

const key = (process.argv[2] || "ir").toLowerCase();
const hops = Number(process.argv[3] || 30);
const entry = CATALOG[key];
if (!entry) {
  console.error(`usage: node scripts/inject-fault.mjs <ir|or|ball|clear|105|130|118|97> [hops]`);
  process.exit(1);
}

const store = createStore(path.join(ROOT, "data/plant-floor.db"));
store.seed();
if (key === "clear" || key === "97") {
  store.setHopOverride(null);
  console.log(JSON.stringify({ cleared: true, hop_override: null }));
} else {
  const override = {
    file: entry.file,
    channel: entry.channel,
    fs_hz: entry.fs_hz,
    rpm: entry.rpm,
    expected_fault: entry.expected_fault,
    hops_remaining: hops,
    injected_at: new Date().toISOString(),
    source: `cwru:${entry.file}`,
  };
  store.setHopOverride(override);
  console.log(JSON.stringify({ ok: true, hop_override: override }));
}
store.close();
