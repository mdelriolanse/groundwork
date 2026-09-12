const app = document.querySelector("#app");
const twinOrigin = `${location.protocol}//${location.hostname}:8765`;
const apiBase = () => (location.origin === twinOrigin ? "" : twinOrigin);
const fetchBoard = () => fetch(`${apiBase()}/api/board`, { cache: "no-store" });
const fetchIncidents = () => fetch(`${apiBase()}/api/incidents`, { cache: "no-store" });
const fetchHops = () => fetch(`${apiBase()}/api/hops/latest?limit=20`, { cache: "no-store" });

let feed = null;
let board = null;
let liveIncidents = [];
let liveHops = null;
let cursor = 0;
let replayTimer = null;
let lastTrigger = null;
let focusRestoreId = null;
let previousPath = "";
let previousRailMode = null;
let assistAbort = null;
let lastAssist = null;
let lastAssistError = "";
let draftQuestion = "";
const acknowledgedIds = new Set();
let openMetricInfo = "";
let healthyLoop = true; // tape fallback loops hops 0–9 when hop-loop offline

// ---------- Floor: persistent plan-view twin ----------
// render() rebuilds #app innerHTML on every replay hop, so the Floor iframe lives outside #app
// as a fixed overlay tracking the [data-floor-mount] rect. Reparenting an iframe reloads it;
// this does not.
const FLOOR_VIEWS = new Set(["plan", "top"]);
const FLOOR_INSET = { left: 240, top: 40, right: 16, bottom: 48 };
let floorLive = null;
let floorReady = false;
let floorFit = false;
let floorSent = { view: null, focus: null };
let twinStations = null;
let twinAnchors = [];
let floorHover = null;
let floorObserver = null;

function floorView(route) {
  const v = route.params.get("view");
  return FLOOR_VIEWS.has(v) ? v : "plan";
}

function stationById(id) {
  return twinStations?.stations.find(s => s.asset_id === id) || null;
}

function cellName(id) {
  return twinStations?.cells.find(c => c.id === id)?.name || id || "—";
}

function humanModel(model = "") {
  return model.replace(/_Station$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/(\d)([A-Z])/g, "$1 $2");
}

function ensureFloorLive() {
  if (floorLive) return floorLive;
  floorLive = document.createElement("div");
  floorLive.className = "floor-live";
  floorLive.hidden = true;
  const view = floorView(getRoute());
  const asset = getRoute().params.get("asset");
  floorLive.innerHTML = `<iframe class="floor-frame" title="VFLab hinge assembly line, bird's-eye view" data-floor-frame aria-busy="true" src="${twinOrigin}/twin/?view=${encodeURIComponent(view)}${asset ? `&asset=${encodeURIComponent(asset)}` : ""}"></iframe><div class="floor-labels" data-floor-labels></div>`;
  document.body.appendChild(floorLive);
  floorLive.addEventListener("click", onAppClick);
  floorLive.addEventListener("wheel", (event) => {
    if (event.target.closest("[data-floor-label]")) return;
    event.preventDefault();
    postFloor({ type: "twin:wheel", deltaY: event.deltaY });
  }, { passive: false });
  floorLive.addEventListener("keydown", event => {
    const row = event.target.closest("[data-select-asset], [data-open-asset]");
    if (row && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); row.click(); }
  });
  return floorLive;
}

function floorFrameWindow() {
  return floorLive?.querySelector("[data-floor-frame]")?.contentWindow || null;
}

function postFloor(message) {
  const win = floorFrameWindow();
  if (win && floorReady) win.postMessage(message, twinOrigin);
}

function positionFloorLive() {
  if (!floorLive) return;
  const mount = app.querySelector("[data-floor-mount]");
  if (!mount) { floorLive.hidden = true; return; }
  const r = mount.getBoundingClientRect();
  const rail = app.querySelector("[data-overlay-rail]");
  const rr = rail?.getBoundingClientRect();
  let width = r.width;
  if (rr && rr.left < r.right && rr.right > r.left && rr.top < r.bottom && rr.bottom > r.top) {
    width = Math.max(0, rr.left - r.left);
  }
  Object.assign(floorLive.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${width}px`, height: `${r.height}px` });
  floorLive.hidden = false;
}

function syncFloor(route) {
  const onFloor = route.path === "/floor";
  if (!onFloor) {
    if (floorLive) floorLive.hidden = true;
    floorObserver?.disconnect();
    return;
  }
  ensureFloorLive();
  positionFloorLive();
  floorObserver?.disconnect();
  const mount = app.querySelector("[data-floor-mount]");
  if (mount && "ResizeObserver" in window) {
    floorObserver = new ResizeObserver(positionFloorLive);
    floorObserver.observe(mount);
  }
  const view = floorView(route);
  const asset = selectedAsset(route);
  if (floorReady) {
    if (floorSent.view !== view) {
      postFloor({ type: "twin:view", view, inset: FLOOR_INSET });
      floorSent.view = view;
    }
    // Whole line unless the route names an asset (View on floor, tree/label/canvas click).
    const target = route.params.has("asset") && !floorFit ? asset.id : null;
    if (floorSent.focus !== target) {
      postFloor(target ? { type: "twin:focus", assetId: target } : { type: "twin:fit" });
      floorSent.focus = target;
    }
  }
  renderFloorLabels(route);
}

function renderFloorLabels(route = getRoute()) {
  const layer = floorLive?.querySelector("[data-floor-labels]");
  if (!layer) return;
  const selected = selectedAsset(route).id;
  const flag = flagged();
  const sorted = [...twinAnchors].sort((a, b) => (a.x + a.w / 2) - (b.x + b.w / 2));
  // Labels sit on the station's screen-space top edge. Up to three stacked rows avoid collisions;
  // priority labels (monitored, selected, flagged, hovered) are placed first and always shown,
  // unmonitored labels that still collide are dropped (the tree lists them).
  const hovered = floorHover;
  const GAP = 48, ROWS = 3, STEP = 22;
  const rowLast = new Array(ROWS).fill(-Infinity);
  const placed = new Map();
  const priority = a => a.asset_id === selected || a.asset_id === hovered || a.asset_id === "RPP1" || Boolean(stationById(a.asset_id)?.monitored);
  const place = (a, force) => {
    const cx = a.x + a.w / 2;
    let row = rowLast.findIndex(last => cx - last >= GAP);
    if (row === -1) { if (!force) return; row = 0; }
    rowLast[row] = cx;
    placed.set(a.asset_id, { cx, y: a.y - row * STEP });
  };
  for (const a of sorted) if (priority(a)) place(a, true);
  for (const a of sorted) if (!priority(a)) place(a, false);
  const shown = sorted.filter(a => placed.has(a.asset_id));
  const style = a => { const { cx, y } = placed.get(a.asset_id); return `left:${cx.toFixed(1)}px;top:${y.toFixed(1)}px;--stem:${(a.y - y + 6).toFixed(1)}px`; };
  const key = shown.map(a => a.asset_id).join(",") + `|${selected}|${hovered}|${flag}`;
  if (layer.dataset.key === key) {
    // Camera tween: same labels, new positions. Mutate styles instead of rebuilding the DOM.
    for (const a of shown) { const el = layer.querySelector(`[data-floor-label="${a.asset_id}"]`); if (el) el.style.cssText = style(a); }
    return;
  }
  layer.dataset.key = key;
  layer.innerHTML = shown.map(a => {
    const st = stationById(a.asset_id);
    const monitored = Boolean(st?.monitored);
    const critical = a.asset_id === "RPP1" && flag;
    const cls = ["floor-label", monitored ? "monitored" : "unmonitored", a.asset_id === selected ? "selected" : "", critical ? "critical" : "", a.asset_id === hovered ? "hover" : ""].filter(Boolean).join(" ");
    const state = critical ? "flag" : a.asset_id === "RPP1" ? "ok" : monitored ? "process" : "no sensor";
    return `<button type="button" class="${cls}" data-open-asset="${a.asset_id}" data-floor-label="${a.asset_id}" style="${style(a)}" aria-label="Open ${a.asset_id} asset page, ${state}" aria-current="${a.asset_id === selected}">${critical ? `${icon("alert", "sm")}` : ""}<span class="mono">${a.asset_id}</span>${monitored || critical ? `<small>${state}</small>` : ""}</button>`;
  }).join("");
}

// ---------- Asset 360: persistent single-station render (twin ?view=part) ----------
let partLive = null;
let partReady = false;
let partAsset = null;
let partLoaded = null;
let partRequested = null;
let partSrcKey = null;
let partSelected = null;
let partSent = null;
let partIssuesKey = null;
let partObserver = null;
let partScrollTarget = null;
let detectPosted = false; // unused in live path; kept for tape fallback quiet
const prefetchedTwin = new Set();

function boardIssues() {
  return Array.isArray(board?.issues) ? board.issues : [];
}

function issuesForAsset(assetId) {
  return boardIssues().filter((row) => row.asset_id === assetId && row.part);
}

function issuesMessageParts(assetId) {
  return issuesForAsset(assetId).map((row) => ({
    assetId: row.asset_id,
    part: row.part,
    severity: row.severity || "critical",
  }));
}

function partFrameWindow() {
  return partLive?.querySelector("[data-part-frame]")?.contentWindow || null;
}

function parkPartLive() {
  partObserver?.disconnect();
  if (partScrollTarget) partScrollTarget.removeEventListener("scroll", positionPartLive);
  partScrollTarget = null;
  if (!partLive) return;
  partLive.hidden = true;
  if (partLive.parentNode !== document.body) document.body.appendChild(partLive);
}

function positionPartLive() {
  if (!partLive) return;
  const mount = app.querySelector("[data-part-mount]");
  if (!mount) { partLive.hidden = true; return; }
  const r = mount.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) { partLive.hidden = true; return; }
  const expanded = mount.closest(".inspection-expanded");
  const clipRoot = expanded || mount.closest(".page");
  const clip = clipRoot?.getBoundingClientRect();
  const rail = !expanded ? app.querySelector("[data-overlay-rail]")?.getBoundingClientRect() : null;
  let clipPath = "";
  if ((clip || rail) && !expanded) {
    const insetTop = Math.max(0, (clip?.top ?? r.top) - r.top);
    const insetBottom = Math.max(0, r.bottom - (clip?.bottom ?? r.bottom));
    const insetLeft = Math.max(0, (clip?.left ?? r.left) - r.left);
    const insetRight = Math.max(0, r.right - (clip?.right ?? r.right), rail && rail.left < r.right && rail.right > r.left ? r.right - rail.left : 0);
    if (insetTop >= r.height || insetBottom >= r.height) { partLive.hidden = true; return; }
    if (insetTop || insetBottom || insetLeft || insetRight) clipPath = `inset(${insetTop}px ${insetRight}px ${insetBottom}px ${insetLeft}px)`;
  }
  Object.assign(partLive.style, {
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
    clipPath,
    zIndex: expanded ? "41" : "",
  });
  partLive.hidden = false;
}

function bindPartTracking() {
  partObserver?.disconnect();
  if (partScrollTarget) partScrollTarget.removeEventListener("scroll", positionPartLive);
  const mount = app.querySelector("[data-part-mount]");
  const page = mount?.closest(".page");
  partScrollTarget = page || null;
  page?.addEventListener("scroll", positionPartLive, { passive: true });
  if (mount && "ResizeObserver" in window) {
    partObserver = new ResizeObserver(positionPartLive);
    partObserver.observe(mount);
  }
}

function glbFor(assetId) {
  return feed?.fleet?.find(row => row.asset_id === assetId)?.glb
    || twinStations?.stations.find(s => s.asset_id === assetId)?.file
    || null;
}

function prefetchTwinAssets(assetId) {
  const urls = [
    `${twinOrigin}/twin/vendor/three.module.js`,
    `${twinOrigin}/twin/vendor/addons/loaders/GLTFLoader.js`,
    `${twinOrigin}/twin/vendor/addons/controls/OrbitControls.js`,
    `${twinOrigin}/twin/viewer.js`,
    `${twinOrigin}/twin/scene.json`,
    `${twinOrigin}/twin/asset-map.json`,
  ];
  const file = glbFor(assetId);
  if (file) urls.push(`${twinOrigin}/twin/glb/${file}`);
  for (const href of urls) {
    if (prefetchedTwin.has(href)) continue;
    prefetchedTwin.add(href);
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.href = href;
    document.head.appendChild(link);
  }
}

function partRequest(route) {
  if (route.path === "/assets" || route.path.startsWith("/assets/")) {
    const id = selectedAsset(route).id;
    const fleet = feed?.fleet?.find(row => row.asset_id === id);
    const issuePart = issuesForAsset(id)[0]?.part;
    return { asset: id, component: issuePart || fleet?.part || "" };
  }
  if (route.path.startsWith("/incidents/")) {
    const item = selectedIncident(route);
    if (!item) return null;
    return { asset: item.asset, component: item.component || "" };
  }
  return null;
}

function postPartIssues(wanted) {
  const parts = issuesMessageParts(wanted);
  const key = JSON.stringify(parts);
  if (partIssuesKey === key) return;
  partIssuesKey = key;
  partFrameWindow()?.postMessage({ type: "twin:issues", parts }, twinOrigin);
}

function syncPart(route) {
  const req = partRequest(route);
  const wanted = req?.asset || null;
  const wantComponent = req?.component || "";
  if (!wanted) {
    parkPartLive();
    return;
  }
  prefetchTwinAssets(wanted);
  if (!partLive) {
    partLive = document.createElement("div");
    partLive.className = "part-live";
    partLive.innerHTML = `<iframe class="floor-frame" title="3D render of the selected station" data-part-frame aria-busy="true"></iframe>`;
    document.body.appendChild(partLive);
  }
  const frame = partLive.querySelector("[data-part-frame]");
  partAsset = wanted;
  if (!partSrcKey) {
    partSrcKey = "part";
    partRequested = wanted;
    partReady = false;
    partSelected = null;
    partSent = null;
    partIssuesKey = null;
    frame.setAttribute("aria-busy", "true");
    const q = new URLSearchParams({ view: "part", asset: wanted });
    if (wantComponent) q.set("component", wantComponent);
    frame.src = `${twinOrigin}/twin/?${q}`;
  } else if (partRequested !== wanted) {
    partRequested = wanted;
    partReady = false;
    partSelected = null;
    partSent = null;
    partIssuesKey = null;
    frame.setAttribute("aria-busy", "true");
    partFrameWindow()?.postMessage({ type: "twin:asset", assetId: wanted }, twinOrigin);
  }
  if (partLive.parentNode !== document.body) document.body.appendChild(partLive);
  positionPartLive();
  bindPartTracking();
  if (!partReady || partLoaded !== wanted) return;
  // Sqlite bus drives issue glow; tape flagged() is inbox chrome only.
  postPartIssues(wanted);
  const fleet = feed.fleet.find(row => row.asset_id === wanted);
  const wantLit = partSelected
    ? partSelected.part
    : (wantComponent || issuesForAsset(wanted)[0]?.part || fleet?.part || null);
  if (partSent !== wantLit) {
    partSent = wantLit;
    if (wantLit) partFrameWindow()?.postMessage({ type: "twin:light", assetId: wanted, part: wantLit }, twinOrigin);
    else partFrameWindow()?.postMessage({ type: "twin:part:clear" }, twinOrigin);
    if (wantLit && !partSelected) partSelected = { asset: wanted, part: wantLit };
  }
}

function handlePartMessage(event) {
  const type = event.data?.type;
  if (type === "twin:ready") {
    partLoaded = typeof event.data.asset_id === "string" ? event.data.asset_id : partAsset;
    partReady = partLoaded === partAsset;
    if (partReady) partLive?.querySelector("[data-part-frame]")?.setAttribute("aria-busy", "false");
    if (partRequested && partLoaded !== partRequested) {
      partFrameWindow()?.postMessage({ type: "twin:asset", assetId: partRequested }, twinOrigin);
    }
    for (const el of app.querySelectorAll("[data-part-status]")) {
      el.dataset.state = partReady ? "ready" : "loading";
      el.textContent = partReady ? "Ready" : "Loading…";
    }
    positionPartLive();
    return;
  }
  if (type === "twin:part") {
    const part = typeof event.data.part === "string" ? event.data.part : null;
    partSelected = part ? { asset: partAsset, part } : null;
    partSent = part;
    render();
  }
}

function handleFloorMessage(event) {
  const type = event.data?.type;
  if (type === "twin:stations") {
    if (!twinStations) {
      twinStations = { cells: event.data.cells || [], stations: event.data.stations || [], license: event.data.license, cite: event.data.cite };
      render();
    }
    return;
  }
  if (type === "twin:ready") {
    floorReady = true;
    floorSent = { view: null, focus: null };
    floorLive?.querySelector("[data-floor-frame]")?.setAttribute("aria-busy", "false");
    syncFloor(getRoute());
    return;
  }
  if (type === "twin:layout") {
    twinAnchors = Array.isArray(event.data.anchors) ? event.data.anchors : [];
    renderFloorLabels();
    return;
  }
  if (type === "twin:select" && typeof event.data.asset_id === "string") {
    // Clicking a machine on the floor opens its Asset 360 (tree rows only select/preview).
    location.hash = hashFor(`/assets/${event.data.asset_id}`, { render: "3d" });
    return;
  }
  if (type === "twin:hover") {
    const id = typeof event.data.asset_id === "string" ? event.data.asset_id : null;
    if (id === floorHover) return;
    floorHover = id;
    renderFloorLabels(); // hovered label gets priority placement even when the line is dense
  }
}

function handleTwinMessage(event) {
  if (event.origin !== twinOrigin) return;
  if (floorLive && event.source === floorFrameWindow()) { handleFloorMessage(event); return; }
  if (partLive && event.source === partFrameWindow()) { handlePartMessage(event); return; }
}

function icon(name, extra = "") {
  return `<svg class="icon ${extra}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

function esc(value = "") {
  return String(value).replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
}

function dash(value) {
  return value === null || value === undefined || value === "" ? "—" : value;
}

function clock(ts) {
  if (!ts) return "—";
  const match = String(ts).match(/T(\d{2}:\d{2}:\d{2})/);
  return match ? match[1] : ts;
}

function hopIndex() {
  if (liveHops?.live && liveHops.latest?.hop != null) return liveHops.latest.hop;
  return cursor;
}

function hopLabel() {
  return `Hop ${hopIndex()}`;
}

function recentHopRows(limit = 6) {
  if (liveHops?.live && liveHops.rms?.length) {
    const latest = liveHops.latest;
    const arr = liveHops.rms.slice(-limit);
    return arr.map((row, i) => {
      const isLast = i === arr.length - 1;
      const src = String(row.source || "");
      const rpp1 = isLast && latest?.rpp1
        ? latest.rpp1
        : {
          file: src.includes("105") ? "105.mat"
            : src.includes("130") ? "130.mat"
            : src.includes("118") ? "118.mat"
            : "97.mat",
          source: row.source,
          window: "—",
          rms: row.value,
          fault: isLast ? latest?.rpp1?.fault : null,
        };
      return { ts: row.ts, rpp1, i: hopIndex() - (arr.length - 1 - i) };
    });
  }
  const healthyEnd = Math.min(9, (feed.hops?.length || 1) - 1);
  const end = Math.min(cursor, healthyEnd);
  return feed.hops.slice(0, end + 1).slice(-limit).map((item, idx, slice) => ({
    ...item,
    i: item.i ?? (end - (slice.length - 1 - idx)),
  }));
}

function hop() {
  if (liveHops?.latest?.rpp1) {
    const latest = liveHops.latest;
    return {
      ts: latest.ts,
      rpp1: latest.rpp1,
      assets: { ...(liveHops.assets || {}), ...(latest.assets || {}), RPP1: { part: "URjoint1", source: latest.rpp1.source, ...(latest.assets?.RPP1 || {}) } },
      t1: (liveHops.assets || {}).T1 || latest.assets?.T1,
    };
  }
  // Fallback: loop healthy hops 0–9 from feed.json so the board never freezes.
  const healthyEnd = Math.min(9, (feed.hops?.length || 1) - 1);
  const idx = healthyLoop ? (cursor % (healthyEnd + 1)) : Math.min(cursor, feed.hops.length - 1);
  return feed.hops[idx];
}

function rmsSeries() {
  if (liveHops?.rms?.length) return liveHops.rms.map((r) => r.value).filter((v) => v != null);
  const end = liveHops?.live ? cursor : Math.min(cursor, 9);
  return feed.hops.slice(0, Math.min(feed.hops.length, end + 1)).map((h) => h.rpp1.rms).filter((v) => v != null);
}

function assetHop(id) {
  const now = hop();
  if (now.assets && now.assets[id]) return now.assets[id];
  if (id === "T1" && now.t1) return now.t1;
  if (id === "RPP1" && now.rpp1) return { part: "URjoint1", source: now.rpp1.source, bus_w: now.rpp1.bus_w, joint1_a: now.rpp1.joint1_a, tags: {} };
  return null;
}

function processTagEntries(slot) {
  if (!slot) return [];
  const tags = slot.tags && Object.keys(slot.tags).length ? slot.tags : Object.fromEntries(
    Object.entries(slot).filter(([k]) => !["part", "source", "tags"].includes(k))
  );
  return Object.entries(tags);
}

function processTagDl(slot) {
  const entries = processTagEntries(slot);
  if (!entries.length) return `<p class="section-note">No process tags on this hop.</p>`;
  const rows = entries.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${dash(v)}</dd>`).join("");
  return `<dl class="key-grid"><dt>Source</dt><dd class="mono">${esc(slot.source || "—")}</dd>${rows}</dl>`;
}

function isHeroAsset(asset) {
  return asset?.id === "RPP1";
}

// Any asset with its own open, cited incident (not just RPP1's live hop replay) - e.g.
// MTR07-CAD/PP5's seeded Mendeley faults. RPP1 keeps its own richer hop-by-hop path.
function diagnosedIncident(asset) {
  return liveIncidents.find((i) => i.asset === asset?.id) || null;
}

function resolveWorkOrder(incident) {
  return incident?.work_order || null;
}

function workOrderForAsset(assetId) {
  return resolveWorkOrder(incidents().find((incident) => incident.asset === assetId));
}

function assetRouteParams(assetId, extra = {}) {
  const incident = incidents().find((item) => item.asset === assetId);
  return { asset: assetId, incident: incident?.id || null, ...extra };
}

function assistable(asset) {
  if (!asset || asset.unmonitored) return false;
  if (isHeroAsset(asset)) return true;
  if (diagnosedIncident(asset)) return true;
  return processTagEntries(assetHop(asset.id)).length > 0;
}

function processStrip(now) {
  const assets = now.assets || {};
  const ids = Object.keys(assets).filter(id => id !== "RPP1").sort();
  if (!ids.length) return "";
  const busyCount = ids.filter(id => assets[id].busy).length;
  const cells = ids.slice(0, 12).map(id => {
    const slot = assets[id];
    const busy = slot.busy;
    const tip = processTagEntries(slot).map(([k, v]) => `${k}=${v}`).join(" · ");
    return `<span class="process-chip mono" data-busy="${busy ? "1" : "0"}" title="${esc(tip)}">${esc(id)}${busy != null ? ` · ${busy ? "busy" : "idle"}` : ""}</span>`;
  }).join("");
  return `<div class="section-note">${busyCount}/${ids.length} stations running now</div><div class="process-strip" aria-label="Fleet process tags">${cells}${ids.length > 12 ? `<span class="section-note">+${ids.length - 12} more</span>` : ""}</div>`;
}

function flagged() {
  return liveIncidents.some((i) => i.asset === "RPP1" && (i.fault === "inner_race" || i.fault === "outer_race" || i.fault === "ball"))
    || Boolean(hop().rpp1?.fault);
}

function fleetAsset(id) {
  return feed.fleet.find(item => item.asset_id === id) || feed.fleet[0];
}

function detections() {
  const live = liveIncidents.find((i) => i.asset === "RPP1");
  if (live) return live.detections || 0;
  if (!hop().rpp1?.fault) return 0;
  return 1;
}

function mapLiveIncident(row) {
  const ageMin = row.ageMin ?? Math.floor((row.age_ms || 0) / 60000);
  const age = ageMin >= 60 ? `${Math.floor(ageMin / 60)}h` : ageMin > 0 ? `${ageMin}m` : `${Math.max(0, Math.floor((row.age_ms || 0) / 1000))}s`;
  return {
    id: row.id,
    priority: row.priority,
    title: row.title,
    asset: row.asset,
    component: row.component,
    area: row.area || feed.cell.name,
    line: row.line || "—",
    cell: row.cell || feed.cell.name,
    status: acknowledgedIds.has(row.id) && row.status === "New" ? "Acknowledged" : row.status,
    ai: row.ai || "L1",
    last: clock(row.last),
    age,
    ageMin,
    detections: row.detections || 1,
    signal: row.signal || "Elevated",
    fault: row.fault,
    source: row.source,
    first: row.first,
    window: row.window,
    rpm: row.rpm,
    rms: row.rms,
    wo_id: row.wo_id,
    work_order: row.work_order,
  };
}

function derivedIncident() {
  // Live path: incidents come from sqlite. Keep derived only as tape fallback for RPP1.
  if (liveIncidents.length) return null;
  if (!hop().rpp1?.fault || !feed?.flag) return null;
  const now = hop();
  const flag = feed.flag;
  const fault = now.rpp1.fault || flag.fault;
  return {
    id: flag.incident_id,
    priority: "Critical",
    title: `${fault.replaceAll("_", " ")} on ${flag.part}`,
    asset: flag.asset_id,
    component: flag.part,
    area: feed.cell.name,
    line: "—",
    cell: feed.cell.name,
    status: acknowledgedIds.has(flag.incident_id) ? "Acknowledged" : "New",
    ai: "L1",
    last: clock(now.ts),
    age: `${Math.max(0, cursor - (feed.manifest?.flag_hop || 10))}s`,
    ageMin: 0,
    detections: detections(),
    signal: now.rpp1.bpfi?.detected ? "Elevated" : "Normal",
    fault,
    source: now.rpp1.source,
    first: now.ts,
    window: now.rpp1.window,
    rpm: now.rpp1.rpm,
    rms: now.rpp1.rms,
    wo_id: flag.wo && flag.wo !== "none" ? flag.wo : null,
    work_order: null,
  };
}

function incidents() {
  if (liveIncidents.length) return liveIncidents.map(mapLiveIncident);
  const item = derivedIncident();
  return item ? [item] : [];
}

function assetsMap() {
  const now = hop();
  const list = incidents();
  const byAsset = Object.fromEntries(list.map((i) => [i.asset, i]));
  const out = {};
  for (const row of feed.fleet) {
    const hit = byAsset[row.asset_id];
    const isHero = row.asset_id === "RPP1";
    const slot = assetHop(row.asset_id);
    out[row.asset_id] = {
      id: row.asset_id,
      name: row.name,
      component: row.part,
      location: feed.cell.name,
      condition: hit ? "Needs attention" : "Healthy",
      incident: hit?.id || null,
      supported: row.asset_id === "RPP1" || processTagEntries(slot).length > 0,
      fault: hit?.fault || (isHero ? (now.rpp1?.fault || "none") : "—"),
      source: isHero ? (now.rpp1?.source || row.source) : (slot?.source || row.source),
      unmonitored: false,
      role: row.role,
    };
  }
  return out;
}

function getRoute() {
  const raw = location.hash.slice(1) || "/incidents";
  const queryAt = raw.indexOf("?");
  const path = queryAt === -1 ? raw : raw.slice(0, queryAt);
  const params = new URLSearchParams(queryAt === -1 ? "" : raw.slice(queryAt + 1));
  return { path: path || "/incidents", params };
}

function hashFor(path, params = {}) {
  const query = params instanceof URLSearchParams ? params : new URLSearchParams(Object.entries(params).filter(([, value]) => value !== "" && value != null));
  const suffix = query.toString();
  return `#${path}${suffix ? `?${suffix}` : ""}`;
}

function updateRoute(changes = {}, path = null) {
  const route = getRoute();
  const next = new URLSearchParams(route.params);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === undefined || value === "") next.delete(key);
    else next.set(key, value);
  }
  location.hash = hashFor(path || route.path, next);
}

