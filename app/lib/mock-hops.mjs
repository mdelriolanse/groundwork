import { createHash } from "node:crypto";

/** In-process 1 Hz hop fabric. Process tags from the sensor catalog; RPP1 RMS from recorded healthy tape hops 0–9. Nothing persisted except latest_hop. */

function rngFor(key) {
  let s = createHash("sha256").update(key).digest().readUInt32BE(0) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function isBusy(hop, phase, takt, duty) {
  const period = Math.max(1, Math.round(takt / 1.0));
  const window = period * 3;
  const local = (hop + phase * 2) % window;
  return local < Math.max(1, Math.round(window * duty));
}

function roundTag(tag, value) {
  if (tag === "busy" || tag === "bowl_on") return Math.round(value);
  if (tag === "job_id") return Math.trunc(value);
  if (tag === "spindle_rpm" || tag === "index_rpm" || tag === "rpm" || tag === "lux") return Math.round(value);
  const n = Number(value);
  return Number(n.toPrecision(3));
}

function lerp(lo, hi, t) {
  return lo + (hi - lo) * t;
}

export function processAssets(catalog, hop) {
  const classes = catalog?.classes || {};
  const line = catalog?.line || {};
  const takt = Number(line.takt_s ?? 2);
  const duty = Number(line.busy_duty ?? 0.35);
  const out = {};
  for (const [assetId, meta] of Object.entries(catalog?.assets || {})) {
    const cls = classes[meta.class];
    if (!cls) continue;
    const source = cls.source || `synthetic:${meta.class}`;
    const part = meta.part || cls.part || assetId;
    if (assetId === "RPP1") {
      const rng = rngFor(`${assetId}:${hop}`);
      const tags = {};
      for (const [tag, spec] of Object.entries(cls.tags || {})) {
        if (spec.kind === "counter") continue;
        const lo = Number(spec.busy_lo ?? spec.idle ?? 0);
        const hi = Number(spec.busy_hi ?? spec.idle ?? 0);
        tags[tag] = roundTag(tag, lerp(lo, hi, rng()));
      }
      out[assetId] = { part, source, tags };
      continue;
    }
    const phase = Number(meta.phase || 0);
    const always = Boolean(cls.always_on);
    const busy = always || isBusy(hop, phase, takt, duty);
    const rng = rngFor(`${assetId}:${hop}`);
    const tags = {};
    for (const [tag, spec] of Object.entries(cls.tags || {})) {
      if (spec.kind === "counter") {
        tags[tag] = 1 + Math.floor((hop + phase) / 6);
        continue;
      }
      let val;
      if (tag === "busy" || tag === "bowl_on") val = busy ? 1 : 0;
      else if (tag === "cycle_s") val = Number(spec[busy ? "busy" : "idle"] ?? 2);
      else if (busy || always) {
        const lo = Number(spec.busy_lo ?? spec.idle ?? 0);
        const hi = Number(spec.busy_hi ?? spec.idle ?? 0);
        val = lerp(lo, hi, rng()) * (1 + (rng() - 0.5) * 0.04);
      } else val = Number(spec.idle ?? 0);
      tags[tag] = roundTag(tag, val);
    }
    out[assetId] = { part, source, tags, busy: tags.busy, ...tags };
  }
  return out;
}

export function healthyTape(feed) {
  const hops = Array.isArray(feed?.hops) ? feed.hops : [];
  const named = hops.filter((h) => h.i != null && h.i <= 9);
  return (named.length ? named : hops).slice(0, 10);
}

export function mockHop(hop, { feed, catalog } = {}) {
  const tape = healthyTape(feed);
  const raw = tape.length ? tape[((hop % tape.length) + tape.length) % tape.length] : null;
  const rpp1 = raw?.rpp1 ? { ...raw.rpp1 } : { part: "URjoint1", source: "cwru:97.mat:X097_DE_time", rms: 0.07, fault: null, file: "97.mat" };
  const assets = processAssets(catalog, hop);
  const tapeAssets = raw?.assets || {};
  for (const id of ["B1", "B2", "B3", "B4", "PP5"]) {
    if (!assets[id]) continue;
    const fromTape = tapeAssets[id];
    const seed = feed?.condition?.bindings?.[id];
    const vib = fromTape?.vibration || seed;
    if (!vib) continue;
    assets[id] = {
      ...assets[id],
      rms: fromTape?.rms ?? vib.rms,
      fault: fromTape?.fault ?? vib.fault,
      window: fromTape?.window ?? vib.window,
      file: fromTape?.file ?? vib.file,
      vibration: vib,
    };
  }
  return {
    ts: new Date().toISOString(),
    hop,
    rpp1,
    assets,
    seeded: true,
  };
}
