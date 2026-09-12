const app = document.querySelector("#app");
const twinOrigin = `${location.protocol}//${location.hostname}:8765`;
const fetchBoard = () => location.origin === twinOrigin
  ? fetch("/api/board", { cache: "no-store" })
  : fetch(`${twinOrigin}/api/board`, { cache: "no-store" });

let feed = null;
let board = null;
let cursor = 0;
let replayTimer = null;
let lastTrigger = null;
let focusRestoreId = null;
let previousPath = "";
let assistTimer = null;
let draftQuestion = "";
const acknowledgedIds = new Set();
let openMetricInfo = "";

function sendTwinCommand(type, assetId, part) {
  const twinFrame = app.querySelector("[data-twin-frame]");
  if (!twinFrame?.contentWindow || typeof assetId !== "string" || !assetId) return;
  const message = part === undefined ? { type, assetId } : { type, assetId, part };
  twinFrame.contentWindow.postMessage(message, twinOrigin);
}

const __twin = {
  focusAsset(assetId) { sendTwinCommand("twin:focus", assetId); },
  lightPart(assetId, part) { sendTwinCommand("twin:light", assetId, part); },
};

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
  Object.assign(floorLive.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
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
    const state = critical ? "flag" : a.asset_id === "RPP1" ? "ok" : a.asset_id === "T1" ? "process" : "no sensor";
    return `<button type="button" class="${cls}" data-open-asset="${a.asset_id}" data-floor-label="${a.asset_id}" style="${style(a)}" aria-label="Open ${a.asset_id} asset page, ${state}" aria-current="${a.asset_id === selected}">${critical ? `${icon("alert", "sm")}` : ""}<span class="mono">${a.asset_id}</span>${monitored || critical ? `<small>${state}</small>` : ""}</button>`;
  }).join("");
}

// ---------- Asset 360: persistent single-station render (twin ?view=part) ----------
let partLive = null;
let partReady = false;
let partAsset = null;
let partSelected = null;
let partSent = null;
let partObserver = null;

function partFrameWindow() {
  return partLive?.querySelector("[data-part-frame]")?.contentWindow || null;
}