function activeModule(path) {
  if (path.startsWith("/incidents")) return "incidents";
  if (path.startsWith("/floor")) return "floor";
  if (path.startsWith("/assets")) return "assets";
  return "intelligence";
}

function selectedIncident(route) {
  const list = incidents();
  const idFromPath = route.path.startsWith("/incidents/") ? route.path.split("/")[2] : null;
  return list.find(item => item.id === (idFromPath || route.params.get("incident"))) || list[0] || null;
}

function selectedAsset(route) {
  const map = assetsMap();
  const idFromPath = route.path.startsWith("/assets/") ? route.path.split("/")[2] : null;
  const incident = selectedIncident(route);
  const id = idFromPath || route.params.get("asset") || incident?.asset || "RPP1";
  if (map[id]) return map[id];
  const station = stationById(id);
  if (station) {
    return { id, name: humanModel(station.model), component: "—", location: `${feed.cell.name} · ${cellName(station.cell)}`, condition: "Unmonitored", supported: false, fault: "—", source: "none", incident: null, unmonitored: true, model: station.model, cell: station.cell };
  }
  return { id, name: id, component: "—", location: feed.cell.name, condition: "Unmonitored", supported: false, fault: "—", source: "none", incident: null, unmonitored: true, model: "Not mapped", cell: null };
}

function statusClass(value) {
  const lower = String(value).toLowerCase();
  if (["critical", "failed", "offline", "rejected", "elevated"].includes(lower)) return "critical";
  if (["high", "warning", "watch", "aging", "needs attention"].includes(lower)) return "warning";
  if (["completed", "answered", "contained", "healthy", "resolved", "validated", "ready", "none"].includes(lower)) return "success";
  if (["running", "new", "acknowledged", "in progress", "queued", "l1"].includes(lower)) return "info";
  return "neutral";
}

function navLink(module, label, iconName, path, count = "") {
  const active = activeModule(getRoute().path) === module;
  return `<a class="nav-link ${active ? "active" : ""}" href="#${path}" ${active ? 'aria-current="page"' : ""}>${icon(iconName)}<span>${label}</span>${count ? `<span class="nav-count">${count}</span>` : ""}</a>`;
}

function breadcrumb(route) {
  if (route.path.startsWith("/incidents/")) return `<span>Incidents</span>${icon("chevron", "sm")}<strong>${esc(route.path.split("/")[2])}</strong>`;
  if (route.path.startsWith("/assets/")) return `<span>Assets</span>${icon("chevron", "sm")}<strong>${esc(route.path.split("/")[2])}</strong>`;
  const labels = { incidents: "Incident Inbox", floor: "Plant Floor", assets: "Asset Registry", intelligence: "Intelligence" };
  return `<strong>${labels[activeModule(route.path)]}</strong>`;
}

function tapeStamp() {
  const now = hop();
  const live = Boolean(liveHops?.live);
  const inj = liveHops?.hop_override ? ` · inject ${liveHops.hop_override.file}` : "";
  return `<div class="refresh-line"><span class="live-dot"></span>${live ? "Live" : "Fallback"} · ${hopLabel()}${inj} · ${clock(now.ts)} · ${esc(now.rpp1?.source || "—")}</div>`;
}

function shell(main, route, rail) {
  const scope = route.params.get("scope") === "site" ? "Entire site" : feed.cell.name;
  const open = incidents().length;
  return `
    <div class="app-shell">
      <nav class="left-nav" aria-label="Primary navigation">
        <div class="brand"><div class="brand-mark"><img src="groundwork-mark.svg" alt=""></div><div class="brand-copy"><strong>Groundwork</strong><span>${esc(feed.cell.name)}</span></div></div>
        <div class="nav-section-label">Workspace</div>
        <div class="nav-list">
          ${navLink("incidents", "Incidents", "inbox", "/incidents", String(open))}
          ${navLink("floor", "Floor", "floor", "/floor?rail=preview")}
          ${navLink("assets", "Assets", "asset", "/assets/RPP1")}
          ${navLink("intelligence", "Intelligence", "intel", "/intelligence")}
        </div>
        <div class="nav-bottom"><div class="nav-system"><span class="system-dot"></span><strong>${liveHops?.live ? "Hop loop" : "Tape fallback"}</strong><small>1 Hz · no egress${liveHops?.hop_override ? " · injected" : ""}</small></div></div>
      </nav>
      <section class="workspace">
        <header class="global-header">
          <div class="breadcrumb">${breadcrumb(route)}</div>
          <div class="header-spacer"></div>
          <button class="header-scope" data-action="toggle-scope" type="button" aria-label="Change plant scope">${icon("pin", "sm")}<span>${esc(scope)}</span>${icon("chevron", "sm")}</button>
          <label class="header-search">${icon("search", "sm")}<span class="sr-only">Search incidents and assets</span><input data-global-search value="${esc(route.params.get("search") || "")}" placeholder="Search incidents or assets" autocomplete="off"></label>
          ${containmentBadge()}
        </header>
        <div class="workspace-body ${rail ? "has-rail" : ""}">
          ${main}
          ${rail || `<button class="rail-trigger" data-action="open-assist" data-focus-id="rail-trigger" type="button" aria-label="Open Maintenance Assist">${icon("spark", "sm")}<span>Maintenance Assist</span></button>`}
        </div>
      </section>
    </div>`;
}

