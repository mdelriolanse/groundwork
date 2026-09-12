#!/usr/bin/env node
/** Force re-seed demo incidents (clears demo_seeded flag). */
import { createStore } from "../app/lib/store.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = path.join(ROOT, "data/plant-floor.db");
const store = createStore(dbPath);
store.db.prepare("DELETE FROM state WHERE key='demo_seeded'").run();
store.seedDemoIncidents();
const list = store.listIncidents();
console.log(JSON.stringify({ seeded: list.length, incidents: list.map((i) => ({ id: i.id, asset: i.asset, fault: i.fault, priority: i.priority, status: i.status })) }, null, 2));
store.close();