function positionPartLive() {
  if (!partLive) return;
  const mount = app.querySelector("[data-part-mount]");
  if (!mount) { partLive.hidden = true; return; }
  const r = mount.getBoundingClientRect();
  Object.assign(partLive.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  partLive.hidden = false;
}

function syncPart(route) {
  const wanted = route.path.startsWith("/assets/") && route.params.get("render") === "3d" ? selectedAsset(route).id : null;
  if (!wanted) {
    if (partLive) partLive.hidden = true;
    partObserver?.disconnect();
    return;
  }
  if (!partLive) {
    partLive = document.createElement("div");
    partLive.className = "part-live";
    partLive.innerHTML = `<iframe class="floor-frame" title="3D render of the selected station" data-part-frame aria-busy="true"></iframe>`;
    document.body.appendChild(partLive);
  }
  const frame = partLive.querySelector("[data-part-frame]");
  if (partAsset !== wanted) {
    partAsset = wanted;
    partReady = false;
    partSelected = null;
    partSent = null;
    frame.setAttribute("aria-busy", "true");
    frame.src = `${twinOrigin}/twin/?view=part&asset=${encodeURIComponent(wanted)}`;
  }
  positionPartLive();
  partObserver?.disconnect();
  const mount = app.querySelector("[data-part-mount]");
  if (mount && "ResizeObserver" in window) {
    partObserver = new ResizeObserver(positionPartLive);
    partObserver.observe(mount);
  }
  // Pre-light the sensor-bound part when it carries a flag, so the fault is visible on open.
  const fleet = feed.fleet.find(row => row.asset_id === wanted);
  const wantLit = partSelected ? partSelected.part : (fleet && wanted === "RPP1" && flagged() ? fleet.part : null);
  if (partReady && partSent !== wantLit) {
    partSent = wantLit;
    if (wantLit) partFrameWindow()?.postMessage({ type: "twin:light", assetId: wanted, part: wantLit }, twinOrigin);
    else partFrameWindow()?.postMessage({ type: "twin:part:clear" }, twinOrigin);
    if (wantLit && !partSelected) partSelected = { asset: wanted, part: wantLit };
  }
}

function handlePartMessage(event) {
  const type = event.data?.type;
  if (type === "twin:ready") {
    partReady = true;
    partLive?.querySelector("[data-part-frame]")?.setAttribute("aria-busy", "false");
    render();
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
    location.hash = hashFor(`/assets/${event.data.asset_id}`);
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
  const twinFrame = app.querySelector("[data-twin-frame]");
  if (!twinFrame || event.source !== twinFrame.contentWindow) return;
  if (event.data?.type !== "twin:ready") return;
  const twinStatus = app.querySelector("[data-twin-status]");
  if (twinStatus) {
    twinStatus.textContent = "3D inspection ready.";
    twinStatus.dataset.state = "ready";
    twinFrame.setAttribute("aria-busy", "false");
  }
  __twin.focusAsset(twinFrame.dataset.inspectionAsset);
  if (twinFrame.dataset.issueMarker === "true") {
    __twin.lightPart(twinFrame.dataset.inspectionAsset, twinFrame.dataset.inspectionComponent);
  }
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

function hop() {
  return feed.hops[Math.min(cursor, feed.hops.length - 1)];
}

function flagged() {
  return cursor >= feed.manifest.flag_hop;
}

function fleetAsset(id) {
  return feed.fleet.find(item => item.asset_id === id) || feed.fleet[0];
}

function detections() {
  if (!flagged()) return 0;
  return feed.hops.slice(feed.manifest.flag_hop, cursor + 1).filter(item => item.rpp1.fault).length;
}

function derivedIncident() {
  if (!flagged()) return null;
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
    age: `${cursor - feed.manifest.flag_hop}s`,
    ageMin: cursor - feed.manifest.flag_hop,
    detections: detections(),
    signal: now.rpp1.bpfi.detected ? "Elevated" : "Normal",
    fault,
    source: now.rpp1.source,
  };
}

function incidents() {
  const item = derivedIncident();
  return item ? [item] : [];
}

function assetsMap() {
  const now = hop();
  const inc = derivedIncident();
  const out = {};
  for (const row of feed.fleet) {
    const isHero = row.asset_id === "RPP1";
    out[row.asset_id] = {
      id: row.asset_id,
      name: row.name,
      component: row.part,
      location: feed.cell.name,
      condition: isHero && flagged() ? "Needs attention" : "Healthy",
      incident: isHero && inc ? inc.id : null,
      supported: row.supported,
      fault: isHero ? (now.rpp1.fault || (flagged() ? feed.flag.fault : "none")) : "—",
      source: isHero ? now.rpp1.source : now.t1.source,
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
  return { id, name: id, component: "—", location: feed.cell.name, condition: "Unknown", supported: false, fault: "—", source: "—" };
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
  return `<div class="refresh-line"><span class="live-dot"></span>Hop ${cursor + 1}/${feed.hops.length} · ${clock(now.ts)} · ${esc(now.rpp1.source)}</div>`;
}

function shell(main, route, rail) {
  const scope = route.params.get("scope") === "site" ? "Entire site" : feed.cell.name;
  const railMode = route.params.get("rail");
  const open = incidents().length;
  return `
    <div class="app-shell">
      <nav class="left-nav" aria-label="Primary navigation">
        <div class="brand"><div class="brand-mark">FP</div><div class="brand-copy"><strong>Forge Operations</strong><span>${esc(feed.cell.name)}</span></div></div>
        <div class="nav-section-label">Workspace</div>
        <div class="nav-list">
          ${navLink("incidents", "Incidents", "inbox", "/incidents", String(open))}
          ${navLink("floor", "Floor", "floor", "/floor?rail=preview")}
          ${navLink("assets", "Assets", "asset", "/assets/RPP1")}
          ${navLink("intelligence", "Intelligence", "intel", "/intelligence?run=TAPE-20")}
        </div>
        <div class="nav-bottom"><div class="nav-system"><span class="system-dot"></span><strong>Tape replay</strong><small>20 hops · 1 Hz · no egress</small></div></div>
      </nav>
      <section class="workspace">
        <header class="global-header">
          <div class="breadcrumb">${breadcrumb(route)}</div>
          <div class="header-spacer"></div>
          <button class="header-scope" data-action="toggle-scope" type="button" aria-label="Change plant scope">${icon("pin", "sm")}<span>${esc(scope)}</span>${icon("chevron", "sm")}</button>
          <label class="header-search">${icon("search", "sm")}<span class="sr-only">Search incidents and assets</span><input data-global-search value="${esc(route.params.get("search") || "")}" placeholder="Search incidents or assets" autocomplete="off"></label>
          ${containmentBadge()}
          <button class="header-assist" data-action="open-assist" data-focus-id="assist-trigger" aria-pressed="${railMode === "assist"}" type="button">${icon("spark", "sm")}<span>Assist</span></button>
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

function citationButton(type, label, locator) {
  return `<button class="cite-button" data-evidence="${type}" type="button">${icon("file", "sm")}<span>${label}</span><span class="mono">${esc(locator)}</span></button>`;
}

function rmsChart(width, height, label) {
  const values = feed.hops.slice(0, cursor + 1).map(item => item.rpp1.rms).filter(v => v != null);
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
  return `<div class="trend-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}"><path class="chart-grid" d="M0 20H${width}M0 ${Math.round(height / 2)}H${width}M0 ${height - 10}H${width}"/><path class="chart-area" d="${area}"/><path class="chart-line" d="${line}"/><circle class="chart-dot" cx="${last[0]}" cy="${last[1]}" r="4"/></svg><p class="section-note">${values.length} hops · ${dash(now.rpp1.source)} · RMS ${dash(now.rpp1.rms)} g</p></div>`;
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
    </tr>`).join("")}</tbody></table>` : `<div class="empty-state">${icon("filter", "lg")}<div><h2>${list.length ? "No matching incidents" : "No open incident"}</h2><p>${list.length ? "Current filters exclude all active cases." : "Healthy hops until flag_at. Replay continues at 1 Hz."}</p>${list.length ? `<button class="btn" data-action="clear-filters">Clear filters</button>` : ""}</div></div>`;
  return `<main class="page"><div class="page-inner compact">
    ${moduleHeader("Incidents", "Derived from the 20-hop CWRU slice. Empty until the 97→105 flip.", `${tapeStamp()}<button class="btn sm" data-action="toggle-scope">${icon("pin", "sm")} ${route.params.get("scope") === "site" ? "Entire site" : "Cell"}</button>`)}
    <div class="tabs" role="tablist" aria-label="Incident registry view"><button class="tab active" role="tab" aria-selected="true">Active <span class="badge">${list.length}</span></button><button class="tab" role="tab" aria-selected="false" data-action="resolved-view">Resolved <span class="badge">0</span></button></div>
    <div style="height:12px"></div>
    <section class="metric-grid" aria-label="Incident metrics">
      ${metricCard("critical", "Critical", String(critical), flagged() ? "BPFI flag" : "Waiting on flag_at", critical ? "critical" : "", metric === "critical")}
      ${metricCard("unacknowledged", "Unacknowledged", String(unack), unack ? "Needs owner" : "None", unack ? "warning" : "", metric === "unacknowledged")}
      ${metricCard("progress", "In progress", String(progress), "Work underway", progress ? "info" : "", metric === "progress")}
      ${metricCard("aging", "Aging beyond target", String(aging), "Over 2 hours", aging ? "warning" : "", metric === "aging")}
    </section>
    <section class="inbox-layout">
      <aside class="panel filter-panel" aria-label="Incident filters">
        <div class="panel-header"><div class="filter-title">${icon("filter", "sm")}<strong>Filters</strong></div>${clearVisible ? `<button class="filter-clear" data-action="clear-filters">Clear all</button>` : ""}</div>
        <fieldset class="filter-group"><legend>Priority</legend>${filterOption("priority", "Critical", "Critical", critical, priorities.has("Critical"))}</fieldset>
        <fieldset class="filter-group"><legend>Case status</legend>${filterOption("status", "New", "New", unack, statuses.has("New"))}</fieldset>
        <fieldset class="filter-group"><legend>AI run state</legend>${filterOption("ai", "L1", "L1", list.length, ai.has("L1"))}</fieldset>
        <div class="filter-group"><span class="filter-group-title">Area / line</span><label class="filter-option"><input type="checkbox" checked disabled><span>${esc(feed.cell.name)}</span><span class="count">${list.length}</span></label></div>
      </aside>
      <div class="panel table-panel"><div class="table-toolbar"><span class="table-count">${rows.length} active incidents</span><span class="section-note">Select a row for preview</span><span class="table-sort">Tape hop ${cursor + 1}</span></div>${table}</div>
    </section>
  </div></main>`;
}

function incidentDetailPage(route) {
  const item = selectedIncident(route);
  const now = hop();
  if (!item) {
    return `<main class="page incident-detail-page"><div class="page-inner compact">${moduleHeader("No incident", "Flag has not fired on this hop.", tapeStamp())}<div class="empty-state">${icon("clock", "lg")}<div><h2>Waiting on flag_at</h2><p class="mono">${esc(feed.manifest.flag_at)}</p></div></div></div></main>`;
  }
  const cmms = feed.cmms.filter(row => row.fault === item.fault);
  const inspectionAsset = board?.selection?.asset_id;
  const inspectionComponent = board?.work_order?.evidence?.part;
  const mappedGeometry = Boolean(
    inspectionAsset === item.asset &&
    inspectionComponent === item.component &&
    board?.fleet?.some(row => row.asset_id === inspectionAsset && row.part === inspectionComponent),
  );
  const inspectionExpanded = route.params.get("inspection") === "expanded";
  const inspectionNotice = mappedGeometry ? `<button class="btn sm issue-marker" data-action="focus-inspection-target">Issue target: ${esc(inspectionComponent)}</button>` : `<span class="section-note">Location unavailable — no mapped geometry.</span>`;
  return `<main class="page incident-detail-page"><div class="page-inner compact">
    ${moduleHeader(`${item.id} · ${esc(item.title)}`, `${item.asset} / ${item.component} · ${esc(item.area)}`, `<button class="btn" data-action="view-floor">${icon("floor", "sm")}View on floor</button><button class="btn ${item.status === "Acknowledged" ? "" : "primary"}" data-action="acknowledge" data-focus-id="acknowledge" aria-pressed="${item.status === "Acknowledged"}">${icon("check", "sm")}${item.status === "Acknowledged" ? "Acknowledged" : "Acknowledge incident"}</button>`)}
    <div class="detail-meta"><span class="badge critical">Critical priority</span><span class="badge ${item.status === "Acknowledged" ? "" : "info"}">${item.status === "Acknowledged" ? "Acknowledged" : "New case"}</span><span>${icon("clock", "sm")}Flag ${clock(feed.flag.ts)} · last ${item.last} · ${item.detections} flagged hops</span><span>Signal: <strong class="${item.signal === "Elevated" ? "text-warning" : ""}">${item.signal}</strong></span><span>L1: <strong class="text-success">${esc(now.rpp1.engine)}</strong></span></div>
    <div style="height:10px"></div>
    <section class="question-grid" aria-label="Incident overview">
      <article class="question-card"><span class="question-number">01</span><h2>What happened?</h2><p>${esc(now.rpp1.engine)} on ${esc(now.rpp1.source)} window ${esc(now.rpp1.window)}. Fault ${esc(dash(now.rpp1.fault))}. BPFI ${now.rpp1.bpfi.detected ? `${now.rpp1.bpfi.hz} Hz` : "not detected"}.</p><div class="inline-citations">${citationButton("signal", "Signal", `${now.rpp1.file} · ${now.rpp1.window}`)}</div></article>
      <article class="question-card action"><span class="question-number">02</span><h2>Work order</h2><p>Tape <span class="mono">wo: ${esc(feed.flag.wo)}</span>. ${feed.flag.wo === "none" ? "Source-gap — no L2 draft on this slice." : ""}</p><div class="inline-citations">${cmms.map(row => citationButton("history", "CMMS", row.wo_id)).join("") || `<span class="section-note">No matching CMMS row</span>`}</div></article>
      <article class="question-card trust"><span class="question-number">03</span><h2>Why trust it?</h2><p>L0 pointer + L1 scalars. No 12 kHz on the board. ISO 15 kW floor — context only.</p><div class="inline-citations"><span class="badge ${now.rpp1.rms == null ? "warning" : "success"}">${now.rpp1.rms == null ? "RMS source-gap" : "RMS from window"}</span></div></article>
    </section>
    <section class="panel twin-panel${inspectionExpanded ? " inspection-expanded" : ""}" aria-labelledby="twin-inspection-heading">
      <div class="panel-header"><h2 id="twin-inspection-heading">3D inspection</h2>${inspectionNotice}<button class="btn sm" data-action="toggle-inspection" data-focus-id="inspection-toggle" aria-expanded="${inspectionExpanded}" aria-controls="twin-inspection-frame">${inspectionExpanded ? "Collapse 3D inspection" : "Expand 3D inspection"}</button><p class="twin-status" role="status" aria-live="polite" data-twin-status data-state="loading">Loading 3D inspection…</p></div>
      <iframe id="twin-inspection-frame" class="twin-frame" src="${twinOrigin}/twin/index.html?asset=${encodeURIComponent(mappedGeometry ? inspectionAsset : item.asset)}&component=${encodeURIComponent(mappedGeometry ? inspectionComponent : item.component)}" title="3D inspection of ${esc(item.asset)} ${esc(item.component)}" data-twin-frame data-inspection-asset="${esc(mappedGeometry ? inspectionAsset : item.asset)}" data-inspection-component="${esc(mappedGeometry ? inspectionComponent : "")}" data-issue-marker="${mappedGeometry}"></iframe>
    </section>
    <section class="detail-grid">
      <article class="panel"><div class="panel-header"><h2>L1 hops</h2><span class="badge info" style="margin-left:auto">${cursor + 1} / ${feed.hops.length}</span></div><div class="panel-body"><div class="timeline">
        ${feed.hops.slice(0, cursor + 1).slice(-6).map(item => `<div class="timeline-row"><span class="timeline-icon">${icon("check", "sm")}</span><div class="timeline-copy"><strong class="mono">${item.rpp1.file}</strong><span>${esc(item.rpp1.source)} · ${esc(item.rpp1.window)} · RMS ${dash(item.rpp1.rms)} g${item.rpp1.fault ? ` · ${item.rpp1.fault}` : ""}</span></div><time>${clock(item.ts)}</time></div>`).join("")}
      </div></div></article>
      <article class="panel"><div class="panel-header"><h2>Condition</h2><button class="btn sm" data-evidence="signal">Open exact signal</button></div><div class="condition-numbers"><div class="condition-number"><span>RMS</span><strong class="num">${dash(now.rpp1.rms)}<small>g</small></strong></div><div class="condition-number"><span>Speed</span><strong class="num">${dash(now.rpp1.rpm)}<small>rpm</small></strong></div><div class="condition-number"><span>BPFI</span><strong class="num">${dash(now.rpp1.bpfi.hz)}<small>Hz</small></strong></div></div>${rmsChart(320, 80, "RPP1 RMS hops")}<div class="limit-note">${icon("alert", "sm")}ISO 20816 shown as context only; this 2 hp dataset asset is below the 15 kW applicability floor.</div></article>
    </section>
    <section class="detail-grid">
      <article class="panel"><div class="panel-header"><h2>Current work order</h2><span class="badge" style="margin-left:auto">wo: ${esc(feed.flag.wo)}</span></div><div class="work-order"><div class="work-order-callout">${icon("wrench")}<div><strong>Source-gap</strong><p>No L2 work order on this tape. CMMS rows below are history cites, not a new draft.</p></div></div><dl class="key-grid"><dt>Flag</dt><dd class="mono">${esc(feed.flag.flag)}</dd><dt>Part</dt><dd class="mono">${esc(feed.flag.part)}</dd><dt>Evidence</dt><dd>${citationButton("signal", "Signal", now.rpp1.window)} ${cmms.map(row => citationButton("history", "History", row.wo_id)).join(" ")}</dd></dl></div></article>
      <article class="panel"><div class="panel-header"><h2>Case activity</h2><span class="section-note" style="margin-left:auto">Tape clock</span></div><div class="panel-body activity-list">${flagged() ? `<div class="activity-item"><time>${clock(feed.flag.ts)}</time><span class="event-mark"></span><div><strong>Flag</strong><p class="mono">${esc(feed.flag.source)} · ${esc(feed.flag.window)}</p></div></div>` : ""}<div class="activity-item"><time>${clock(now.ts)}</time><span class="event-mark"></span><div><strong>Current hop</strong><p>RMS ${dash(now.rpp1.rms)} g · ${esc(now.rpp1.file)}</p></div></div></div></article>
    </section>
  </div></main>`;
}

function stationState(id) {
  if (id === "RPP1") return flagged() ? { text: "flag", cls: "text-critical" } : { text: "ok", cls: "" };
  if (id === "T1") return { text: "process", cls: "" };
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
    <div class="floor-header"><div class="title-block"><h1 id="page-heading" tabindex="-1">Floor</h1><p class="subtitle">${esc(feed.cell.name)} · ${stations.length ? `${stations.length} stations · ${monitored} monitored` : "RPP1 + T1 monitored"}</p></div><div class="header-actions">${tapeStamp()}${flagged() ? `<span class="badge critical">1 flag</span>` : `<span class="badge">0 flags</span>`}<div class="segmented" role="group" aria-label="Floor view">${viewButton("plan", "Isometric")}${viewButton("top", "Top-down")}</div><button type="button" class="btn sm" data-action="floor-fit" data-focus-id="floor-fit">Fit line</button></div></div>
    <section class="floor-stage" aria-label="Factory floor overview">
      <div class="floor-mount" data-floor-mount aria-hidden="true"></div>
      <aside class="floor-overlay"><div class="floor-overlay-header">${icon("floor", "sm")}Line</div><div class="tree">${floorTree(route)}</div></aside>
      <div class="floor-legend"><span><i class="critical"></i>Flag</span><span><i></i>Monitored</span><span><i class="unmonitored"></i>No sensor</span><span class="floor-license">VLFT · CC BY-NC 4.0</span></div>
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
    return { part, bound: true, source: now.rpp1.source, window: now.rpp1.window, rms: now.rpp1.rms, rpm: now.rpp1.rpm, bpfi: now.rpp1.bpfi?.hz, fault: flagged() ? (now.rpp1.fault || feed.flag.fault) : null, incident, tone: flagged() ? "critical" : "success", state: flagged() ? "Fault flagged" : "No fault on this hop" };
  }
  if (asset.id === "T1" && bound) return { part, bound: true, source: now.t1.source, cycle_s: now.t1.cycle_s, busy: now.t1.busy, fault: null, incident: null, tone: "neutral", state: "Process tag only · never diagnosed" };
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
    body = `<dl class="key-grid"><dt>Source</dt><dd class="mono">${esc(facts.source)}</dd><dt>Window</dt><dd class="mono">${esc(facts.window)}</dd><dt>RMS</dt><dd>${dash(facts.rms)} g</dd><dt>Speed</dt><dd>${dash(facts.rpm)} rpm</dd><dt>BPFI</dt><dd>${dash(facts.bpfi)} Hz</dd>${facts.fault ? `<dt>Fault</dt><dd class="text-critical">${esc(facts.fault)}</dd>` : ""}</dl>${facts.incident ? `<div class="rail-actions"><button class="btn primary sm" data-open-incident="${facts.incident.id}">Open ${facts.incident.id} ${icon("arrow", "sm")}</button><button class="btn sm" data-evidence="signal">Open exact signal</button></div>` : `<div class="rail-actions"><button class="btn sm" data-evidence="signal">Open exact signal</button></div>`}`;
  } else if (facts.bound) {
    body = `<dl class="key-grid"><dt>Source</dt><dd class="mono">${esc(facts.source)}</dd><dt>cycle_s</dt><dd>${dash(facts.cycle_s)}</dd><dt>busy</dt><dd>${dash(facts.busy)}</dd></dl>`;
  } else {
    body = `<p class="section-note">Geometry only. No vibration channel, no faults recorded, nothing to diagnose.</p>`;
  }
  return `<div class="part-detail-body"><div class="rail-kicker">Part</div><div class="rail-heading mono">${esc(facts.part)}</div>${badge}${body}${boundLine}</div>`;
}

function renderPanel(route, asset) {
  const open = route.params.get("render") === "3d";
  if (!open) return "";
  return `<section class="panel render-panel" aria-labelledby="render-heading"><div class="panel-header"><h2 id="render-heading">3D render · ${asset.id}</h2><span class="section-note">Grayscale · this station only · click a part</span><p class="twin-status" role="status" aria-live="polite" data-part-status data-state="${partReady && partAsset === asset.id ? "ready" : "loading"}">${partReady && partAsset === asset.id ? "Render ready." : "Loading render…"}</p><button class="btn sm" data-action="toggle-render" data-focus-id="render-toggle" aria-expanded="true">Close 3D render</button></div><div class="render-body"><div class="render-mount" data-part-mount aria-hidden="true"></div><aside class="part-detail" aria-label="Selected part">${partPanel(asset)}</aside></div></section>`;
}

function assetPage(route) {
  const asset = selectedAsset(route);
  const now = hop();
  const activeTab = route.params.get("tab") || "overview";
  const keep = { tab: activeTab === "overview" ? null : activeTab, render: route.params.get("render") };
  const assetTab = (key, label) => `<a class="tab ${activeTab === key ? "active" : ""}" role="tab" aria-selected="${activeTab === key}" href="${hashFor(`/assets/${asset.id}`, { ...keep, tab: key })}">${label}</a>`;
  const isHero = asset.id === "RPP1";
  const unmon = Boolean(asset.unmonitored);
  const history = isHero ? feed.cmms : [];
  const renderOpen = route.params.get("render") === "3d";
  const actions = `<button class="btn" data-action="toggle-render" data-focus-id="render-toggle" aria-expanded="${renderOpen}">${icon("asset", "sm")}${renderOpen ? "Close 3D render" : "Open 3D render"}</button><button class="btn" data-action="view-floor">${icon("floor", "sm")}View on floor</button><button class="btn primary" data-action="open-assist">${icon("spark", "sm")}Ask Maintenance Assist</button>`;
  const ring = isHero ? dash(now.rpp1.rms) : unmon ? "—" : dash(now.t1.busy);
  const ringNote = isHero ? "RMS g · current hop" : unmon ? "no sensor bound" : "busy · process tag";
  const fact2 = isHero ? ["Current RMS", `${dash(now.rpp1.rms)} g`] : unmon ? ["VLFT model", esc(asset.model)] : ["cycle_s", dash(now.t1.cycle_s)];
  const condition = isHero
    ? `${flagged() ? `<div class="work-order-callout">${icon("alert")}<div><strong>${esc(asset.fault)} · ${esc(asset.component)}</strong><p class="mono">${esc(now.rpp1.source)} · ${esc(now.rpp1.window)}</p></div></div>` : `<p class="section-note">No flag on this hop.</p>`}${rmsChart(520, 80, "RPP1 RMS")}`
    : unmon
      ? `<dl class="key-grid"><dt>VLFT model</dt><dd class="mono">${esc(asset.model)}</dd><dt>Cell</dt><dd>${esc(cellName(asset.cell))}</dd><dt>Signal source</dt><dd class="mono">none</dd></dl><p class="section-note">Unmonitored station. Geometry only; never diagnosed.</p>`
      : `<dl class="key-grid"><dt>cycle_s</dt><dd>${dash(now.t1.cycle_s)}</dd><dt>busy</dt><dd>${dash(now.t1.busy)}</dd><dt>job_id</dt><dd>${dash(now.t1.job_id)}</dd><dt>source</dt><dd class="mono">${esc(now.t1.source)}</dd></dl><p class="section-note">T1 is process-only. Never diagnosed.</p>`;
  return `<main class="page"><div class="page-inner compact">
    ${moduleHeader(`${asset.id} · ${esc(asset.name)}`, `${esc(asset.location)} · ${esc(asset.component)} · ${esc(asset.source)}`, actions)}
    <div class="tabs" role="tablist">${assetTab("overview", "Overview")}${assetTab("maintenance", "Maintenance")}${assetTab("evidence", "Evidence")}${assetTab("activity", "Activity")}</div><div style="height:10px"></div>
    ${renderPanel(route, asset)}
    <section class="asset-summary"><article class="panel asset-score"><div><div class="asset-score-ring" aria-label="${esc(asset.condition)}">${ring}</div><strong>${esc(asset.condition)}</strong><span>${ringNote}</span></div></article><article class="panel asset-facts"><div class="asset-fact"><span>Open incidents</span><strong class="${asset.incident ? "text-critical" : ""}">${asset.incident || "None"}</strong></div><div class="asset-fact"><span>${fact2[0]}</span><strong class="${unmon ? "mono" : "num"}">${fact2[1]}</strong></div><div class="asset-fact"><span>Last hop</span><strong>${clock(now.ts)}</strong></div><div class="asset-fact"><span>Source</span><strong class="mono">${esc(asset.source)}</strong></div></article></section>
    <section class="asset-columns">
      <div>
        <article class="panel" style="margin-bottom:8px"><div class="panel-header"><h2>Condition</h2>${asset.incident ? `<button class="btn sm primary" data-open-incident="${asset.incident}" style="margin-left:auto">Open incident ${icon("arrow", "sm")}</button>` : ""}</div><div class="panel-body">${condition}</div></article>
        <article class="panel"><div class="panel-header"><h2>Maintenance history</h2><span class="section-note" style="margin-left:auto">${isHero ? "Alias MTR-07" : "No CMMS rows"}</span></div>${history.length ? `<table class="simple-table"><thead><tr><th>Work order</th><th>Date</th><th>Fault</th><th>Action / part</th></tr></thead><tbody>${history.map(row => `<tr><td><button class="cite-button mono" data-evidence="history">${esc(row.wo_id)}</button></td><td>${esc(row.opened)}</td><td>${esc(row.fault)}</td><td>${esc(row.action)} · ${esc(row.parts)}</td></tr>`).join("")}</tbody></table>` : `<div class="panel-body"><p class="section-note">—</p></div>`}</article>
      </div>
      <div>
        <article class="panel" style="margin-bottom:8px"><div class="panel-header"><h2>Evidence library</h2></div><div class="panel-body evidence-list">${isHero ? `<div class="evidence-row">${icon("intel")}<div><strong>CWRU window</strong><span class="mono">${esc(now.rpp1.source)}:${esc(now.rpp1.window)}</span></div><button data-evidence="signal">Open</button></div><div class="evidence-row">${icon("clock")}<div><strong>CMMS history</strong><span>${history.length} rows · alias MTR-07</span></div><button data-evidence="history">Open</button></div>` : unmon ? `<p class="section-note">No sensor, no manual, no CMMS rows on this feed.</p>` : `<p class="section-note">Process tags only. No vibration cite.</p>`}<div class="evidence-row">${icon("file")}<div><strong>Manual</strong><span>Source-gap — no packed page on this feed</span></div></div></div></article>
        <article class="panel"><div class="panel-header"><h2>Recent activity</h2></div><div class="panel-body activity-list"><div class="activity-item"><time>${clock(now.ts)}</time><span class="event-mark"></span><div><strong>Hop ${cursor + 1}</strong><p>${isHero ? `RMS ${dash(now.rpp1.rms)} g` : unmon ? "no sensor · geometry only" : `busy ${dash(now.t1.busy)}`}</p></div></div>${flagged() && isHero ? `<div class="activity-item"><time>${clock(feed.flag.ts)}</time><span class="event-mark"></span><div><strong>Flag</strong><p>${esc(feed.flag.flag)} · ${esc(feed.flag.fault)}</p></div></div>` : ""}</div></article>
      </div>
    </section>
  </div></main>`;
}

function intelligencePage(route) {
  const run = route.params.get("run") || "TAPE-20";
  const now = hop();
  const flaggedHops = feed.hops.filter(item => item.i <= cursor && item.rpp1.fault).length;
  return `<main class="page intelligence-page"><div class="page-inner compact">
    ${moduleHeader("Intelligence", "L1 hops from the 20 s slice. No seeded runs.", `${tapeStamp()}<button class="btn" data-evidence="containment">${icon("shield", "sm")}Inspect containment</button>`)}
    <section class="metric-grid" aria-label="Tape metrics">${metricStat("Hop", `${cursor + 1}/${feed.hops.length}`, clock(now.ts), "info", "Replay index on the 20-hop CWRU slice. 1 Hz, local tape only — no cloud fetch.")}${metricStat("Flagged hops", String(flaggedHops), flagged() ? feed.flag.fault : "before flag_at", flaggedHops ? "critical" : "", "Count of hops after flag_at where L1 wrote a fault. Healthy 97.mat until hop 10; then 105.mat inner_race.")}${metricStat("RMS", dash(now.rpp1.rms), "g · current", "", "Window RMS from PMMCP on this hop. ISO 20816 zones do not apply — this asset is below the 15 kW floor.")}${metricStat("BPFI", dash(now.rpp1.bpfi.hz), now.rpp1.bpfi.detected ? "detected" : "not detected", "", `Ball-pass inner-race frequency from the L1 envelope writer (${now.rpp1.engine}). Detected only after the 97→105 flip.`)}</section>
    <section class="system-strip" aria-label="System health"><div class="system-cell"><span>Tape</span><strong><i class="live-dot"></i>${esc(feed.manifest.t0)} · ${feed.manifest.duration_s}s</strong></div><div class="system-cell"><span>L1</span><strong class="text-success">${icon("check", "sm")}${esc(now.rpp1.engine)}</strong></div><div class="system-cell"><span>T1</span><strong>vlft:process · not diagnosed</strong></div><div class="system-cell"><span>Containment</span>${containmentCell()}</div></section>
    <section class="intel-layout">
      <article class="panel"><div class="panel-header"><h2>Hop inbox</h2><span class="section-note" style="margin-left:auto">${cursor + 1} seen</span></div><div class="run-list">${feed.hops.slice(0, cursor + 1).map(item => `<div class="run-row ${`HOP-${item.i}` === run || (run === "TAPE-20" && item.i === cursor) ? "selected" : ""}" data-select-run="HOP-${item.i}" tabindex="0"><div class="run-main"><strong class="mono">HOP-${item.i}</strong><span>${clock(item.ts)} · ${item.rpp1.file}</span><br><span>RMS ${dash(item.rpp1.rms)} g · ${item.rpp1.fault || "healthy"}</span></div><div class="run-side"><span class="status ${statusClass(item.rpp1.fault ? "critical" : "healthy")}">${item.rpp1.fault || "ok"}</span><time>${esc(item.rpp1.window)}</time></div></div>`).join("")}</div></article>
      <article class="panel"><div class="trace-header"><div class="trace-title"><h2>Current hop</h2><span class="badge ${flagged() ? "critical" : "success"}">${flagged() ? "Flagged" : "Healthy"}</span></div><div class="trace-meta"><span class="mono">TAPE-20</span><span>RPP1 / URjoint1</span><span>${clock(now.ts)}</span><span>${esc(now.rpp1.engine)}</span></div></div><div class="trace-stages">
        <details class="trace-stage" open><summary class="trace-summary"><span class="timeline-icon">${icon("check", "sm")}</span><span class="trace-stage-label">L0</span><strong>DAQ drop</strong><time>${clock(now.ts)}</time></summary><div class="trace-body"><dl><dt>Source</dt><dd class="mono">${esc(now.rpp1.source)}</dd><dt>Window</dt><dd class="mono">${esc(now.rpp1.window)}</dd><dt>fs</dt><dd class="num">${now.rpp1.fs_hz} Hz</dd></dl><div class="inline-citations">${citationButton("signal", "Signal", now.rpp1.window)}</div></div></details>
        <details class="trace-stage" open><summary class="trace-summary"><span class="timeline-icon">${icon("check", "sm")}</span><span class="trace-stage-label">L1</span><strong>Condition features</strong></summary><div class="trace-body"><dl><dt>RMS</dt><dd>${dash(now.rpp1.rms)} g</dd><dt>BPFI</dt><dd>${now.rpp1.bpfi.detected ? `${now.rpp1.bpfi.hz} Hz` : "not detected"}</dd><dt>Fault</dt><dd>${dash(now.rpp1.fault)}</dd></dl></div></details>
        <details class="trace-stage" open><summary class="trace-summary"><span class="timeline-icon">${icon("check", "sm")}</span><span class="trace-stage-label">T1</span><strong>Process tags</strong></summary><div class="trace-body"><dl><dt>cycle_s</dt><dd>${dash(now.t1.cycle_s)}</dd><dt>busy</dt><dd>${dash(now.t1.busy)}</dd><dt>job_id</dt><dd>${dash(now.t1.job_id)}</dd><dt>source</dt><dd class="mono">${esc(now.t1.source)}</dd></dl></div></details>
      </div></article>
    </section>
  </div></main>`;
}

function objectPreviewRail(route) {
  const incident = selectedIncident(route);
  const asset = selectedAsset(route);
  const now = hop();
  const hasIncident = Boolean(incident) && incident.asset === asset.id;
  if (!hasIncident && asset.unmonitored) {
    return `<aside class="utility-rail" aria-label="Object Preview" data-overlay-rail><div class="rail-header">${icon("eye")}<div class="rail-title"><strong>Object Preview</strong><span>${asset.id} · Station</span></div><div class="rail-header-actions"><button class="btn icon-only sm" data-action="close-rail" aria-label="Close object preview">${icon("close")}</button></div></div><div class="rail-body">
    <section class="rail-section"><div class="rail-kicker">Unmonitored station</div><div class="rail-heading">${asset.id} · ${esc(asset.name)}</div><span class="badge">No sensor bound</span><dl class="key-grid"><dt>VLFT model</dt><dd class="mono">${esc(asset.model)}</dd><dt>Cell</dt><dd>${esc(cellName(asset.cell))}</dd><dt>Signal source</dt><dd class="mono">none</dd><dt>Active case</dt><dd>None</dd></dl><p class="section-note">Geometry only. No vibration channel on this feed; never diagnosed.</p></section>
    <div class="rail-actions"><button class="btn" data-action="open-assist">${icon("spark", "sm")}Ask Maintenance Assist</button></div>
  </div></aside>`;
  }
  return `<aside class="utility-rail" aria-label="Object Preview" data-overlay-rail><div class="rail-header">${icon("eye")}<div class="rail-title"><strong>Object Preview</strong><span>${hasIncident ? `${incident.id} · Incident` : `${asset.id} · Asset`}</span></div><div class="rail-header-actions"><button class="btn icon-only sm" data-action="close-rail" aria-label="Close object preview">${icon("close")}</button></div></div><div class="rail-body">
    ${hasIncident ? `<section class="rail-section"><div class="rail-kicker">${incident.id}</div><div class="rail-heading">${esc(incident.title)}</div><div style="display:flex;gap:6px"><span class="badge critical">${incident.priority} priority</span><span class="badge info">${incident.status}</span></div><dl class="key-grid"><dt>Asset</dt><dd class="mono">${incident.asset} / ${incident.component}</dd><dt>Source</dt><dd class="mono">${esc(now.rpp1.source)}</dd><dt>Window</dt><dd class="mono">${esc(now.rpp1.window)}</dd><dt>RMS</dt><dd>${dash(now.rpp1.rms)} g</dd><dt>BPFI</dt><dd>${dash(now.rpp1.bpfi.hz)} Hz</dd></dl></section><section class="rail-section"><div class="rail-kicker">L1</div><p>${esc(now.rpp1.engine)} · fault ${esc(dash(now.rpp1.fault))}. WO ${esc(feed.flag.wo)}.</p><div class="inline-citations">${citationButton("signal", "Signal", now.rpp1.window)}</div></section><div class="rail-actions"><button class="btn primary" data-open-incident="${incident.id}">Open incident ${icon("arrow", "sm")}</button><div class="rail-actions inline"><button class="btn" data-action="view-floor">${icon("floor", "sm")}View on floor</button><button class="btn" data-action="open-assist">${icon("spark", "sm")}Ask Assist</button></div></div>` : `<section class="rail-section"><div class="rail-kicker">Selected asset</div><div class="rail-heading">${asset.id} · ${esc(asset.name)}</div><span class="badge ${statusClass(asset.condition)}">${esc(asset.condition)}</span><dl class="key-grid"><dt>Component</dt><dd>${esc(asset.component)}</dd><dt>Source</dt><dd class="mono">${esc(asset.source)}</dd><dt>Active case</dt><dd>${asset.incident || "None"}</dd></dl></section><div class="rail-actions"><button class="btn primary" data-action="open-asset">Open Asset 360</button>${asset.incident ? `<button class="btn" data-open-incident="${asset.incident}">Open incident</button>` : ""}<button class="btn" data-action="open-assist">${icon("spark", "sm")}Ask Maintenance Assist</button></div>`}
  </div></aside>`;
}

function assistContext(asset, incident) {
  const now = hop();
  const flags = `<div class="evidence-flags"><span class="badge ${now.rpp1.rms != null ? "success" : "warning"}">Signal ${now.rpp1.rms != null ? "ready" : "gap"}</span><span class="badge">Manual gap</span><span class="badge ${feed.cmms.length ? "success" : ""}">History ${feed.cmms.length ? "ready" : "gap"}</span></div>`;
  return `<details class="context-capsule"><summary aria-label="Selected machinery context">${icon("asset", "sm")}<span class="context-summary"><strong class="mono">${asset.id} / ${esc(asset.component)}</strong><span class="context-fault">${esc(dash(asset.fault))}${incident ? ` · ${incident.id}` : ""}</span></span>${icon("chevron", "sm")}</summary><div class="context-detail"><div class="context-grid"><span>Incident</span><strong class="mono">${incident?.id || "None"}</strong><span>Asset</span><strong class="mono">${asset.id}</strong><span>Component</span><strong>${esc(asset.component)}</strong><span>Fault</span><strong>${esc(dash(asset.fault))}</strong><span>RMS</span><strong>${asset.id === "RPP1" ? `${dash(now.rpp1.rms)} g` : "—"}</strong><span>Source</span><strong class="mono">${esc(asset.source)}</strong></div><button class="context-change" data-action="view-floor" type="button">Change context</button></div></details>${flags}`;
}

function answerContent(question) {
  const now = hop();
  const inc = derivedIncident();
  return `<div class="assist-message user"><div class="sender">You</div><p>${esc(question)}</p></div><div class="assist-message"><div class="sender">Maintenance Assist · L1 only</div><p>No L2 draft on this tape (<span class="mono">wo: ${esc(feed.flag.wo)}</span>). Numbers below are the current hop.</p><dl class="key-grid"><dt>Fault</dt><dd>${esc(dash(now.rpp1.fault))}</dd><dt>RMS</dt><dd>${dash(now.rpp1.rms)} g</dd><dt>BPFI</dt><dd>${now.rpp1.bpfi.detected ? `${now.rpp1.bpfi.hz} Hz` : "not detected"}</dd><dt>Window</dt><dd class="mono">${esc(now.rpp1.source)}:${esc(now.rpp1.window)}</dd><dt>Incident</dt><dd class="mono">${inc?.id || "—"}</dd></dl><div class="citation-list"><button class="citation-link" data-evidence="signal">${icon("intel")}<span>${esc(now.rpp1.source)} · ${esc(now.rpp1.window)}</span>${icon("external", "sm")}</button>${feed.cmms.map(row => `<button class="citation-link" data-evidence="history">${icon("clock")}<span>CMMS · ${esc(row.wo_id)}</span>${icon("external", "sm")}</button>`).join("")}</div></div>`;
}

function assistRail(route) {
  const incident = selectedIncident(route);
  const asset = selectedAsset(route);
  let state = route.params.get("assistState") || (asset.supported ? "ready" : "unsupported");
  if (!asset.supported) state = "unsupported";
  const question = route.params.get("question") || draftQuestion || "What L1 features are on this hop?";
  let body = assistContext(asset, incident);
  let footer = "";
  if (state === "ready") {
    body += `<div class="assist-empty">${icon("spark")}<p>Ask about this hop. Answers bind to L1 scalars on <span class="mono">${esc(asset.source)}</span>; no L2 draft is invented.</p></div>`;
    footer += `<div class="suggestions" aria-label="Suggested bounded questions"><button class="suggestion" data-suggestion="What L1 features are on this hop?">What L1 features are on this hop?</button><button class="suggestion" data-suggestion="Has the flag fired?">Has the flag fired?</button><button class="suggestion" data-suggestion="Show the exact evidence window.">Show the exact evidence window</button></div>`;
  }
  if (state === "running") body += `<div class="assist-message user"><div class="sender">You</div><p>${esc(question)}</p></div><div class="assist-state" aria-busy="true"><strong>${icon("spark")}Reading feed hop</strong><p>No model call. Binding L1 scalars.</p><div class="progress-track"><span></span></div></div>`;
  if (state === "answered") body += answerContent(question);
  if (state === "unsupported") body += `<div class="assist-state warning"><strong>${icon("alert")}Assistant unavailable for ${asset.id}</strong><p>Grounded assistance is configured only for RPP1 / URjoint1. T1 is process-only.</p><div class="rail-actions"><button class="btn" data-action="select-supported">Select supported RPP1 context</button></div></div>`;
  if (state === "failed") body += `<div class="assist-message user"><div class="sender">You</div><p>${esc(question)}</p></div><div class="assist-state error" role="alert"><strong>${icon("alert")}Run failed</strong><p>Question retained.</p><div class="rail-actions"><button class="btn danger" data-action="retry-assist">Retry question</button></div></div>`;
  if (state === "offline") body += `<div class="assist-state offline" role="alert"><strong>${icon("alert")}Local gateway offline</strong><p>Feed replay still runs. Answers disabled.</p><dl class="key-grid"><dt>Gateway</dt><dd class="text-critical">Offline</dd><dt>Draft</dt><dd>Retained locally</dd></dl></div>`;
  if (state !== "unsupported") body += `<div class="assist-run"><details class="assist-details" ${state === "running" ? "open" : ""}><summary>${icon("intel", "sm")}Processing stages<span class="status ${state === "failed" ? "critical" : state === "running" ? "info" : "success"}">${state === "running" ? "Running" : state === "failed" ? "Failed" : "Ready"}</span></summary><div class="pipeline-mini"><div class="pipeline-step"><span class="pipeline-dot">${icon("check", "sm")}</span><div><strong>L0 pointer</strong><span>${esc(hop().rpp1.file)}</span></div></div><div class="pipeline-step"><span class="pipeline-dot">${icon("check", "sm")}</span><div><strong>L1 features</strong><span>${esc(hop().rpp1.engine)}</span></div></div><div class="pipeline-step"><span class="pipeline-dot"></span><div><strong>L2 work order</strong><span>wo: ${esc(feed.flag.wo)}</span></div></div></div></details><button class="btn" data-action="open-full-run">Open full run ${icon("arrow", "sm")}</button></div>`;
  const disabled = ["running", "unsupported", "offline"].includes(state);
  if (state !== "unsupported") footer += `<form class="composer" data-assist-form><label for="assist-question">Ask about this hop</label><div class="composer-box"><textarea id="assist-question" ${disabled ? "disabled" : ""} placeholder="Ask about L1 features or the flag">${state === "failed" ? esc(question) : ""}</textarea><button class="btn primary icon-only ${state === "running" ? "loading" : ""}" type="submit" ${disabled ? "disabled" : ""} aria-label="Send question">${state === "running" ? "" : icon("arrow")}</button></div><p class="composer-hint">Bound to ${asset.id} / ${asset.component} · Ctrl+Enter to send</p></form>`;
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
  board = response?.ok ? await response.json() : board;
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
  const cont = containment();
  const contProven = cont.state === "CONTAINED" && cont.denies.length > 0;
  const titles = { manual: ["Manual evidence", "source-gap"], history: ["History evidence", "CMMS"], signal: ["Signal evidence", now.rpp1.file], containment: ["Containment evidence", contProven ? `openshell · ${cont.sandbox}` : cont.state === "UNSAFE" ? "UNSAFE" : "source-gap"] };
  const gap = type === "manual" || (type === "containment" && !contProven && cont.state !== "UNSAFE");
  let content = "";
  if (type === "manual") content = `<section class="rail-section"><div class="rail-kicker">Manual</div><div class="rail-heading">Source-gap</div><p>No packed SKF page in this feed. Will not invent a quote.</p></section>`;
  if (type === "history") content = feed.cmms.length ? `<section class="rail-section"><div class="rail-kicker">CMMS rows</div><div class="rail-heading">Alias MTR-07 → RPP1</div></section>${feed.cmms.map(row => `<div class="evidence-document">wo_id: <mark>${esc(row.wo_id)}</mark><br>asset_id: ${esc(row.asset_id)}<br>opened: ${esc(row.opened)}<br>closed: ${dash(row.closed)}<br>fault: <mark>${esc(row.fault)}</mark><br>action: ${esc(row.action)}<br>parts: <mark>${esc(row.parts)}</mark><br>source: ${esc(row.source)}</div>`).join("")}` : `<section class="rail-section"><p>No CMMS rows for this asset.</p></section>`;
  if (type === "signal") content = `<section class="rail-section"><div class="rail-kicker">Exact signal window</div><div class="rail-heading mono">${esc(now.rpp1.source)}</div><dl class="key-grid"><dt>Window</dt><dd class="num">${esc(now.rpp1.window)}</dd><dt>Sampling</dt><dd class="num">${now.rpp1.fs_hz} Hz</dd><dt>Speed</dt><dd class="num">${dash(now.rpp1.rpm)} rpm</dd><dt>RMS</dt><dd class="num">${dash(now.rpp1.rms)} g</dd><dt>BPFI</dt><dd>${now.rpp1.bpfi.detected ? `${now.rpp1.bpfi.hz} Hz` : "not detected"}</dd></dl></section>${rmsChart(340, 105, "RPP1 RMS series")}<div class="limit-note">${icon("alert", "sm")}No 12 kHz samples on the board. Locator retains ${esc(now.rpp1.file)} ${esc(now.rpp1.window)}.</div>`;
  if (type === "containment") content = containmentRail(cont);
  return `<aside class="utility-rail" aria-label="Evidence Viewer" data-overlay-rail><div class="rail-header">${icon("file")}<div class="rail-title"><strong>${titles[type][0]}</strong><span>${titles[type][1]}</span></div><div class="rail-header-actions"><button class="btn sm" data-action="return-rail">${icon("back", "sm")}Back</button><button class="btn icon-only sm" data-action="close-rail" aria-label="Close Evidence Viewer">${icon("close")}</button></div></div><div class="rail-body"><div class="viewer-toolbar"><span class="badge ${gap ? "warning" : cont.state === "UNSAFE" && type === "containment" ? "critical" : "success"}">${gap ? "Source-gap" : type === "containment" ? "Gateway audit" : "Feed artifact"}</span></div>${content}${type === "manual" && expanded ? `<p class="section-note">Still no page.</p>` : ""}${type === "manual" ? `<button class="btn" style="width:100%;margin-top:12px" data-action="expand-evidence">${expanded ? "Collapse full artifact" : "Open full artifact"}</button>` : ""}</div></aside>`;
}

function render() {
  if (!feed) {
    app.innerHTML = `<main class="page"><div class="page-inner compact"><p>Loading feed.json…</p></div></main>`;
    return;
  }
  const route = getRoute();
  let main;
  if (route.path === "/incidents") main = inboxPage(route);
  else if (route.path.startsWith("/incidents/")) main = incidentDetailPage(route);
  else if (route.path === "/floor") main = floorPage(route);
  else if (route.path.startsWith("/assets")) main = assetPage(route);
  else main = intelligencePage(route);
  const railMode = route.params.get("rail");
  const rail = railMode === "preview" ? objectPreviewRail(route) : railMode === "assist" ? assistRail(route) : railMode === "evidence" ? evidenceRail(route) : "";
  app.innerHTML = shell(main, route, rail);
  syncFloor(route);
  syncPart(route);
  const twinFrame = app.querySelector("[data-twin-frame]");
  const twinStatus = app.querySelector("[data-twin-status]");
  if (twinFrame && twinStatus) {
    const setTwinStatus = (message, state) => {
      twinStatus.textContent = message;
      twinStatus.dataset.state = state;
      twinFrame.setAttribute("aria-busy", String(state === "loading"));
    };
    twinFrame.addEventListener("load", () => {
      setTwinStatus("Loading 3D inspection…", "loading");
    });
    twinFrame.addEventListener("error", () => setTwinStatus("Unable to load 3D inspection.", "failed"));
  }
  document.title = `${activeModule(route.path)[0].toUpperCase()}${activeModule(route.path).slice(1)} · Forge Operations`;
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
  updateRoute({ rail: "evidence", evidence: type, returnRail: route.params.get("rail") || "preview", expanded: null });
}

function startAssist(question) {
  draftQuestion = question;
  clearTimeout(assistTimer);
  updateRoute({ rail: "assist", assistState: "running", question });
  assistTimer = setTimeout(() => {
    const current = getRoute();
    if (current.params.get("rail") === "assist" && current.params.get("assistState") === "running") updateRoute({ assistState: "answered" });
  }, 400);
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
  if (openMetricInfo) {
    openMetricInfo = "";
    render();
  }
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
    location.hash = hashFor(`/assets/${target.dataset.openAsset}`);
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
    focusRestoreId = lastTrigger?.dataset.focusId || "assist-trigger";
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
    const twinFrame = app.querySelector("[data-twin-frame]");
    if (twinFrame?.dataset.issueMarker === "true") {
      __twin.lightPart(twinFrame.dataset.inspectionAsset, twinFrame.dataset.inspectionComponent);
    }
  }
  if (action === "view-floor") {
    const asset = selectedAsset(getRoute());
    location.hash = hashFor("/floor", { asset: asset.id, incident: asset.incident || selectedIncident(getRoute())?.id, rail: "preview" });
  }
  if (action === "open-full-run") location.hash = hashFor("/intelligence", { run: "TAPE-20", incident: selectedIncident(getRoute())?.id });
  if (action === "open-asset") location.hash = hashFor(`/assets/${selectedAsset(getRoute()).id}`);
  if (action === "select-supported") location.hash = hashFor("/floor", { asset: "RPP1", incident: derivedIncident()?.id, rail: "assist", assistState: "ready" });
  if (action === "retry-assist") startAssist(getRoute().params.get("question") || draftQuestion || "What L1 features are on this hop?");
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
    focusRestoreId = lastTrigger?.dataset.focusId || "assist-trigger";
    updateRoute({ rail: null, evidence: null, returnRail: null });
  }
  if (event.key === "Enter" && event.target.matches("[data-global-search]")) {
    event.preventDefault();
    updateRoute({ search: event.target.value || null }, "/incidents");
  }
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && event.target.id === "assist-question") event.target.closest("form")?.requestSubmit();
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
    cursor = feed.hops.length - 1;
    render();
    return;
  }
  replayTimer = setInterval(() => {
    if (cursor >= feed.hops.length - 1) {
      clearInterval(replayTimer);
      return;
    }
    cursor += 1;
    render();
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
      stations: scene.placements.filter(p => p.kind === "station").map(p => ({ asset_id: p.asset_id, model: p.model || p.file.replace(/\.glb$/, ""), cell: p.cell || null, position: p.position, monitored: bound.has(p.asset_id), role: bound.get(p.asset_id)?.role || null, source: bound.get(p.asset_id)?.source || null })),
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
  board = boardResponse?.ok ? await boardResponse.json() : null;
  loadStations();
  cursor = 0;
  if (!location.hash) location.replace("#/incidents");
  else render();
  startReplay();
  // Containment evidence is live gateway state, so keep it current after the tape replay ends.
  setInterval(async () => { if (attemptState === "running") return; const before = JSON.stringify(board?.containment); await refreshBoard(); if (JSON.stringify(board?.containment) !== before) render(); }, 5000);
}

window.addEventListener("hashchange", render);
window.addEventListener("message", handleTwinMessage);
window.addEventListener("resize", () => { positionFloorLive(); positionPartLive(); });
boot().catch(err => {
  app.innerHTML = `<main class="page"><div class="page-inner compact"><h1>Feed missing</h1><p>${esc(err.message)}</p><p class="section-note">Run scripts/build-prototype-feed.py on spark.</p></div></main>`;
});