function moduleHeader(title, subtitle, actions = "") {
  return `<div class="module-header"><div class="title-block"><h1 tabindex="-1" id="page-heading">${title}</h1><p class="subtitle">${subtitle}</p></div><div class="header-actions">${actions}</div></div>`;
}

function metricCard(key, label, value, note, tone, active) {
  return `<button class="metric-card ${tone} ${active ? "active" : ""}" data-metric="${key}" type="button" aria-pressed="${active}"><span class="metric-label">${label}</span><span class="metric-value">${value}</span><span class="metric-note">${note}</span></button>`;
}

function metricStat(label, value, note, tone = "", info = "") {
  const tip = info ? `<button class="metric-info" type="button" data-metric-info="${esc(label)}" aria-label="About ${esc(label)}" aria-expanded="${openMetricInfo === label}">${icon("info", "sm")}<span class="metric-tip" role="tooltip">${esc(info)}</span></button>` : "";
  return `<div class="metric-card ${tone}"><div class="metric-head"><span class="metric-label">${label}</span>${tip}</div><span class="metric-value">${value}</span><span class="metric-note">${note}</span></div>`;
}

function filterOption(kind, value, label, count, checked) {
  return `<label class="filter-option"><input type="checkbox" data-filter-kind="${kind}" value="${value}" ${checked ? "checked" : ""}><span>${label}</span><span class="count">${count}</span></label>`;
}

function citationButton(type, label, locator, context = {}) {
  const evidenceContext = [
    context.source ? ` data-evidence-source="${esc(context.source)}"` : "",
    context.window ? ` data-evidence-window="${esc(context.window)}"` : "",
    context.incident ? ` data-evidence-incident="${esc(context.incident)}"` : "",
  ].join("");
  return `<button class="cite-button" data-evidence="${type}"${evidenceContext} type="button">${icon("file", "sm")}<span>${label}</span><span class="mono">${esc(locator)}</span></button>`;
}

function rmsChart(width, height, label) {
  const values = rmsSeries();
  if (!values.length) return `<p class="section-note">No RMS yet — source-gap</p>`;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = values.length === 1 ? 0 : width / (values.length - 1);
  const pts = values.map((v, i) => {
    const x = values.length === 1 ? width : i * step;
    const y = height - 10 - ((v - min) / span) * (height - 20);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = pts[pts.length - 1].split(",");
  const line = pts.map((p, i) => (i ? "L" : "M") + p).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const now = hop();
  return `<div class="trend-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}"><path class="chart-grid" d="M0 20H${width}M0 ${Math.round(height / 2)}H${width}M0 ${height - 10}H${width}"/><path class="chart-area" d="${area}"/><path class="chart-line" d="${line}"/><circle class="chart-dot" cx="${last[0]}" cy="${last[1]}" r="4"/></svg><p class="section-note">${values.length} hops · ${dash(now.rpp1?.source)} · RMS ${dash(now.rpp1?.rms)} g</p></div>`;
}

function filterIncidents(route) {
  const metric = route.params.get("metric") || "all";
  const search = (route.params.get("search") || "").toLowerCase();
  const selectedValues = key => new Set((route.params.get(key) || "").split(",").filter(Boolean));
  const priorities = selectedValues("priority");
  const statuses = selectedValues("status");
  const ai = selectedValues("ai");
  return incidents().filter(item => {
    if (metric === "critical" && item.priority !== "Critical") return false;
    if (metric === "unacknowledged" && item.status !== "New") return false;
    if (metric === "progress" && item.status !== "In progress") return false;
    if (metric === "aging" && item.ageMin < 120) return false;
    if (priorities.size && !priorities.has(item.priority)) return false;
    if (statuses.size && !statuses.has(item.status)) return false;
    if (ai.size && !ai.has(item.ai)) return false;
    if (search && !`${item.id} ${item.title} ${item.asset} ${item.area}`.toLowerCase().includes(search)) return false;
    return true;
  });
}

function inboxPage(route) {
  const metric = route.params.get("metric") || "all";
  const selected = selectedIncident(route);
  const rows = filterIncidents(route);
  const selectedValues = key => new Set((route.params.get(key) || "").split(",").filter(Boolean));
  const priorities = selectedValues("priority");
  const statuses = selectedValues("status");
  const ai = selectedValues("ai");
  const list = incidents();
  const critical = list.filter(item => item.priority === "Critical").length;
  const high = list.filter(item => item.priority === "High").length;
  const unack = list.filter(item => item.status === "New").length;
  const progress = list.filter(item => item.status === "In progress").length;
  const aging = list.filter(item => item.ageMin >= 120).length;
  const clearVisible = metric !== "all" || priorities.size || statuses.size || ai.size || route.params.get("search");
  const table = rows.length ? `<table class="object-table"><thead><tr><th>Priority</th><th>Incident</th><th>Asset</th><th>Area / line</th><th>Case status</th><th>AI state</th><th>Last seen</th><th>Age</th></tr></thead><tbody>${rows.map(item => `
    <tr class="${item.id === selected?.id ? "selected" : ""}" data-select-incident="${item.id}" tabindex="0" aria-selected="${item.id === selected?.id}">
      <td><span class="status ${statusClass(item.priority)}">${item.priority}</span></td>
      <td class="incident-cell"><span class="object-title">${esc(item.title)}</span><span class="object-id"><span class="mono">${item.id}</span> · ${esc(item.signal)} signal</span></td>
      <td class="mono">${item.asset}</td><td>${esc(item.area)}<span class="object-id">${esc(item.line)}</span></td>
      <td><span class="badge ${statusClass(item.status)}">${item.status}</span></td><td><span class="status ${statusClass(item.ai)}">${item.ai}</span></td>
      <td class="num">${item.last}</td><td class="num">${item.age}</td>
    </tr>`).join("")}</tbody></table>` : `<div class="empty-state">${icon("filter", "lg")}<div><h2>${list.length ? "No matching incidents" : "No open incident"}</h2><p>${list.length ? "Current filters exclude all active cases." : "Hop loop healthy. Seeded cases load from sqlite; inject IR on stage."}</p>${list.length ? `<button class="btn" data-action="clear-filters">Clear filters</button>` : ""}</div></div>`;
  return `<main class="page"><div class="page-inner compact">
    ${moduleHeader("Incidents", "Live inbox from sqlite. Seeded High OR + Medium process; Critical IR arrives on inject.", `${tapeStamp()}<button class="btn sm" data-action="toggle-scope">${icon("pin", "sm")} ${route.params.get("scope") === "site" ? "Entire site" : "Cell"}</button>`)}
    <div class="tabs" role="tablist" aria-label="Incident registry view"><button class="tab active" role="tab" aria-selected="true">Active <span class="badge">${list.length}</span></button><button class="tab" role="tab" aria-selected="false" data-action="resolved-view">Resolved <span class="badge">0</span></button></div>
    <div style="height:12px"></div>
    <section class="metric-grid" aria-label="Incident metrics">
      ${metricCard("critical", "Critical", String(critical), critical ? "Live / seeded" : "None open", critical ? "critical" : "", metric === "critical")}
      ${metricCard("unacknowledged", "Unacknowledged", String(unack), unack ? "Needs owner" : "None", unack ? "warning" : "", metric === "unacknowledged")}
      ${metricCard("progress", "In progress", String(progress), high ? `${high} high priority` : "Work underway", progress ? "info" : "", metric === "progress")}
      ${metricCard("aging", "Aging beyond target", String(aging), "Over 2 hours", aging ? "warning" : "", metric === "aging")}
    </section>
    <section class="inbox-layout">
      <aside class="panel filter-panel" aria-label="Incident filters">
        <div class="panel-header"><div class="filter-title">${icon("filter", "sm")}<strong>Filters</strong></div>${clearVisible ? `<button class="filter-clear" data-action="clear-filters">Clear all</button>` : ""}</div>
        <fieldset class="filter-group"><legend>Priority</legend>${filterOption("priority", "Critical", "Critical", critical, priorities.has("Critical"))}${filterOption("priority", "High", "High", high, priorities.has("High"))}${filterOption("priority", "Medium", "Medium", list.filter(i => i.priority === "Medium").length, priorities.has("Medium"))}</fieldset>
        <fieldset class="filter-group"><legend>Case status</legend>${filterOption("status", "New", "New", unack, statuses.has("New"))}${filterOption("status", "Acknowledged", "Acknowledged", list.filter(i => i.status === "Acknowledged").length, statuses.has("Acknowledged"))}</fieldset>
        <fieldset class="filter-group"><legend>AI run state</legend>${filterOption("ai", "L1", "L1", list.filter(i => i.ai === "L1").length, ai.has("L1"))}${filterOption("ai", "Ready", "Ready", list.filter(i => i.ai === "Ready").length, ai.has("Ready"))}</fieldset>
        <div class="filter-group"><span class="filter-group-title">Area / line</span><label class="filter-option"><input type="checkbox" checked disabled><span>${esc(feed.cell.name)}</span><span class="count">${list.length}</span></label></div>
      </aside>
      <div class="panel table-panel"><div class="table-toolbar"><span class="table-count">${rows.length} active incidents</span><span class="section-note">Select a row for preview</span><span class="table-sort">${liveHops?.live ? "Live" : "Fallback"} · ${hopLabel()}</span></div>${table}</div>
    </section>
  </div></main>`;
}

function incidentDetailPage(route) {
  const item = selectedIncident(route);
  const now = hop();
  if (!item) {
    return `<main class="page incident-detail-page"><div class="page-inner compact">${moduleHeader("No incident", "No case selected.", tapeStamp())}<div class="empty-state">${icon("clock", "lg")}<div><h2>Pick an inbox row</h2><p>Seeded cases are in sqlite. Live IR appears after inject.</p></div></div></div></main>`;
  }
  const cmms = feed.cmms.filter(row => row.fault === item.fault);
  const workOrder = resolveWorkOrder(item);
  const inc4Summary = item.id === "INC-4" ? {
    happened: "Inner-race bearing fault detected on URjoint1.",
    workOrder: "Replace the 6205-2RS bearing after technician approval.",
    trust: "BPFI at 161.69 Hz matches the expected 162.19 Hz, with harmonics.",
  } : null;
  const issueHit = boardIssues().find((row) => row.asset_id === item.asset && row.part === item.component);
  const inspectionAsset = issueHit?.asset_id || board?.selection?.asset_id;
  const inspectionComponent = issueHit?.part || board?.work_order?.evidence?.part;
  const mappedGeometry = Boolean(
    inspectionAsset === item.asset &&
    inspectionComponent === item.component &&
    (
      Boolean(issueHit) ||
      board?.fleet?.some(row => row.asset_id === inspectionAsset && row.part === inspectionComponent)
    ),
  );
  const inspectionExpanded = route.params.get("inspection") === "expanded";
  const partShown = partReady && partAsset === item.asset;
  const inspectionNotice = mappedGeometry ? `<button class="btn sm issue-marker" data-action="focus-inspection-target">Issue target: ${esc(item.component)}</button>` : `<span class="section-note">Location unavailable — no mapped geometry.</span>`;
  return `<main class="page incident-detail-page"><div class="page-inner compact">
    ${moduleHeader(`${item.id} · ${esc(item.title)}`, `${item.asset} / ${item.component} · ${esc(item.area)}`, `<button class="btn" data-action="view-floor">${icon("floor", "sm")}View on floor</button><button class="btn ${item.status === "Acknowledged" ? "" : "primary"}" data-action="acknowledge" data-focus-id="acknowledge" aria-pressed="${item.status === "Acknowledged"}">${icon("check", "sm")}${item.status === "Acknowledged" ? "Acknowledged" : "Acknowledge incident"}</button>`)}
    <div class="detail-meta"><span class="badge ${statusClass(item.priority)}">${esc(item.priority)} priority</span><span class="badge ${item.status === "Acknowledged" ? "" : "info"}">${item.status === "Acknowledged" ? "Acknowledged" : item.status}</span><span>${icon("clock", "sm")}last ${item.last} · ${item.detections} detections</span><span>Signal: <strong class="${item.signal === "Elevated" ? "text-warning" : ""}">${item.signal}</strong></span><span>L1: <strong class="text-success">${esc(now.rpp1?.engine || "—")}</strong></span></div>
    <div style="height:10px"></div>
    <section class="question-grid" aria-label="Incident overview">
      <article class="question-card"><span class="question-number">01</span><h2>What happened?</h2><p>${inc4Summary ? inc4Summary.happened : `${esc(now.rpp1.engine)} on ${esc(now.rpp1.source)} window ${esc(now.rpp1.window)}. Fault ${esc(dash(now.rpp1.fault))}. BPFI ${now.rpp1.bpfi.detected ? `${now.rpp1.bpfi.hz} Hz` : "not detected"}.`}</p><div class="inline-citations">${citationButton("signal", "Signal", `${now.rpp1.file} · ${now.rpp1.window}`)}</div></article>
      <article class="question-card action"><span class="question-number">02</span><h2>Work order</h2><p>${inc4Summary ? inc4Summary.workOrder : workOrder ? `<span class="mono">wo: ${esc(workOrder.wo_id || item.wo_id || "—")}</span> · ${esc(workOrder.action || "Review the cited evidence before approval.")}` : "No current work order is attached to this incident."}</p><div class="inline-citations">${cmms.map(row => citationButton("history", "CMMS", row.wo_id)).join("") || `<span class="section-note">No matching CMMS row</span>`}</div></article>
      <article class="question-card trust"><span class="question-number">03</span><h2>Why trust it?</h2><p>${inc4Summary ? inc4Summary.trust : "L0 pointer + L1 scalars. No 12 kHz on the board. ISO 15 kW floor — context only."}</p><div class="inline-citations"><span class="badge ${now.rpp1.rms == null ? "warning" : "success"}">${now.rpp1.rms == null ? "RMS source-gap" : "RMS from window"}</span></div></article>
    </section>
    <section class="panel twin-panel${inspectionExpanded ? " inspection-expanded" : ""}" aria-labelledby="twin-inspection-heading">
      <div class="panel-header"><h2 id="twin-inspection-heading">3D inspection</h2>${inspectionNotice}<button class="btn sm" data-action="toggle-inspection" data-focus-id="inspection-toggle" aria-expanded="${inspectionExpanded}" aria-controls="twin-inspection-frame">${inspectionExpanded ? "Collapse 3D inspection" : "Expand 3D inspection"}</button><p class="twin-status" role="status" aria-live="polite" data-part-status data-state="${partShown ? "ready" : "loading"}">${partShown ? "Ready" : "Loading…"}</p></div>
      <div id="twin-inspection-frame" class="twin-frame twin-mount" data-part-mount aria-hidden="true" title="3D inspection of ${esc(item.asset)} ${esc(item.component)}"></div>
    </section>
    <section class="detail-grid">
      <article class="panel"><div class="panel-header"><h2>L1 hops</h2><span class="badge info" style="margin-left:auto">${hopLabel()}</span></div><div class="panel-body"><div class="timeline">
        ${recentHopRows(6).map(row => `<div class="timeline-row"><span class="timeline-icon">${icon("check", "sm")}</span><div class="timeline-copy"><strong class="mono">${esc(row.rpp1.file || "—")}</strong><span>${esc(row.rpp1.source || "—")} · ${esc(row.rpp1.window || "—")} · RMS ${dash(row.rpp1.rms)} g${row.rpp1.fault ? ` · ${row.rpp1.fault}` : ""}</span></div><time>${clock(row.ts)}</time></div>`).join("")}
      </div></div></article>
      <article class="panel"><div class="panel-header"><h2>Condition</h2><button class="btn sm" data-evidence="signal">Open exact signal</button></div><div class="condition-numbers"><div class="condition-number"><span>RMS</span><strong class="num">${dash(now.rpp1.rms)}<small>g</small></strong></div><div class="condition-number"><span>Speed</span><strong class="num">${dash(now.rpp1.rpm)}<small>rpm</small></strong></div><div class="condition-number"><span>BPFI</span><strong class="num">${dash(now.rpp1.bpfi.hz)}<small>Hz</small></strong></div></div>${rmsChart(320, 80, "RPP1 RMS hops")}<div class="limit-note">${icon("alert", "sm")}ISO 20816 shown as context only; this 2 hp dataset asset is below the 15 kW applicability floor.</div></article>
    </section>
    <section class="detail-grid">
      <article class="panel"><div class="panel-header"><h2>Current work order</h2><span class="badge" style="margin-left:auto">wo: ${esc(workOrder?.wo_id || item.wo_id || "none")}</span></div><div class="work-order">${workOrder ? `<div class="work-order-callout">${icon("wrench")}<div><strong>${esc(workOrder.action || "Review required")}</strong><p>Draft · human approval required</p></div></div><dl class="key-grid"><dt>Priority</dt><dd>${esc(workOrder.priority || item.priority)}</dd><dt>Part</dt><dd class="mono">${esc((workOrder.parts || []).join(", ") || item.component)}</dd><dt>Evidence</dt><dd>${citationButton("signal", "Signal", item.window || "—")}</dd></dl>` : `<div class="work-order-callout">${icon("alert")}<div><strong>No current work order</strong><p>Review cited incident evidence before assigning maintenance.</p></div></div>`}</div></article>
      <article class="panel"><div class="panel-header"><h2>Case activity</h2><span class="section-note" style="margin-left:auto">Live clock</span></div><div class="panel-body activity-list">${item.source ? `<div class="activity-item"><time>${clock(item.first || item.last)}</time><span class="event-mark"></span><div><strong>Opened</strong><p class="mono">${esc(item.source)}${item.window ? ` · ${esc(item.window)}` : ""}</p></div></div>` : ""}<div class="activity-item"><time>${clock(now.ts)}</time><span class="event-mark"></span><div><strong>${hopLabel()}</strong><p>RMS ${dash(now.rpp1?.rms)} g · ${esc(now.rpp1?.file || "—")}</p></div></div></div></article>
    </section>
  </div></main>`;
}

function stationState(id) {
  if (id === "RPP1") return flagged() ? { text: "flag", cls: "text-critical" } : { text: "ok", cls: "" };
  const st = stationById(id);
  if (st?.monitored || feed.fleet.some(r => r.asset_id === id)) return { text: "process", cls: "" };
  return { text: "no sensor", cls: "muted" };
}

function floorTree(route) {
  const selected = selectedAsset(route).id;
  const row = id => { const s = stationState(id); return `<div class="tree-row indent-1 ${selected === id ? "selected" : ""}" data-select-asset="${id}" role="button" tabindex="0" aria-pressed="${selected === id}"><span class="mono">${id}</span><span class="tree-count ${s.cls}">${s.text}</span></div>`; };
  if (!twinStations) {
    return `<div class="tree-row"><strong>${esc(feed.cell.name)}</strong><span class="tree-count">${incidents().length} incidents</span></div>${row("RPP1")}${row("T1")}<p class="tree-note">Loading line geometry…</p>`;
  }
  const cells = [...twinStations.cells].sort((a, b) => a.order - b.order);
  const byCell = id => twinStations.stations.filter(s => s.cell === id).sort((a, b) => b.position[2] - a.position[2]);
  const groups = cells.map(cell => {
    const rows = byCell(cell.id);
    const open = rows.some(s => s.asset_id === selected || s.monitored);
    const flags = rows.filter(s => s.asset_id === "RPP1" && flagged()).length;
    return `<details class="tree-cell" ${open ? "open" : ""}><summary class="tree-row"><span class="tree-cell-name">${esc(cell.name)}</span><span class="tree-count ${flags ? "text-critical" : ""}">${flags ? `${flags} flag · ` : ""}${rows.length}</span></summary>${rows.map(s => row(s.asset_id)).join("")}</details>`;
  }).join("");
  return `<div class="tree-row"><strong>${esc(feed.cell.name)}</strong><span class="tree-count">${incidents().length} incidents</span></div>${groups}`;
}

function floorPage(route) {
  const view = floorView(route);
  const stations = twinStations?.stations || [];
  const monitored = stations.filter(s => s.monitored).length;
  const viewButton = (key, label) => `<button type="button" class="btn sm ${view === key ? "primary" : ""}" data-action="floor-view" data-view="${key}" aria-pressed="${view === key}" data-focus-id="floor-view-${key}">${label}</button>`;
  return `<main class="page"><div class="floor-page">
    <div class="floor-header"><div class="title-block"><h1 id="page-heading" tabindex="-1">Floor</h1><p class="subtitle">${esc(feed.cell.name)} · ${stations.length ? `${stations.length} stations · ${monitored} monitored` : `${feed.fleet.length} monitored · 1 diagnosed`}</p></div><div class="header-actions">${tapeStamp()}${flagged() ? `<span class="badge critical">1 flag</span>` : `<span class="badge">0 flags</span>`}<div class="segmented" role="group" aria-label="Floor view">${viewButton("plan", "Isometric")}${viewButton("top", "Top-down")}</div><button type="button" class="btn sm" data-action="floor-fit" data-focus-id="floor-fit">Fit line</button></div></div>
    <section class="floor-stage" aria-label="Factory floor overview">
      <div class="floor-mount" data-floor-mount aria-hidden="true"></div>
      <aside class="floor-overlay"><div class="floor-overlay-header">${icon("floor", "sm")}Line</div><div class="tree">${floorTree(route)}</div></aside>
      <div class="floor-legend"><span><i class="critical"></i>Flag</span><span><i></i>Monitored</span><span><i class="unmonitored"></i>No sensor</span><span class="floor-license">Scroll zoom · drag to slide · VLFT · CC BY-NC 4.0</span></div>
    </section>
  </div></main>`;
}

// Part-level facts for the Asset 360 3D render. Only the sensor-bound part of a monitored asset
// carries signal/fault data; every other part is geometry with no channel — say so.
function partFacts(asset, part) {
  const now = hop();
  const fleet = feed.fleet.find(row => row.asset_id === asset.id) || null;
  const bound = Boolean(fleet && part && part === fleet.part);
  if (!part) return null;
  if (asset.id === "RPP1" && bound) {
    const incident = derivedIncident();
    return { part, bound: true, source: now.rpp1.source, window: now.rpp1.window, rms: now.rpp1.rms, rpm: now.rpp1.rpm, bpfi: now.rpp1.bpfi?.hz, bus_w: now.rpp1.bus_w, joint1_a: now.rpp1.joint1_a, fault: flagged() ? (now.rpp1.fault || feed.flag.fault) : null, incident, tone: flagged() ? "critical" : "success", state: flagged() ? "Fault flagged" : "No fault on this hop" };
  }
  if (bound) {
    const diag = diagnosedIncident(asset);
    if (diag) {
      return { part, bound: true, source: diag.source, window: diag.window, rms: diag.rms, rpm: diag.rpm, fault: diag.fault, incident: diag, tone: "critical", state: "Fault flagged" };
    }
    const slot = assetHop(asset.id);
    return { part, bound: true, source: slot?.source || fleet.source, slot, fault: null, incident: null, tone: "neutral", state: "Process / electrical tags · never diagnosed" };
  }
  return { part, bound: false, fault: null, incident: null, tone: "neutral", state: "No sensor on this part" };
}

function partPanel(asset) {
  const fleet = feed.fleet.find(row => row.asset_id === asset.id) || null;
  const sel = partSelected && partSelected.asset === asset.id ? partSelected.part : null;
  const facts = partFacts(asset, sel);
  const boundLine = fleet ? `<p class="section-note">Sensor-bound part: <button type="button" class="cite-button mono" data-action="light-part" data-part="${esc(fleet.part)}">${esc(fleet.part)}</button> · ${esc(fleet.source)}</p>` : `<p class="section-note">No sensor bound to any part of this station.</p>`;
  if (!facts) return `<div class="part-detail-body"><div class="rail-kicker">Part</div><p>Click a part of the machine to inspect it.</p>${boundLine}</div>`;
  const badge = `<span class="badge ${facts.tone === "critical" ? "critical" : facts.tone === "success" ? "success" : ""}">${esc(facts.state)}</span>`;
  let body = "";
  if (facts.bound && asset.id === "RPP1") {
    body = `<dl class="key-grid"><dt>Source</dt><dd class="mono">${esc(facts.source)}</dd><dt>Window</dt><dd class="mono">${esc(facts.window)}</dd><dt>RMS</dt><dd>${dash(facts.rms)} g</dd><dt>Speed</dt><dd>${dash(facts.rpm)} rpm</dd><dt>BPFI</dt><dd>${dash(facts.bpfi)} Hz</dd><dt>bus_w</dt><dd>${dash(facts.bus_w)} W</dd><dt>joint1_a</dt><dd>${dash(facts.joint1_a)} A</dd>${facts.fault ? `<dt>Fault</dt><dd class="text-critical">${esc(facts.fault)}</dd>` : ""}</dl>${facts.incident ? `<div class="rail-actions"><button class="btn primary sm" data-open-incident="${facts.incident.id}">Open ${facts.incident.id} ${icon("arrow", "sm")}</button><button class="btn sm" data-evidence="signal">Open exact signal</button></div>` : `<div class="rail-actions"><button class="btn sm" data-evidence="signal">Open exact signal</button></div>`}`;
  } else if (facts.bound && facts.incident) {
    body = `<dl class="key-grid"><dt>Source</dt><dd class="mono">${esc(facts.source)}</dd><dt>Window</dt><dd class="mono">${esc(facts.window)}</dd><dt>RMS</dt><dd>${dash(facts.rms)} g</dd><dt>Speed</dt><dd>${dash(facts.rpm)} rpm</dd>${facts.fault ? `<dt>Fault</dt><dd class="text-critical">${esc(facts.fault)}</dd>` : ""}</dl><div class="rail-actions"><button class="btn primary sm" data-open-incident="${facts.incident.id}">Open ${facts.incident.id} ${icon("arrow", "sm")}</button><button class="btn sm" data-evidence="signal">Open exact signal</button></div>`;
  } else if (facts.bound) {
    body = processTagDl(facts.slot || { source: facts.source });
  } else {
    body = `<p class="section-note">Geometry only. No vibration channel, no faults recorded, nothing to diagnose.</p>`;
  }
  return `<div class="part-detail-body"><div class="rail-kicker">Part</div><div class="rail-heading mono">${esc(facts.part)}</div>${badge}${body}${boundLine}</div>`;
}

function renderPanel(route, asset) {
  const open = route.params.get("render") === "3d";
  if (!open) return "";
  const ready = partReady && partAsset === asset.id;
  // Vertical (portrait) panel: render on top, part facts below; sits in a sticky left column.
  return `<section class="panel render-panel" aria-labelledby="render-heading"><div class="panel-header"><h2 id="render-heading">3D render · ${asset.id}</h2><p class="twin-status" role="status" aria-live="polite" data-part-status data-state="${ready ? "ready" : "loading"}">${ready ? "Ready" : "Loading…"}</p><button class="btn icon-only sm" data-action="toggle-render" data-focus-id="render-toggle" aria-expanded="true" aria-label="Close 3D render">${icon("close")}</button></div><div class="render-body"><div class="render-mount" data-part-mount aria-hidden="true"></div><aside class="part-detail" aria-label="Selected part">${partPanel(asset)}</aside></div><p class="render-note">Grayscale · this station only · drag to orbit · click a part</p></section>`;
}

function assetPage(route) {
  const asset = selectedAsset(route);
  const now = hop();
  const activeTab = route.params.get("tab") || "overview";
  const keep = { tab: activeTab === "overview" ? null : activeTab, render: route.params.get("render") };
  const assetTab = (key, label) => `<a class="tab ${activeTab === key ? "active" : ""}" role="tab" aria-selected="${activeTab === key}" href="${hashFor(`/assets/${asset.id}`, { ...keep, tab: key })}">${label}</a>`;
  const isHero = asset.id === "RPP1";
  const slot = assetHop(asset.id);
  const unmon = Boolean(asset.unmonitored) || !feed.fleet.some(r => r.asset_id === asset.id);
  const diag = !isHero && !unmon ? diagnosedIncident(asset) : null;
  const workOrder = workOrderForAsset(asset.id);
  const history = isHero ? feed.cmms : [];
  const renderOpen = route.params.get("render") === "3d";
  const actions = `<button class="btn" data-action="toggle-render" data-focus-id="render-toggle" aria-expanded="${renderOpen}">${icon("asset", "sm")}${renderOpen ? "Close 3D render" : "Open 3D render"}</button><button class="btn" data-action="view-floor">${icon("floor", "sm")}View on floor</button><button class="btn primary" data-action="open-assist">${icon("spark", "sm")}Ask Maintenance Assist</button>`;
  const ring = isHero ? dash(now.rpp1.rms) : diag ? dash(diag.rms) : unmon ? "—" : dash(slot?.busy ?? Object.values(slot?.tags || {})[0]);
  const ringNote = isHero ? "RMS g · current hop" : diag ? "RMS g · diagnosed" : unmon ? "no sensor bound" : "process / electrical tags";
  const fact2 = isHero ? ["Current RMS", `${dash(now.rpp1.rms)} g`] : diag ? ["Current RMS", `${dash(diag.rms)} g`] : unmon ? ["VLFT model", esc(asset.model)] : ["Tags", String(processTagEntries(slot).length)];
  const condition = isHero
    ? `${flagged() ? `<div class="work-order-callout">${icon("alert")}<div><strong>${esc(asset.fault)} · ${esc(asset.component)}</strong><p class="mono">${esc(now.rpp1.source)} · ${esc(now.rpp1.window)}</p></div></div>` : `<p class="section-note">No flag on this hop.</p>`}${rmsChart(520, 80, "RPP1 RMS")}<dl class="key-grid"><dt>bus_w</dt><dd>${dash(now.rpp1.bus_w)} W</dd><dt>joint1_a</dt><dd>${dash(now.rpp1.joint1_a)} A</dd></dl>`
    : diag
      ? `<div class="work-order-callout">${icon("alert")}<div><strong>${esc(diag.fault)} · ${esc(asset.component)}</strong><p class="mono">${esc(diag.source)} · ${esc(diag.window)}</p></div></div><dl class="key-grid"><dt>RMS</dt><dd>${dash(diag.rms)} g</dd><dt>Speed</dt><dd>${dash(diag.rpm)} rpm</dd><dt>Incident</dt><dd class="mono">${esc(diag.id)}</dd></dl>`
    : unmon
      ? `<dl class="key-grid"><dt>VLFT model</dt><dd class="mono">${esc(asset.model)}</dd><dt>Cell</dt><dd>${esc(cellName(asset.cell))}</dd><dt>Signal source</dt><dd class="mono">none</dd></dl><p class="section-note">Unmonitored station. Geometry only; never diagnosed.</p>`
      : `${processTagDl(slot)}<p class="section-note">Process / electrical tags only. Never diagnosed. Not a vibration channel.</p>`;
  return `<main class="page"><div class="page-inner compact">
    ${moduleHeader(`${asset.id} · ${esc(asset.name)}`, `${esc(asset.location)} · ${esc(asset.component)} · ${esc(asset.source)}`, actions)}
    <div class="tabs" role="tablist">${assetTab("overview", "Overview")}${assetTab("maintenance", "Maintenance")}${assetTab("evidence", "Evidence")}${assetTab("activity", "Activity")}</div><div style="height:10px"></div>
    <div class="asset-layout ${renderOpen ? "has-render" : ""}">${renderOpen ? `<aside class="render-column">${renderPanel(route, asset)}</aside>` : ""}<div class="asset-main">
    <section class="asset-summary"><article class="panel asset-score"><div><div class="asset-score-ring" aria-label="${esc(asset.condition)}">${ring}</div><strong>${esc(asset.condition)}</strong><span>${ringNote}</span></div></article><article class="panel asset-facts"><div class="asset-fact"><span>Open incidents</span><strong class="${asset.incident ? "text-critical" : ""}">${asset.incident || "None"}</strong></div><div class="asset-fact"><span>${fact2[0]}</span><strong class="${unmon ? "mono" : "num"}">${fact2[1]}</strong></div><div class="asset-fact"><span>Last hop</span><strong>${clock(now.ts)}</strong></div><div class="asset-fact"><span>Source</span><strong class="mono">${esc(asset.source)}</strong></div></article></section>
    <section class="asset-columns">
      <div>
        <article class="panel" style="margin-bottom:8px"><div class="panel-header"><h2>Condition</h2>${asset.incident ? `<button class="btn sm primary" data-open-incident="${asset.incident}" style="margin-left:auto">Open incident ${icon("arrow", "sm")}</button>` : ""}</div><div class="panel-body">${condition}</div></article>
        <article class="panel" style="margin-bottom:8px"><div class="panel-header"><h2>Current work order</h2><span class="badge" style="margin-left:auto">${esc(workOrder?.wo_id || "none")}</span></div><div class="panel-body">${workOrder ? `<div class="work-order-callout">${icon("wrench")}<div><strong>${esc(workOrder.action || "Review required")}</strong><p>${esc(workOrder.priority || "Draft")} · human approval required</p></div></div><dl class="key-grid"><dt>Parts</dt><dd class="mono">${esc((workOrder.parts || []).join(", ") || "None specified")}</dd><dt>Incident</dt><dd class="mono">${esc(asset.incident || "—")}</dd></dl>` : `<p class="section-note">No open work order for this asset.</p>`}</div></article>
        <article class="panel"><div class="panel-header"><h2>Maintenance history</h2><span class="section-note" style="margin-left:auto">${isHero ? "Alias MTR-07" : "No CMMS rows"}</span></div>${history.length ? `<table class="simple-table"><thead><tr><th>Work order</th><th>Date</th><th>Fault</th><th>Action / part</th></tr></thead><tbody>${history.map(row => `<tr><td><button class="cite-button mono" data-evidence="history">${esc(row.wo_id)}</button></td><td>${esc(row.opened)}</td><td>${esc(row.fault)}</td><td>${esc(row.action)} · ${esc(row.parts)}</td></tr>`).join("")}</tbody></table>` : `<div class="panel-body"><p class="section-note">—</p></div>`}</article>
      </div>
      <div>
        <article class="panel" style="margin-bottom:8px"><div class="panel-header"><h2>Evidence library</h2></div><div class="panel-body evidence-list">${isHero ? `<div class="evidence-row">${icon("intel")}<div><strong>CWRU window</strong><span class="mono">${esc(now.rpp1.source)}:${esc(now.rpp1.window)}</span></div><button data-evidence="signal">Open</button></div><div class="evidence-row">${icon("clock")}<div><strong>CMMS history</strong><span>${history.length} rows · alias MTR-07</span></div>${history.length ? `<button data-evidence="history">Open</button>` : `<span class="badge">Not available</span>`}</div>` : diag ? `<div class="evidence-row">${icon("intel")}<div><strong>Mendeley window</strong><span class="mono">${esc(diag.source)}:${esc(diag.window)}</span></div><button data-evidence="signal">Open</button></div>${diag.work_order?.citations?.some((c) => c.type === "manual") ? `<div class="evidence-row">${icon("file")}<div><strong>SKF manual</strong><span>Bearing damage analysis, p.214</span></div><button data-evidence="manual">Open</button></div>` : ""}` : unmon ? `<p class="section-note">No sensor, no manual, no CMMS rows on this feed.</p>` : `<p class="section-note">Cited synthetic tags. No vibration cite. Not diagnosed.</p>`}${diag ? "" : `<div class="evidence-row">${icon("file")}<div><strong>Manual</strong><span>Source-gap — no packed page on this feed</span></div><span class="badge">Not available</span></div>`}</div></article>
        <article class="panel"><div class="panel-header"><h2>Recent activity</h2></div><div class="panel-body activity-list"><div class="activity-item"><time>${clock(now.ts)}</time><span class="event-mark"></span><div><strong>${hopLabel()}</strong><p>${isHero ? `RMS ${dash(now.rpp1.rms)} g` : unmon ? "no sensor · geometry only" : processTagEntries(slot).map(([k, v]) => `${k}=${v}`).slice(0, 3).join(" · ")}</p></div></div>${asset.incident ? `<div class="activity-item"><time>${clock(now.ts)}</time><span class="event-mark"></span><div><strong>Open incident</strong><p class="mono">${esc(asset.incident)} · ${esc(asset.fault)}</p></div></div>` : ""}</div></article>
      </div>
    </section>
    </div></div>
  </div></main>`;
}

function currentWorkOrderTable() {
  const rows = incidents()
    .map((incident) => ({ incident, workOrder: resolveWorkOrder(incident) }))
    .filter(({ workOrder }) => Boolean(workOrder));
  if (!rows.length) return `<div class="panel-body"><p class="section-note">No current work orders.</p></div>`;
  return `<table class="simple-table"><thead><tr><th>Work order</th><th>Asset</th><th>Priority</th><th>Action</th><th>Incident</th></tr></thead><tbody>${rows.map(({ incident, workOrder }) => `<tr><td class="mono">${esc(workOrder.wo_id || incident.wo_id || "—")}</td><td class="mono">${esc(incident.asset)}</td><td>${esc(workOrder.priority || incident.priority)}</td><td>${esc(workOrder.action || "Review required")}</td><td><button class="cite-button mono" data-open-incident="${esc(incident.id)}">${esc(incident.id)}</button></td></tr>`).join("")}</tbody></table>`;
}

function intelligencePage(route) {
  const now = hop();
  const rows = recentHopRows(20);
  const run = route.params.get("run") || `HOP-${hopIndex()}`;
  const openCount = incidents().length;
  const faulted = rows.filter((r) => r.rpp1?.fault).length;
  return `<main class="page intelligence-page"><div class="page-inner compact">
    ${moduleHeader("Intelligence", "Always-on L1 hop loop. Open incidents from sqlite.", `${tapeStamp()}<button class="btn" data-evidence="containment">${icon("shield", "sm")}Inspect containment</button>`)}
    <section class="metric-grid" aria-label="Live metrics">${metricStat("Hop", String(hopIndex()), clock(now.ts), "info", "Monotonic hop index from the always-on 1 Hz loop. Not a finite tape replay.")}${metricStat("Open incidents", String(openCount), openCount ? "sqlite inbox" : "clear", openCount ? "critical" : "success", "Active cases in the incident registry — seeded plus live detects.")}${metricStat("RMS", dash(now.rpp1?.rms), "g · current", "", "Window RMS on this hop. ISO 20816 zones do not apply — asset below the 15 kW floor.")}${metricStat("BPFI", dash(now.rpp1?.bpfi?.hz), now.rpp1?.bpfi?.detected ? "detected" : "not detected", "", `Ball-pass inner-race frequency from L1 (${now.rpp1?.engine || "—"}).`)}</section>
    <section class="system-strip" aria-label="System health"><div class="system-cell"><span>Loop</span><strong><i class="live-dot"></i>${liveHops?.live ? "live" : "fallback"} · 1 Hz</strong></div><div class="system-cell"><span>L1</span><strong class="text-success">${icon("check", "sm")}${esc(now.rpp1?.engine || "—")}</strong></div><div class="system-cell"><span>Fleet</span><strong>${feed.fleet.length} monitored</strong></div><div class="system-cell"><span>Containment</span>${containmentCell()}</div></section>
    <section class="panel" style="margin-bottom:8px"><div class="panel-header"><h2>Current work orders</h2><span class="section-note" style="margin-left:auto">Open incident drafts</span></div>${currentWorkOrderTable()}</section>
    <section class="intel-layout">
      <article class="panel"><div class="panel-header"><h2>Recent hops</h2><span class="section-note" style="margin-left:auto">${rows.length} shown${faulted ? ` · ${faulted} faulted` : ""}</span></div><div class="run-list">${rows.map(item => `<div class="run-row ${`HOP-${item.i}` === run ? "selected" : ""}" data-select-run="HOP-${item.i}" tabindex="0"><div class="run-main"><strong class="mono">HOP-${item.i}</strong><span>${clock(item.ts)} · ${esc(item.rpp1.file || "—")}</span><br><span>RMS ${dash(item.rpp1.rms)} g · ${item.rpp1.fault || "healthy"}</span></div><div class="run-side"><span class="status ${statusClass(item.rpp1.fault ? "critical" : "healthy")}">${item.rpp1.fault || "ok"}</span><time>${esc(item.rpp1.window || "—")}</time></div></div>`).join("")}</div></article>
      <article class="panel"><div class="trace-header"><div class="trace-title"><h2>Current hop</h2><span class="badge ${now.rpp1?.fault ? "critical" : "success"}">${now.rpp1?.fault || "Healthy"}</span></div><div class="trace-meta"><span class="mono">${hopLabel()}</span><span>RPP1 / URjoint1</span><span>${clock(now.ts)}</span><span>${esc(now.rpp1?.engine || "—")}</span></div></div><div class="trace-stages">
        <details class="trace-stage" open><summary class="trace-summary"><span class="timeline-icon">${icon("check", "sm")}</span><span class="trace-stage-label">L0</span><strong>DAQ drop</strong><time>${clock(now.ts)}</time></summary><div class="trace-body"><dl><dt>Source</dt><dd class="mono">${esc(now.rpp1?.source || "—")}</dd><dt>Window</dt><dd class="mono">${esc(now.rpp1?.window || "—")}</dd><dt>fs</dt><dd class="num">${dash(now.rpp1?.fs_hz)} Hz</dd></dl><div class="inline-citations">${citationButton("signal", "Signal", now.rpp1?.window || "—")}</div></div></details>
        <details class="trace-stage" open><summary class="trace-summary"><span class="timeline-icon">${icon("check", "sm")}</span><span class="trace-stage-label">L1</span><strong>Condition features</strong></summary><div class="trace-body"><dl><dt>RMS</dt><dd>${dash(now.rpp1?.rms)} g</dd><dt>BPFI</dt><dd>${now.rpp1?.bpfi?.detected ? `${now.rpp1.bpfi.hz} Hz` : "not detected"}</dd><dt>Fault</dt><dd>${dash(now.rpp1?.fault)}</dd><dt>bus_w</dt><dd>${dash(now.rpp1?.bus_w)} W</dd></dl></div></details>
        <details class="trace-stage" open><summary class="trace-summary"><span class="timeline-icon">${icon("check", "sm")}</span><span class="trace-stage-label">Fleet</span><strong>Process / electrical tags</strong></summary><div class="trace-body"><p class="section-note">Cited synthetic tags · not diagnosed</p>${processStrip(now)}${processTagDl(now.t1 || assetHop("T1"))}</div></details>
      </div></article>
    </section>
  </div></main>`;
}

function previewRail(subtitle, body, actions) {
  return `<aside class="utility-rail object-preview-rail" aria-label="Object Preview" data-overlay-rail>
    <div class="rail-header">${icon("eye")}<div class="rail-title"><strong>Object Preview</strong><span>${esc(subtitle)}</span></div><div class="rail-header-actions"><button class="btn icon-only sm" data-action="close-rail" aria-label="Close object preview">${icon("close")}</button></div></div>
    <div class="rail-body">${body}</div>
    <div class="preview-actions">${actions}</div>
  </aside>`;
}

function previewIdentity(kicker, title, badges, context) {
  return `<section class="preview-identity"><div class="rail-kicker">${esc(kicker)}</div><h2 class="rail-heading">${esc(title)}</h2><div class="preview-badges">${badges}</div>${context ? `<p class="preview-context">${esc(context)}</p>` : ""}</section>`;
}

function previewSection(label, title, copy, extra = "") {
  return `<section class="preview-section"><div class="rail-kicker">${esc(label)}</div><strong class="preview-section-title">${esc(title)}</strong>${copy ? `<p>${esc(copy)}</p>` : ""}${extra}</section>`;
}

function humanTag(key) {
  const labels = { busy: "Machine active", cycle_s: "Cycle time", torque_nm: "Torque", spindle_rpm: "Spindle speed", bus_w: "Bus power", joint1_a: "Joint 1 current", current_a: "Current", winding_c: "Winding temperature", belt_m_s: "Belt speed", motor_a: "Motor current", vac_kpa: "Vacuum pressure", clamp_n: "Clamp force", press_n: "Press force", fill_pct: "Fill level", lux: "Illuminance" };
  return labels[key] || humanModel(key).replace(/\b\w/g, c => c.toUpperCase());
}

function humanTagValue(key, value) {
  if (key === "busy") return Number(value) ? "Yes" : "No";
  const units = { cycle_s: "s", torque_nm: "Nm", spindle_rpm: "rpm", bus_w: "W", joint1_a: "A", current_a: "A", winding_c: "°C", belt_m_s: "m/s", motor_a: "A", vac_kpa: "kPa", clamp_n: "N", press_n: "N", fill_pct: "%", lux: "lx" };
  return `${dash(value)}${units[key] ? ` ${units[key]}` : ""}`;
}

function capitalize(value) {
  const text = String(value || "");
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : text;
}

function previewProcessFacts(slot) {
  const rows = processTagEntries(slot).slice(0, 5).map(([key, value]) => `<div class="preview-fact"><span>${esc(humanTag(key))}</span><strong>${esc(humanTagValue(key, value))}</strong></div>`).join("");
  return rows || `<p class="section-note">No process readings on this hop.</p>`;
}

function objectPreviewRail(route) {
  let incident = selectedIncident(route);
  const asset = selectedAsset(route);
  const now = hop();
  if (incident?.asset !== asset.id) incident = incidents().find((item) => item.asset === asset.id) || null;
  const assetWorkOrder = workOrderForAsset(asset.id);
  const hasIncident = Boolean(incident);

  if (hasIncident) {
    const workOrder = resolveWorkOrder(incident) || assetWorkOrder;
    const source = incident.source || "";
    const window = incident.window || "";
    const signalReady = Boolean(source && window);
    const citations = Array.isArray(workOrder?.citations) ? workOrder.citations : [];
    const manualCount = citations.filter(cite => cite.type === "manual").length;
    const historyCount = citations.filter(cite => cite.type === "history").length;
    const location = `${incident.area || asset.location} · ${incident.asset} / ${incident.component}`;
    const action = workOrder?.action || (incident.status === "New" ? "Review the cited signal, then acknowledge this incident." : "Review the incident before starting maintenance work.");
    const evidenceSummary = `${signalReady ? "Signal cited" : "Signal missing"} · ${manualCount ? `${manualCount} manual cite${manualCount === 1 ? "" : "s"}` : "No manual cite"} · ${historyCount ? `${historyCount} history cite${historyCount === 1 ? "" : "s"}` : "No history cite"}`;
    const signalButton = signalReady
      ? citationButton("signal", "Open exact signal", `${source} · ${window}`, { source, window, incident: incident.id })
      : `<span class="preview-gap">Exact signal unavailable</span>`;
    const technical = `<details class="preview-details"><summary>Technical details</summary><dl class="key-grid"><dt>Source</dt><dd class="mono">${esc(source || "—")}</dd><dt>Window</dt><dd class="mono">${esc(window || "—")}</dd><dt>RMS</dt><dd>${incident.rms == null ? "—" : `${dash(incident.rms)} g`}</dd><dt>Speed</dt><dd>${incident.rpm == null ? "—" : `${dash(incident.rpm)} rpm`}</dd><dt>First seen</dt><dd>${esc(clock(incident.first) || "—")}</dd><dt>Last seen</dt><dd>${esc(incident.last || "—")}</dd><dt>Detections</dt><dd>${incident.detections}</dd></dl></details>`;
    const stages = `<div class="preview-stages" aria-label="Analysis state"><div><span class="preview-stage-mark complete">${icon("check", "sm")}</span><span><strong>L1 screening complete</strong><small>${signalReady ? "Incident snapshot retained" : "Source locator missing"}</small></span></div><div><span class="preview-stage-mark ${workOrder ? "complete" : ""}">${workOrder ? icon("check", "sm") : ""}</span><span><strong>L2 work order ${workOrder ? "ready" : "pending"}</strong><small>${workOrder ? esc(workOrder.wo_id || incident.wo_id || "Cited draft") : "No maintenance draft yet"}</small></span></div></div>`;
    const body = `${previewIdentity(incident.id, incident.title, `<span class="badge ${statusClass(incident.priority)}">${esc(incident.priority)} priority</span><span class="badge ${statusClass(incident.status)}">${esc(incident.status)}</span>`, location)}
      ${previewSection("What happened", `${capitalize(humanModel(incident.fault))} detected`, `L1 vibration screening opened this case on ${incident.component}.`, signalButton)}
      ${previewSection("What should I do", workOrder ? "Current work order" : "Next technician step", action, workOrder?.parts?.length ? `<p class="preview-parts"><span>Parts</span> ${esc(workOrder.parts.join(", "))}</p>` : "")}
      ${previewSection("Why trust it", workOrder ? "Evidence-backed draft" : "L1 evidence only", evidenceSummary, stages)}
      ${technical}`;
    const actions = `<button class="btn primary" data-open-incident="${incident.id}">Open incident ${icon("arrow", "sm")}</button><div class="preview-actions-secondary"><button class="btn" data-action="view-floor">${icon("floor", "sm")}View on floor</button><button class="btn" data-action="open-assist">${icon("spark", "sm")}Ask Assist</button></div>`;
    return previewRail(`${incident.id} · Incident`, body, actions);
  }

  if (asset.unmonitored) {
    const body = `${previewIdentity("Unmonitored station", `${asset.id} · ${asset.name}`, `<span class="badge">No sensor connected</span>`, `${asset.location || cellName(asset.cell)}`)}
      <section class="preview-callout unavailable">${icon("alert")}<div><strong>No condition data</strong><p>This station exists in the floor model, but no sensor is connected. No diagnosis or active case is available.</p></div></section>
      <dl class="key-grid preview-meta"><dt>Station model</dt><dd class="mono">${esc(asset.model)}</dd><dt>Cell</dt><dd>${esc(cellName(asset.cell))}</dd><dt>Active case</dt><dd>None</dd></dl>`;
    const actions = `<button class="btn primary" data-action="open-asset">Open Asset 360</button><button class="btn" disabled title="Connect a supported sensor before using Maintenance Assist">${icon("spark", "sm")}Assist unavailable</button>`;
    return previewRail(`${asset.id} · Station`, body, actions);
  }

  if (asset.id !== "RPP1") {
    const slot = assetHop(asset.id);
    const body = `${previewIdentity("Process-monitored asset", `${asset.id} · ${asset.name}`, `<span class="badge info">Process monitoring only</span>`, `${asset.location} · ${asset.component}`)}
      <section class="preview-callout">${icon("intel")}<div><strong>No vibration diagnosis</strong><p>Latest operational tags are available. They are not bearing-condition evidence.</p></div></section>
      <section class="preview-section"><div class="rail-kicker">Latest readings · ${esc(hopLabel())}</div><div class="preview-facts">${previewProcessFacts(slot)}</div></section>
      <details class="preview-details"><summary>Source details</summary><dl class="key-grid"><dt>Source</dt><dd class="mono">${esc(slot?.source || asset.source)}</dd><dt>Component</dt><dd>${esc(asset.component)}</dd><dt>Active case</dt><dd>None</dd></dl></details>`;
    const actions = `<button class="btn primary" data-action="open-asset">Open Asset 360</button><button class="btn" data-action="open-assist">${icon("spark", "sm")}Ask about process tags</button>`;
    return previewRail(`${asset.id} · Asset`, body, actions);
  }

  const currentSource = now.rpp1?.source || asset.source;
  const currentWindow = now.rpp1?.window || "";
  const body = `${previewIdentity("Monitored asset", `${asset.id} · ${asset.name}`, `<span class="badge ${statusClass(asset.condition)}">${esc(capitalize(asset.condition))}</span>`, `${asset.location} · ${asset.component}`)}
    ${asset.incident ? previewSection("Active case", asset.incident, `${capitalize(humanModel(asset.fault))} on ${asset.component}. Open the incident for diagnosis and next steps.`) : ""}
    <section class="preview-section"><div class="rail-kicker">Current condition · ${esc(hopLabel())}</div><div class="preview-facts"><div class="preview-fact"><span>RMS</span><strong>${dash(now.rpp1?.rms)} g</strong></div><div class="preview-fact"><span>Speed</span><strong>${dash(now.rpp1?.rpm)} rpm</strong></div><div class="preview-fact"><span>BPFI</span><strong>${now.rpp1?.bpfi?.detected ? `${dash(now.rpp1.bpfi.hz)} Hz` : "Not detected"}</strong></div></div>${currentWindow ? `<div class="inline-citations">${citationButton("signal", "Open current signal", currentWindow, { source: currentSource, window: currentWindow })}</div>` : ""}</section>
    <details class="preview-details"><summary>Source details</summary><dl class="key-grid"><dt>Source</dt><dd class="mono">${esc(currentSource)}</dd><dt>Window</dt><dd class="mono">${esc(currentWindow || "—")}</dd><dt>Active case</dt><dd>${esc(asset.incident || "None")}</dd></dl></details>`;
  const actions = asset.incident
    ? `<button class="btn primary" data-open-incident="${asset.incident}">Open incident ${icon("arrow", "sm")}</button><div class="preview-actions-secondary"><button class="btn" data-action="open-asset">Open Asset 360</button><button class="btn" data-action="open-assist">${icon("spark", "sm")}Ask Assist</button></div>`
    : `<button class="btn primary" data-action="open-asset">Open Asset 360</button><button class="btn" data-action="open-assist">${icon("spark", "sm")}Ask Maintenance Assist</button>`;
  return previewRail(`${asset.id} · Asset`, body, actions);
}

function assistContext(asset, incident) {
  const now = hop();
  const hero = isHeroAsset(asset);
  const diag = hero ? null : diagnosedIncident(asset);
  const diagnosed = hero || Boolean(diag);
  const slot = assetHop(asset.id);
  const tagCount = processTagEntries(slot).length;
  const flags = hero
    ? `<div class="evidence-flags"><span class="badge ${now.rpp1.rms != null ? "success" : "warning"}">Signal ${now.rpp1.rms != null ? "ready" : "gap"}</span><span class="badge">Manual gap</span><span class="badge ${feed.cmms.length ? "success" : ""}">History ${feed.cmms.length ? "ready" : "gap"}</span></div>`
    : diag
    ? `<div class="evidence-flags"><span class="badge success">Signal ready</span><span class="badge ${diag.work_order ? "success" : ""}">Manual ${diag.work_order?.citations?.some((c) => c.type === "manual") ? "ready" : "gap"}</span><span class="badge">History gap</span></div>`
    : `<div class="evidence-flags"><span class="badge ${tagCount ? "success" : "warning"}">L1 tags ${tagCount ? "ready" : "gap"}</span><span class="badge warning">Signal gap</span><span class="badge">Manual gap</span><span class="badge">History gap</span></div>`;
  const metricLabel = hero ? "RMS" : diag ? "RMS" : "Tags";
  const metricValue = hero ? `${dash(now.rpp1.rms)} g` : diag ? `${dash(diag.rms)} g` : String(tagCount);
  const faultText = hero ? dash(asset.fault) : diag ? dash(diag.fault) : "not diagnosed";
  const incidentId = hero ? (incident?.id || "None") : (diag?.id || "None");
  return `<details class="context-capsule"><summary aria-label="Selected machinery context">${icon("asset", "sm")}<span class="context-summary"><strong class="mono">${asset.id} / ${esc(asset.component)}</strong><span class="context-fault">${esc(diagnosed ? faultText : "process only")}${diagnosed ? ` · ${incidentId}` : ""}</span></span>${icon("chevron", "sm")}</summary><div class="context-detail"><div class="context-grid"><span>Incident</span><strong class="mono">${incidentId}</strong><span>Asset</span><strong class="mono">${asset.id}</strong><span>Component</span><strong>${esc(asset.component)}</strong><span>Fault</span><strong>${esc(faultText)}</strong><span>${metricLabel}</span><strong>${metricValue}</strong><span>Source</span><strong class="mono">${esc(diag ? diag.source : asset.source)}</strong></div><button class="context-change" data-action="view-floor" type="button">Change context</button></div></details>${flags}`;
}

function citationButtons(citations, asset) {
  const now = hop();
  const items = Array.isArray(citations) && citations.length ? citations : [];
  if (!items.length && !isHeroAsset(asset)) {
    const diag = diagnosedIncident(asset);
    if (diag?.work_order?.citations?.length) items.push(...diag.work_order.citations);
  }
  if (!items.length && isHeroAsset(asset)) {
    items.push({ type: "signal", source: now.rpp1.source, window: now.rpp1.window });
    for (const row of feed.cmms) items.push({ type: "history", wo_id: row.wo_id });
  }
  return items.map(cite => {
    if (cite.type === "history") return `<button class="citation-link" data-evidence="history">${icon("clock")}<span>CMMS · ${esc(cite.wo_id)}</span>${icon("external", "sm")}</button>`;
    if (cite.type === "process") return `<button class="citation-link" data-evidence="process">${icon("intel")}<span>${esc(cite.source || asset.source)} · ${hopLabel()}</span>${icon("external", "sm")}</button>`;
    if (cite.type === "manual") return `<button class="citation-link" data-evidence="manual">${icon("file")}<span>${esc(cite.doc || "manual")} p.${cite.page ?? "—"}</span>${icon("external", "sm")}</button>`;
    return `<button class="citation-link" data-evidence="signal">${icon("intel")}<span>${esc(cite.source || now.rpp1.source)} · ${esc(cite.window || now.rpp1.window)}</span>${icon("external", "sm")}</button>`;
  }).join("");
}

function answerContent(question, asset) {
  const now = hop();
  const workOrder = workOrderForAsset(asset.id);
  if (lastAssist && lastAssist.question === question && lastAssist.asset_id === asset.id) {
    const scope = lastAssist.out_of_scope ? " · out of scope" : "";
    return `<div class="assist-message user"><div class="sender">You</div><p>${esc(question)}</p></div><div class="assist-message"><div class="sender">Maintenance Assist · ${esc(lastAssist.model || "Qwen3.6-35B-A3B")}${scope}</div><p>${esc(lastAssist.answer)}</p><div class="citation-list">${citationButtons(lastAssist.citations, asset)}</div></div>`;
  }
  if (isHeroAsset(asset)) {
    const inc = incidents().find((incident) => incident.asset === asset.id) || null;
    const workOrderSummary = workOrder ? `Current work order <span class="mono">${esc(workOrder.wo_id || inc?.wo_id || "—")}</span>: ${esc(workOrder.action || "Review required")}` : "No current work order is attached to this asset.";
    return `<div class="assist-message user"><div class="sender">You</div><p>${esc(question)}</p></div><div class="assist-message"><div class="sender">Maintenance Assist · L1 only</div><p>${workOrderSummary} Numbers below are the current hop.</p><dl class="key-grid"><dt>Fault</dt><dd>${esc(dash(now.rpp1.fault))}</dd><dt>RMS</dt><dd>${dash(now.rpp1.rms)} g</dd><dt>BPFI</dt><dd>${now.rpp1.bpfi.detected ? `${now.rpp1.bpfi.hz} Hz` : "not detected"}</dd><dt>Window</dt><dd class="mono">${esc(now.rpp1.source)}:${esc(now.rpp1.window)}</dd><dt>Incident</dt><dd class="mono">${inc?.id || "—"}</dd></dl><div class="citation-list">${citationButtons(workOrder?.citations, asset)}</div></div>`;
  }
  const diag = diagnosedIncident(asset);
  if (diag) {
    return `<div class="assist-message user"><div class="sender">You</div><p>${esc(question)}</p></div><div class="assist-message"><div class="sender">Maintenance Assist · L1 only</div><p>Cited fault on <span class="mono">${esc(asset.id)}</span>: ${esc(diag.fault)}. wo: ${esc(workOrder?.wo_id || "none")}.</p><dl class="key-grid"><dt>Fault</dt><dd>${esc(diag.fault)}</dd><dt>RMS</dt><dd>${dash(diag.rms)} g</dd><dt>Speed</dt><dd>${dash(diag.rpm)} rpm</dd><dt>Window</dt><dd class="mono">${esc(diag.source)}:${esc(diag.window)}</dd><dt>Incident</dt><dd class="mono">${diag.id}</dd></dl><div class="citation-list">${citationButtons(workOrder?.citations, asset)}</div></div>`;
  }
  const slot = assetHop(asset.id);
  const entries = processTagEntries(slot);
  const rows = entries.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${dash(v)}</dd>`).join("");
  return `<div class="assist-message user"><div class="sender">You</div><p>${esc(question)}</p></div><div class="assist-message"><div class="sender">Maintenance Assist · L1 process tags</div><p>No vibration channel on <span class="mono">${esc(asset.id)}</span>. Not diagnosed. No work order. Numbers are this hop's cited process / electrical tags.</p><dl class="key-grid"><dt>Part</dt><dd class="mono">${esc(slot?.part || asset.component)}</dd><dt>Source</dt><dd class="mono">${esc(slot?.source || asset.source)}</dd>${rows}</dl><div class="citation-list"><button class="citation-link" data-evidence="process">${icon("intel")}<span>${esc(slot?.source || asset.source)} · ${hopLabel()}</span>${icon("external", "sm")}</button></div></div>`;
}

function assistSuggestions(asset) {
  if (isHeroAsset(asset)) {
    return `<div class="suggestions" aria-label="Suggested bounded questions"><button class="suggestion" data-suggestion="What L1 features are on this hop?">What L1 features are on this hop?</button><button class="suggestion" data-suggestion="Has the flag fired?">Has the flag fired?</button><button class="suggestion" data-suggestion="Show the exact evidence window.">Show the exact evidence window</button></div>`;
  }
  if (diagnosedIncident(asset)) {
    return `<div class="suggestions" aria-label="Suggested bounded questions"><button class="suggestion" data-suggestion="What is the cited fault?">What is the cited fault?</button><button class="suggestion" data-suggestion="Show the exact evidence window.">Show the exact evidence window</button><button class="suggestion" data-suggestion="What is the work order?">What is the work order?</button></div>`;
  }
  return `<div class="suggestions" aria-label="Suggested bounded questions"><button class="suggestion" data-suggestion="What L1 tags are on this hop?">What L1 tags are on this hop?</button><button class="suggestion" data-suggestion="Is this station busy?">Is this station busy?</button><button class="suggestion" data-suggestion="What is the cite for these tags?">What is the cite for these tags?</button></div>`;
}

function assistPipeline(asset, state) {
  const now = hop();
  if (isHeroAsset(asset)) {
    const l2 = state === "answered" && lastAssist?.model ? lastAssist.model : "Qwen3.6-35B-A3B · :8000";
    return `<div class="assist-run"><details class="assist-details" ${state === "running" ? "open" : ""}><summary>${icon("intel", "sm")}Processing stages<span class="status ${state === "failed" ? "critical" : state === "running" ? "info" : "success"}">${state === "running" ? "Running" : state === "failed" ? "Failed" : "Ready"}</span></summary><div class="pipeline-mini"><div class="pipeline-step"><span class="pipeline-dot">${icon("check", "sm")}</span><div><strong>L0 pointer</strong><span>${esc(now.rpp1.file)}</span></div></div><div class="pipeline-step"><span class="pipeline-dot">${icon("check", "sm")}</span><div><strong>L1 features</strong><span>${esc(now.rpp1.engine)}</span></div></div><div class="pipeline-step"><span class="pipeline-dot">${state === "answered" ? icon("check", "sm") : ""}</span><div><strong>L2 local model</strong><span>${esc(l2)}</span></div></div><div class="pipeline-step"><span class="pipeline-dot"></span><div><strong>L2 work order</strong><span>wo: ${esc(feed.flag.wo)}</span></div></div></div></details><button class="btn" data-action="open-full-run">Open full run ${icon("arrow", "sm")}</button></div>`;
  }
  const diag = diagnosedIncident(asset);
  if (diag) {
    return `<div class="assist-run"><details class="assist-details" ${state === "running" ? "open" : ""}><summary>${icon("intel", "sm")}Processing stages<span class="status ${state === "failed" ? "critical" : state === "running" ? "info" : "success"}">${state === "running" ? "Running" : state === "failed" ? "Failed" : "Ready"}</span></summary><div class="pipeline-mini"><div class="pipeline-step"><span class="pipeline-dot">${icon("check", "sm")}</span><div><strong>L0 pointer</strong><span>${esc(diag.source)}</span></div></div><div class="pipeline-step"><span class="pipeline-dot">${icon("check", "sm")}</span><div><strong>L1 features</strong><span>fault=${esc(diag.fault)} rms=${dash(diag.rms)}g</span></div></div><div class="pipeline-step"><span class="pipeline-dot">${icon("check", "sm")}</span><div><strong>L2 work order</strong><span>wo: ${esc(diag.wo_id || "none")}</span></div></div></div></details></div>`;
  }
  const slot = assetHop(asset.id);
  const n = processTagEntries(slot).length;
  return `<div class="assist-run"><details class="assist-details" ${state === "running" ? "open" : ""}><summary>${icon("intel", "sm")}Processing stages<span class="status ${state === "failed" ? "critical" : state === "running" ? "info" : "success"}">${state === "running" ? "Running" : state === "failed" ? "Failed" : "Ready"}</span></summary><div class="pipeline-mini"><div class="pipeline-step"><span class="pipeline-dot">${icon("check", "sm")}</span><div><strong>L1 process tags</strong><span>${n} · ${esc(slot?.source || asset.source)}</span></div></div><div class="pipeline-step"><span class="pipeline-dot"></span><div><strong>L0 vibration</strong><span>none on this asset</span></div></div><div class="pipeline-step"><span class="pipeline-dot"></span><div><strong>L2 work order</strong><span>not opened · never diagnosed</span></div></div></div></details></div>`;
}

function assistRail(route) {
  const incident = selectedIncident(route);
  const asset = selectedAsset(route);
  const canAssist = assistable(asset);
  let state = route.params.get("assistState") || (canAssist ? "ready" : "unsupported");
  if (!canAssist) state = "unsupported";
  else if (state === "unsupported") state = "ready";
  const question = route.params.get("question") || draftQuestion || (isHeroAsset(asset) ? "What L1 features are on this hop?" : "What L1 tags are on this hop?");
  let body = assistContext(asset, incident);
  let footer = "";
  if (state === "ready") {
    body += `<div class="assist-empty">${icon("spark")}<p>Ask about this hop. Local Qwen answers from the L1 ${isHeroAsset(asset) ? "scalars" : "process / electrical tags"} on <span class="mono">${esc(asset.source)}</span>; no invented manual pages.${isHeroAsset(asset) ? "" : " Not diagnosed."}</p></div>`;
    footer += assistSuggestions(asset);
  }
  if (state === "running") body += `<div class="assist-message user"><div class="sender">You</div><p>${esc(question)}</p></div><div class="assist-state" aria-busy="true"><strong>${icon("spark")}Thinking</strong><p>Reading this hop.</p><div class="progress-track"><span></span></div></div>`;
  if (state === "answered") body += answerContent(question, asset);
  if (state === "unsupported") body += `<div class="assist-state warning"><strong>${icon("alert")}Assistant unavailable for ${asset.id}</strong><p>No L1 tags on this station. Geometry only — nothing to bind. Pick a monitored asset.</p><div class="rail-actions"><button class="btn" data-action="select-supported">Select supported RPP1 context</button></div></div>`;
  if (state === "failed") body += `<div class="assist-message user"><div class="sender">You</div><p>${esc(question)}</p></div><div class="assist-state error" role="alert"><strong>${icon("alert")}Run failed</strong><p>Question retained.</p><div class="rail-actions"><button class="btn danger" data-action="retry-assist">Retry question</button></div></div>`;
  if (state === "offline") body += `<div class="assist-state offline" role="alert"><strong>${icon("alert")}Local gateway offline</strong><p>Feed replay still runs. Answers disabled.</p><dl class="key-grid"><dt>Gateway</dt><dd class="text-critical">Offline</dd><dt>Draft</dt><dd>Retained locally</dd></dl></div>`;
  if (state !== "unsupported") body += assistPipeline(asset, state);
  const disabled = ["running", "unsupported", "offline"].includes(state);
  if (state !== "unsupported") footer += `<form class="composer" data-assist-form><label for="assist-question">Ask about this hop</label><div class="composer-box"><textarea id="assist-question" ${disabled ? "disabled" : ""} placeholder="${isHeroAsset(asset) ? "Ask about L1 features or the flag" : "Ask about this hop's L1 tags"}">${state === "failed" ? esc(question) : ""}</textarea><button class="btn primary icon-only ${state === "running" ? "loading" : ""}" type="submit" ${disabled ? "disabled" : ""} aria-label="Send question">${state === "running" ? "" : icon("arrow")}</button></div><p class="composer-hint">Enter to send · Shift+Enter for a new line</p></form>`;
  return `<aside class="utility-rail assist-rail" aria-label="Maintenance Assist" data-overlay-rail><div class="rail-header">${icon("spark")}<div class="rail-title"><strong>Maintenance Assist</strong><span>${asset.id} / ${asset.component} · L1 feed</span></div><div class="rail-header-actions"><span class="badge dark">LOCAL</span><button class="btn icon-only sm" data-action="close-rail" aria-label="Close Maintenance Assist">${icon("close")}</button></div></div><div class="rail-body">${body}</div>${footer ? `<div class="assist-footer">${footer}</div>` : ""}</aside>`;
}

// Containment comes only from /api/board → app/lib/openshell.mjs (gateway audit log). Never from feed.json.
function containment() {
  const c = board?.containment;
  if (!c || !Array.isArray(c.denies)) return { state: board ? "UNPROVEN" : "OFFLINE", denies: [], deny_count: 0, policy: null, errors: [board ? "board has no containment block" : "/api/board unreachable — prototype must be served by app/server.mjs"], sandbox: null, last_deny: null };
  return c;
}
function containmentBadge() {
  const c = containment();
  const proven = c.state === "CONTAINED" && c.denies.length > 0;
  const label = proven ? "Local · Contained" : c.state === "UNSAFE" ? "Local · UNSAFE" : "Local · Unproven";
  const title = proven ? `OpenShell ${c.sandbox}: ${c.deny_count} egress deny in gateway audit` : c.state === "UNSAFE" ? "Sandbox reached an external host" : "No deny audit line read from OpenShell yet";
  return `<button class="contained-badge" data-evidence="containment" type="button" title="${esc(title)}" style="${proven ? "" : "opacity:.7"}">${icon(c.state === "UNSAFE" ? "alert" : "shield", "sm")}<span>${label}</span></button>`;
}
function containmentCell() {
  const c = containment();
  if (c.state === "CONTAINED" && c.denies.length) return `<strong class="text-success">${icon("check", "sm")}CONTAINED · ${c.deny_count} deny</strong>`;
  if (c.state === "UNSAFE") return `<strong class="text-critical">${icon("alert", "sm")}UNSAFE · egress allowed</strong>`;
  if (c.state === "OFFLINE") return `<strong>gateway offline</strong>`;
  return `<strong>unproven · no deny audit yet</strong>`;
}
function containmentRail(c) {
  const busy = attemptState === "running";
  const policy = c.policy && !c.policy.error ? `<dl class="key-grid"><dt>Sandbox</dt><dd class="mono">${esc(c.sandbox || "—")}</dd><dt>Policy</dt><dd class="mono">v${c.policy.version ?? "—"} · ${esc(c.policy.status || "—")}</dd><dt>Hash</dt><dd class="mono">${esc((c.policy.hash || "").slice(0, 16))}${c.policy.hash ? "…" : "—"}</dd><dt>Inference</dt><dd class="mono">${esc(c.inference || "inference.local")}</dd><dt>Read</dt><dd class="mono">${esc(c.fetched_at ? clock(c.fetched_at) : "—")}</dd></dl>` : `<p class="section-note">Policy not readable${c.policy?.error ? `: ${esc(c.policy.error)}` : ""}.</p>`;
  const attempt = `<div class="rail-actions"><button class="btn ${c.state === "UNSAFE" ? "danger" : "primary"}" data-action="attempt-exfil" ${busy ? "disabled" : ""}>${icon("shield", "sm")}${busy ? "Attempting telemetry POST…" : "Attempt telemetry POST from sandbox"}</button></div>${attemptState === "failed" ? `<div class="assist-state error" role="alert"><strong>${icon("alert")}Attempt did not produce a deny line</strong><p>${esc(attemptError || "curl left the sandbox or the gateway logged nothing.")}</p></div>` : ""}`;
  const head = c.state === "CONTAINED" && c.denies.length
    ? `<section class="rail-section"><div class="rail-kicker">OpenShell gateway</div><div class="rail-heading">Egress denied · ${c.deny_count} audit line${c.deny_count === 1 ? "" : "s"}</div><p>Lines below are read live via <span class="mono">${esc(c.source || "openshell logs")}</span>. Not seeded, not on the tape.</p>${policy}</section>`
    : c.state === "UNSAFE"
      ? `<section class="rail-section"><div class="rail-kicker">OpenShell gateway</div><div class="rail-heading">Egress succeeded</div><p>The sandbox reached an external host. Containment claim withdrawn until policy is fixed.</p>${policy}</section>`
      : `<section class="rail-section"><div class="rail-kicker">OpenShell gateway</div><div class="rail-heading">Unproven</div><p>No <span class="mono">NET:OPEN DENIED</span> line in the gateway log yet. Trigger one below; nothing here is asserted without it.</p>${policy}${(c.errors || []).length ? `<p class="section-note">${c.errors.map(esc).join(" · ")}</p>` : ""}</section>`;
  const lines = c.denies.length ? `<section class="rail-section"><div class="rail-kicker">OCSF audit</div>${[...c.denies].reverse().map(d => `<div class="evidence-document" style="margin-bottom:6px">${d.ts ? `${esc(clock(d.ts))} ` : ""}<mark>DENIED</mark> ${esc(d.process || "?")}(${d.pid ?? "?"}) → <mark>${esc(d.dest || "?")}</mark><br>engine: ${esc(d.engine || "—")} · policy: ${esc(d.policy || "gateway")}<br>${d.reason ? `reason: ${esc(d.reason)}<br>` : ""}<span style="opacity:.65">${esc(d.raw)}</span></div>`).join("")}</section>` : "";
  return `${head}${attempt}${lines}`;
}
let attemptState = "idle", attemptError = "";
async function refreshBoard() {
  const response = await fetchBoard().catch(() => null);
  const next = response?.ok ? await response.json() : board;
  const beforeIssues = JSON.stringify(board?.issues);
  board = next;
  return beforeIssues !== JSON.stringify(board?.issues);
}

async function refreshLive() {
  const [incRes, hopRes, issuesChanged] = await Promise.all([
    fetchIncidents().catch(() => null),
    fetchHops().catch(() => null),
    refreshBoard(),
  ]);
  let incidentsChanged = false;
  let hopsChanged = false;
  if (incRes?.ok) {
    const data = await incRes.json();
    const next = data.incidents || [];
    if (JSON.stringify(next) !== JSON.stringify(liveIncidents)) {
      liveIncidents = next;
      incidentsChanged = true;
    }
  }
  if (hopRes?.ok) {
    const data = await hopRes.json();
    const before = JSON.stringify(liveHops?.latest);
    liveHops = data;
    if (data.latest) {
      cursor = data.latest.hop ?? cursor;
      healthyLoop = false;
    }
    if (JSON.stringify(data.latest) !== before) hopsChanged = true;
    const busy = Object.entries(data.assets || {}).filter(([, slot]) => slot?.busy).map(([id]) => id);
    postFloor({ type: "twin:flow", busy });
  }
  if (issuesChanged || hopsChanged) {
    const parts = boardIssues().filter((row) => row.part).map((row) => ({ assetId: row.asset_id, part: row.part, severity: row.severity || "critical" }));
    postFloor({ type: "twin:issues", parts });
  }
  return { incidents: incidentsChanged, hops: hopsChanged, issues: issuesChanged };
}

function softLiveTick() {
  const active = document.activeElement;
  return Boolean(app.querySelector("[data-part-mount], [data-floor-mount]"))
    || active?.id === "assist-question"
    || Boolean(active?.matches?.("[data-global-search]"));
}

function refreshIncidentLive() {
  const current = app.querySelector(".incident-detail-page");
  const currentInner = current?.querySelector(":scope > .page-inner");
  const mountedPart = currentInner?.querySelector("[data-part-mount]");
  const route = getRoute();
  if (!currentInner || !mountedPart || !route.path.startsWith("/incidents/")) return false;

  const focusId = current.contains(document.activeElement) ? document.activeElement?.dataset.focusId : null;
  const container = document.createElement("div");
  container.innerHTML = incidentDetailPage(route);
  const nextInner = container.firstElementChild?.querySelector(":scope > .page-inner");
  if (!nextInner) return false;

  const currentChildren = [...currentInner.children];
  const nextChildren = [...nextInner.children];
  const mountedIndex = currentChildren.findIndex(child => child.contains(mountedPart));
  const nextMountedIndex = nextChildren.findIndex(child => child.querySelector("[data-part-mount]"));
  if (mountedIndex < 0 || mountedIndex !== nextMountedIndex || currentChildren.length !== nextChildren.length) return false;

  currentChildren.forEach((child, index) => {
    if (index !== mountedIndex) child.replaceWith(nextChildren[index]);
  });
  if (focusId) requestAnimationFrame(() => current.querySelector(`[data-focus-id="${focusId}"]`)?.focus({ preventScroll: true }));
  return true;
}

function applyLiveTick() {
  refreshIncidentLive();
  const stamp = app.querySelector(".refresh-line");
  if (stamp) {
    const next = document.createElement("div");
    next.innerHTML = tapeStamp();
    const node = next.firstElementChild;
    if (node) stamp.replaceWith(node);
  }
  positionFloorLive();
  positionPartLive();
}

async function injectFault(source = "ir", hops = 30) {
  try {
    const response = await fetch(`${apiBase()}/api/demo/inject`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source, hops }),
    });
    const data = await response.json().catch(() => ({}));
    console.info("inject", data);
    await refreshLive();
    render();
  } catch (err) {
    console.warn("inject failed", err);
  }
}

async function postDetectOnce() {
  // Live hop-loop posts detect itself. Tape fallback only.
  if (liveHops?.live || detectPosted || !hop().rpp1?.fault) return;
  detectPosted = true;
  const now = hop();
  const payload = {
    asset_id: "RPP1",
    part: "URjoint1",
    fault: now.rpp1.fault,
    source: now.rpp1.source,
    window: now.rpp1.window,
    rpm: now.rpp1.rpm,
    rms: now.rpp1.rms,
    ts: now.ts,
  };
  try {
    const response = await fetch(`${apiBase()}/api/detect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      detectPosted = false;
      return;
    }
  } catch (err) {
    detectPosted = false;
    return;
  }
  partIssuesKey = null;
  await refreshLive();
  render();
}
async function attemptExfil() {
  if (attemptState === "running") return;
  attemptState = "running"; attemptError = ""; render();
  try {
    const response = await fetch("/api/containment/attempt", { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { attemptState = "failed"; attemptError = data.error || data.stderr || `gateway returned ${response.status}`; }
    else attemptState = "idle";
  } catch (error) { attemptState = "failed"; attemptError = error.message; }
  await refreshBoard();
  render();
}

function evidenceRail(route) {
  const type = route.params.get("evidence") || "signal";
  const expanded = route.params.get("expanded") === "1";
  const now = hop();
  const evidenceIncidentId = route.params.get("evidenceIncident");
  const evidenceIncident = evidenceIncidentId ? incidents().find(item => item.id === evidenceIncidentId) : null;
  const signal = {
    source: route.params.get("evidenceSource") || now.rpp1?.source || "",
    window: route.params.get("evidenceWindow") || now.rpp1?.window || "",
    rms: evidenceIncident?.rms ?? now.rpp1?.rms,
    rpm: evidenceIncident?.rpm ?? now.rpp1?.rpm,
  };
  const incidentSnapshot = Boolean(evidenceIncident);
  const cont = containment();
  const contProven = cont.state === "CONTAINED" && cont.denies.length > 0;
  const titles = { manual: ["Manual evidence", "source-gap"], history: ["History evidence", "CMMS"], signal: ["Signal evidence", evidenceIncident?.id || now.rpp1.file], process: ["Process tags", selectedAsset(route).id], containment: ["Containment evidence", contProven ? `openshell · ${cont.sandbox}` : cont.state === "UNSAFE" ? "UNSAFE" : "source-gap"] };
  const gap = type === "manual" || (type === "containment" && !contProven && cont.state !== "UNSAFE");
  let content = "";
  if (type === "manual") content = `<section class="rail-section"><div class="rail-kicker">Manual</div><div class="rail-heading">Source-gap</div><p>No packed SKF page in this feed. Will not invent a quote.</p></section>`;
  if (type === "history") content = feed.cmms.length ? `<section class="rail-section"><div class="rail-kicker">CMMS rows</div><div class="rail-heading">Alias MTR-07 → RPP1</div></section>${feed.cmms.map(row => `<div class="evidence-document">wo_id: <mark>${esc(row.wo_id)}</mark><br>asset_id: ${esc(row.asset_id)}<br>opened: ${esc(row.opened)}<br>closed: ${dash(row.closed)}<br>fault: <mark>${esc(row.fault)}</mark><br>action: <mark>${esc(row.action)}</mark><br>parts: <mark>${esc(row.parts)}</mark><br>source: ${esc(row.source)}</div>`).join("")}` : `<section class="rail-section"><p>No CMMS rows for this asset.</p></section>`;
  if (type === "signal") content = `<section class="rail-section"><div class="rail-kicker">Exact signal window</div><div class="rail-heading mono">${esc(signal.source || "—")}</div><dl class="key-grid"><dt>Window</dt><dd class="num">${esc(signal.window || "—")}</dd><dt>Sampling</dt><dd class="num">${incidentSnapshot ? "Not retained" : `${dash(now.rpp1?.fs_hz)} Hz`}</dd><dt>Speed</dt><dd class="num">${signal.rpm == null ? "—" : `${dash(signal.rpm)} rpm`}</dd><dt>RMS</dt><dd class="num">${signal.rms == null ? "—" : `${dash(signal.rms)} g`}</dd><dt>BPFI</dt><dd>${incidentSnapshot ? "Not retained in incident snapshot" : now.rpp1?.bpfi?.detected ? `${now.rpp1.bpfi.hz} Hz` : "not detected"}</dd></dl></section>${incidentSnapshot ? "" : rmsChart(340, 105, "RPP1 RMS series")}<div class="limit-note">${icon("alert", "sm")}${incidentSnapshot ? `Incident locator retained from ${esc(evidenceIncident.id)}; current-hop values are not substituted.` : `No 12 kHz samples on the board. Locator retains ${esc(now.rpp1?.file || "—")} ${esc(signal.window)}.`}</div>`;
  if (type === "process") {
    const asset = selectedAsset(route);
    const slot = assetHop(asset.id);
    content = `<section class="rail-section"><div class="rail-kicker">Cited L1 tags</div><div class="rail-heading mono">${esc(asset.id)} · ${esc(slot?.source || asset.source)}</div>${processTagDl(slot)}<p class="section-note">Synthetic process / electrical tags from the catalog cite. Not a vibration channel. Never diagnosed.</p></section>`;
  }
  if (type === "containment") content = containmentRail(cont);
  return `<aside class="utility-rail" aria-label="Evidence Viewer" data-overlay-rail><div class="rail-header">${icon("file")}<div class="rail-title"><strong>${titles[type][0]}</strong><span>${titles[type][1]}</span></div><div class="rail-header-actions"><button class="btn sm" data-action="return-rail">${icon("back", "sm")}Back</button><button class="btn icon-only sm" data-action="close-rail" aria-label="Close Evidence Viewer">${icon("close")}</button></div></div><div class="rail-body"><div class="viewer-toolbar"><span class="badge ${gap ? "warning" : cont.state === "UNSAFE" && type === "containment" ? "critical" : "success"}">${gap ? "Source-gap" : type === "containment" ? "Gateway audit" : "Feed artifact"}</span></div>${content}${type === "manual" && expanded ? `<p class="section-note">Still no page.</p>` : ""}${type === "manual" ? `<button class="btn" style="width:100%;margin-top:12px" data-action="expand-evidence">${expanded ? "Collapse full artifact" : "Open full artifact"}</button>` : ""}</div></aside>`;
}

function captureTypedField() {
  const ta = document.getElementById("assist-question");
  if (ta) draftQuestion = ta.value;
  const el = document.activeElement;
  if (!el || !app.contains(el)) return null;
  if (el.id !== "assist-question" && !el.matches("[data-global-search]")) return null;
  return { assist: el.id === "assist-question", value: el.value, start: el.selectionStart, end: el.selectionEnd };
}

function restoreTypedField(saved) {
  if (!saved) return false;
  const el = saved.assist ? document.getElementById("assist-question") : app.querySelector("[data-global-search]");
  if (!el || el.disabled) return false;
  el.value = saved.value;
  el.focus({ preventScroll: true });
  try { el.setSelectionRange(saved.start ?? el.value.length, saved.end ?? el.value.length); } catch {}
  return true;
}

function render() {
  if (!feed) {
    app.innerHTML = `<main class="page"><div class="page-inner compact"><p>Loading feed.json…</p></div></main>`;
    return;
  }
  const savedField = captureTypedField();
  const savedPageScroll = app.querySelector(".page")?.scrollTop ?? 0;
  const savedRailScroll = app.querySelector(".rail-body")?.scrollTop ?? 0;
  const route = getRoute();
  let main;
  if (route.path === "/incidents") main = inboxPage(route);
  else if (route.path.startsWith("/incidents/")) main = incidentDetailPage(route);
  else if (route.path === "/floor") main = floorPage(route);
  else if (route.path.startsWith("/assets")) main = assetPage(route);
  else main = intelligencePage(route);
  const railMode = route.params.get("rail");
  const rail = railMode === "preview" ? objectPreviewRail(route) : railMode === "assist" ? assistRail(route) : railMode === "evidence" ? evidenceRail(route) : "";
  const railIsOpening = Boolean(railMode && !previousRailMode);
  app.innerHTML = shell(main, route, rail);
  if (railIsOpening) app.querySelector("[data-overlay-rail]")?.classList.add("is-entering");
  previousRailMode = railMode;
  const page = app.querySelector(".page");
  if (page) page.scrollTop = savedPageScroll;
  const railBody = app.querySelector(".rail-body");
  if (railBody) railBody.scrollTop = savedRailScroll;
  syncFloor(route);
  syncPart(route);
  document.title = `${activeModule(route.path)[0].toUpperCase()}${activeModule(route.path).slice(1)} · Groundwork`;
  if (restoreTypedField(savedField)) {
    previousPath = route.path;
    focusRestoreId = null;
    return;
  }
  if (route.path !== previousPath) {
    previousPath = route.path;
    requestAnimationFrame(() => document.querySelector("#page-heading")?.focus({ preventScroll: true }));
  } else if (focusRestoreId) {
    const id = focusRestoreId;
    focusRestoreId = null;
    requestAnimationFrame(() => document.querySelector(`[data-focus-id="${id}"]`)?.focus());
  }
}

function openEvidence(type, trigger) {
  lastTrigger = trigger;
  const route = getRoute();
  updateRoute({
    rail: "evidence",
    evidence: type,
    returnRail: route.params.get("rail") || "preview",
    expanded: null,
    evidenceSource: trigger?.dataset.evidenceSource || null,
    evidenceWindow: trigger?.dataset.evidenceWindow || null,
    evidenceIncident: trigger?.dataset.evidenceIncident || null,
  });
}

async function startAssist(question) {
  draftQuestion = question;
  lastAssistError = "";
  assistAbort?.abort();
  const asset = selectedAsset(getRoute());
  const ac = new AbortController();
  assistAbort = ac;
  updateRoute({ rail: "assist", assistState: "running", question });
  try {
    const response = await fetch(`${apiBase()}/api/questions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, asset_id: asset.id }),
      signal: ac.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (ac.signal.aborted) return;
    if (!response.ok) throw new Error(data.error || `assist ${response.status}`);
    lastAssist = { ...data, question: data.question || question, asset_id: data.asset_id || asset.id };
    const current = getRoute();
    if (current.params.get("rail") === "assist" && current.params.get("assistState") === "running") updateRoute({ assistState: "answered" });
  } catch (err) {
    if (err.name === "AbortError") return;
    lastAssistError = err.message || "assist failed";
    const offline = /unavailable|Failed to fetch|timeout|inference|ECONN|offline/i.test(lastAssistError);
    const current = getRoute();
    if (current.params.get("rail") === "assist") updateRoute({ assistState: offline ? "offline" : "failed", question });
  }
}

function onAppClick(event) {
  const info = event.target.closest(".metric-info");
  if (info) {
    event.stopPropagation();
    const key = info.dataset.metricInfo || "";
    openMetricInfo = openMetricInfo === key ? "" : key;
    render();
    return;
  }
  const inField = event.target.closest("#assist-question, [data-assist-form], [data-global-search], textarea, input, select");
  if (openMetricInfo) {
    openMetricInfo = "";
    if (!inField) render();
  }
  if (inField) return;
  const target = event.target.closest("button, [data-select-incident], [data-select-asset], [data-select-run]");
  if (!target || !feed) return;
  if (target.dataset.metric) {
    const route = getRoute();
    updateRoute({ metric: route.params.get("metric") === target.dataset.metric ? null : target.dataset.metric });
    return;
  }
  if (target.dataset.selectIncident) {
    lastTrigger = target;
    updateRoute({ incident: target.dataset.selectIncident, rail: "preview", evidence: null, returnRail: null });
    return;
  }
  if (target.dataset.openAsset) {
    const id = target.dataset.openAsset;
    location.hash = hashFor(`/assets/${id}`, assetRouteParams(id, { render: "3d", rail: "preview" }));
    return;
  }
  if (target.dataset.openIncident) {
    const id = target.dataset.openIncident;
    location.hash = hashFor(`/incidents/${id}`, { rail: "preview", incident: id });
    return;
  }
  if (target.dataset.selectAsset) {
    lastTrigger = target;
    floorFit = false;
    const map = assetsMap();
    updateRoute({ asset: target.dataset.selectAsset, rail: "preview", assistState: null, incident: map[target.dataset.selectAsset]?.incident || null });
    return;
  }
  if (target.dataset.selectRun) { updateRoute({ run: target.dataset.selectRun }); return; }
  if (target.dataset.evidence) { openEvidence(target.dataset.evidence, target); return; }
  if (target.dataset.suggestion) { startAssist(target.dataset.suggestion); return; }
  const action = target.dataset.action;
  if (!action) return;
  if (action === "toggle-scope") updateRoute({ scope: getRoute().params.get("scope") === "site" ? null : "site" });
  if (action === "clear-filters") updateRoute({ metric: null, priority: null, status: null, ai: null, search: null });
  if (action === "resolved-view") updateRoute({ metric: null, priority: null, status: "Resolved", rail: null });
  if (action === "open-assist") {
    lastTrigger = target;
    const asset = selectedAsset(getRoute());
    updateRoute({ rail: "assist", assistState: asset.supported ? "ready" : "unsupported", evidence: null, returnRail: null });
  }
  if (action === "close-rail") {
    focusRestoreId = lastTrigger?.dataset.focusId || "rail-trigger";
    updateRoute({ rail: null, evidence: null, returnRail: null, expanded: null });
  }
  if (action === "return-rail") updateRoute({ rail: getRoute().params.get("returnRail") || "preview", evidence: null, returnRail: null, expanded: null });
  if (action === "expand-evidence") updateRoute({ expanded: getRoute().params.get("expanded") === "1" ? null : "1" });
  if (action === "attempt-exfil") attemptExfil();
  if (action === "toggle-inspection") {
    focusRestoreId = "inspection-toggle";
    updateRoute({ inspection: getRoute().params.get("inspection") === "expanded" ? null : "expanded" });
  }
  if (action === "focus-inspection-target") {
    const req = partRequest(getRoute());
    if (req?.asset && req.component) {
      partIssuesKey = null;
      postPartIssues(req.asset);
      partFrameWindow()?.postMessage({ type: "twin:light", assetId: req.asset, part: req.component }, twinOrigin);
      partSelected = { asset: req.asset, part: req.component };
      partSent = req.component;
    }
  }
  if (action === "view-floor") {
    const asset = selectedAsset(getRoute());
    location.hash = hashFor("/floor", { asset: asset.id, incident: asset.incident || selectedIncident(getRoute())?.id, rail: "preview" });
  }
  if (action === "open-full-run") location.hash = hashFor("/intelligence", { run: `HOP-${hopIndex()}`, incident: selectedIncident(getRoute())?.id });
  if (action === "open-asset") {
    const fromFloor = getRoute().path === "/floor";
    const asset = selectedAsset(getRoute());
    location.hash = hashFor(`/assets/${asset.id}`, assetRouteParams(asset.id, fromFloor ? { render: "3d", rail: "preview" } : { rail: "preview" }));
  }
  if (action === "select-supported") location.hash = hashFor("/floor", { asset: "RPP1", incident: derivedIncident()?.id, rail: "assist", assistState: "ready" });
  if (action === "retry-assist") startAssist(getRoute().params.get("question") || draftQuestion || (isHeroAsset(selectedAsset(getRoute())) ? "What L1 features are on this hop?" : "What L1 tags are on this hop?"));
  if (action === "acknowledge") {
    const id = selectedIncident(getRoute())?.id;
    if (!id) return;
    if (acknowledgedIds.has(id)) acknowledgedIds.delete(id);
    else acknowledgedIds.add(id);
    focusRestoreId = "acknowledge";
    render();
  }
  if (action === "toggle-incidents") {
    const pressed = target.getAttribute("aria-pressed") !== "true";
    target.setAttribute("aria-pressed", String(pressed));
    target.classList.toggle("primary", pressed);
  }
  if (action === "floor-view") {
    focusRestoreId = target.dataset.focusId;
    updateRoute({ view: target.dataset.view === "plan" ? null : target.dataset.view });
  }
  if (action === "toggle-render") {
    focusRestoreId = "render-toggle";
    updateRoute({ render: getRoute().params.get("render") === "3d" ? null : "3d" });
  }
  if (action === "light-part") {
    const asset = selectedAsset(getRoute());
    partSelected = { asset: asset.id, part: target.dataset.part };
    partSent = target.dataset.part;
    partFrameWindow()?.postMessage({ type: "twin:light", assetId: asset.id, part: target.dataset.part }, twinOrigin);
    render();
  }
  if (action === "floor-fit") {
    floorFit = true;
    syncFloor(getRoute());
  }
}

app.addEventListener("click", onAppClick);
app.addEventListener("input", event => {
  if (event.target.id === "assist-question") draftQuestion = event.target.value;
});
app.addEventListener("pointerover", event => {
  const id = event.target.closest("[data-select-asset], [data-open-asset]")?.dataset.selectAsset
    || event.target.closest("[data-open-asset]")?.dataset.openAsset;
  if (id) prefetchTwinAssets(id);
});

app.addEventListener("change", event => {
  const input = event.target.closest("[data-filter-kind]");
  if (!input) return;
  const route = getRoute();
  const kind = input.dataset.filterKind;
  const values = new Set((route.params.get(kind) || "").split(",").filter(Boolean));
  if (input.checked) values.add(input.value); else values.delete(input.value);
  updateRoute({ [kind]: [...values].join(",") || null });
});

app.addEventListener("keydown", event => {
  const row = event.target.closest("[data-select-incident], [data-select-asset], [data-select-run]");
  if (row && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    if (row.dataset.selectIncident && event.key === "Enter") location.hash = hashFor(`/incidents/${row.dataset.selectIncident}`, { incident: row.dataset.selectIncident, rail: "preview" });
    else row.click();
  }
  if (event.key === "Escape" && getRoute().params.get("inspection") === "expanded") {
    event.preventDefault();
    focusRestoreId = "inspection-toggle";
    updateRoute({ inspection: null });
    return;
  }
  if (event.key === "Escape" && getRoute().params.get("rail")) {
    event.preventDefault();
    focusRestoreId = lastTrigger?.dataset.focusId || "rail-trigger";
    updateRoute({ rail: null, evidence: null, returnRail: null });
  }
  if (event.key === "Enter" && event.target.matches("[data-global-search]")) {
    event.preventDefault();
    updateRoute({ search: event.target.value || null }, "/incidents");
  }
  if (event.key === "Enter" && event.target.id === "assist-question" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault();
    event.target.closest("form")?.requestSubmit();
  }
  if (event.key === "Tab" && matchMedia("(max-width: 1280px)").matches) {
    const rail = document.querySelector("[data-overlay-rail]");
    if (!rail) return;
    const focusable = [...rail.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});

app.addEventListener("submit", event => {
  if (!event.target.matches("[data-assist-form]")) return;
  event.preventDefault();
  const text = event.target.querySelector("textarea").value.trim();
  if (!text) return;
  if (/offline/i.test(text)) updateRoute({ assistState: "offline", question: text });
  else if (/fail/i.test(text)) updateRoute({ assistState: "failed", question: text });
  else startAssist(text);
});

function startReplay() {
  clearInterval(replayTimer);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    if (!liveHops?.live) cursor = Math.min(9, feed.hops.length - 1);
    render();
    return;
  }
  replayTimer = setInterval(() => {
    if (liveHops?.live) return;
    const healthyEnd = Math.min(9, feed.hops.length - 1);
    cursor = (cursor + 1) % (healthyEnd + 1);
    if (softLiveTick()) applyLiveTick();
    else render();
  }, 1000);
}

async function loadStations() {
  try {
    const [scene, map] = await Promise.all([
      fetch(`${twinOrigin}/twin/scene.json`, { cache: "no-store" }).then(r => r.ok ? r.json() : null),
      fetch(`${twinOrigin}/twin/asset-map.json`, { cache: "no-store" }).then(r => r.ok ? r.json() : null),
    ]);
    if (!scene || twinStations) return;
    const bound = new Map((map?.assets || []).map(a => [a.asset_id, a]));
    twinStations = {
      cells: scene.cells || [],
      stations: scene.placements.filter(p => p.kind === "station").map(p => ({ asset_id: p.asset_id, model: p.model || p.file.replace(/\.glb$/, ""), file: p.file, cell: p.cell || null, position: p.position, monitored: bound.has(p.asset_id), role: bound.get(p.asset_id)?.role || null, source: bound.get(p.asset_id)?.source || null })),
      license: scene.source, cite: scene.cite,
    };
    render();
  } catch (err) {
    console.warn("station registry unavailable; waiting for twin:stations", err);
  }
}

async function boot() {
  const [response, boardResponse] = await Promise.all([
    fetch("./feed.json"),
    fetchBoard().catch(() => null),
  ]);
  if (!response.ok) throw new Error(`feed.json ${response.status}`);
  feed = await response.json();
  prefetchTwinAssets("RPP1");
  board = boardResponse?.ok ? await boardResponse.json() : null;
  await refreshLive();
  loadStations();
  cursor = liveHops?.latest?.hop ?? 0;
  if (!location.hash) location.replace("#/incidents");
  else render();
  startReplay();
  setInterval(async () => {
    if (attemptState === "running") return;
    const beforeContainment = JSON.stringify(board?.containment);
    const delta = await refreshLive();
    const containmentChanged = JSON.stringify(board?.containment) !== beforeContainment;
    if (delta.incidents || delta.issues || containmentChanged) {
      if (softLiveTick()) applyLiveTick();
      else render();
    } else if (delta.hops) {
      if (softLiveTick()) applyLiveTick();
      else render();
    }
  }, 1000);
}

window.addEventListener("keydown", (event) => {
  if (!(event.altKey && (event.key === "i" || event.key === "I"))) return;
  event.preventDefault();
  injectFault(event.shiftKey ? "clear" : "ir", 30);
});

window.addEventListener("hashchange", render);
window.addEventListener("message", handleTwinMessage);
window.addEventListener("resize", () => { positionFloorLive(); positionPartLive(); });
boot().catch(err => {
  parkPartLive();
  app.innerHTML = `<main class="page"><div class="page-inner compact"><h1>Feed missing</h1><p>${esc(err.message)}</p><p class="section-note">Run scripts/build-prototype-feed.py on spark.</p></div></main>`;
});
