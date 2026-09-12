import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// Two modes share one scene graph:
//   inspection (default): perspective + orbit, hero framing, focus hides other stations.
//   plan (?view=plan|top): fixed orthographic bird's-eye, every station, neutral materials,
//                          focus dims the rest. Labels/markers are drawn by the parent from
//                          the `twin:layout` anchors this file posts.
const query = new URLSearchParams(location.search);
const PLAN_VIEWS = new Set(["plan", "top"]);
// part: one station at the origin, grayscale, orbit allowed, click a part → `twin:part`.
const partMode = query.get("view") === "part";
let view = PLAN_VIEWS.has(query.get("view")) ? query.get("view") : partMode ? "part" : "inspection";
const planMode = PLAN_VIEWS.has(view);
const grayMode = planMode || partMode;
const partAsset = partMode ? (query.get("asset") || "RPP1") : null;

const canvas = document.getElementById("c");
const parentOrigin = `${location.protocol}//${location.hostname}:4173`;
const hud = {
  asset: document.getElementById("asset"),
  part: document.getElementById("part"),
  source: document.getElementById("source"),
};
if (grayMode) document.body.classList.add("plan");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: grayMode });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, grayMode ? 1.5 : 1.25));
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(grayMode ? 0xe6eaf0 : 0xf4f4f2);
const groundGrid = new THREE.GridHelper(planMode ? 40 : 24, planMode ? 40 : 24, grayMode ? 0xb6c0cc : 0x94a3b8, grayMode ? 0xd3d9e1 : 0xcbd5e1);
scene.add(groundGrid);
scene.add(new THREE.HemisphereLight(0xc8d4e8, 0x3a3228, 1.0));
scene.add(new THREE.AmbientLight(0xffffff, grayMode ? 0.7 : 0.45));
const sun = new THREE.DirectionalLight(0xffffff, grayMode ? 0.9 : 1.1);
sun.position.set(6, 12, 4);
scene.add(sun);

// Stations live in one group so plan mode can turn the 21 m line to run left→right.
const line = new THREE.Group();
line.name = "LINE";
if (planMode) line.rotation.y = -Math.PI / 2; // feed cluster (z≈+5) lands on the left, flow runs left→right
scene.add(line);

const perspective = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
perspective.position.set(8, 6, 8);
const ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);
let camera = planMode ? ortho : perspective;

const controls = new OrbitControls(perspective, canvas);
controls.enableDamping = true;
controls.enabled = !planMode;

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const loader = new GLTFLoader();
const cache = new Map();

let pickRoots = [];
let assetMap = { hero: "RPP1", assets: [] };
let sceneSpec = { cells: [], placements: [] };
let lit = null;
let point = null;
let focused = null;
let hovered = null;
let bridgeReady = false;
let inset = { left: 0, top: 0, right: 0, bottom: 0 };
let layoutDirty = true;

// Plan-mode materials: neutral by spec; state is carried by outline + parent markers.
const neutralMat = new THREE.MeshStandardMaterial({ color: 0xc9d1db, roughness: 0.9, metalness: 0.05 });
const dimMat = new THREE.MeshStandardMaterial({ color: 0xdde3ea, roughness: 1, metalness: 0, transparent: true, opacity: 0.32, depthWrite: false });
const outlineMat = new THREE.LineBasicMaterial({ color: 0x1d4ed8 });
const partMat = new THREE.MeshStandardMaterial({ color: 0x9db4dc, emissive: 0x1d4ed8, emissiveIntensity: 0.35, roughness: 0.7, metalness: 0.05 });
let litPart = null;
let outline = null;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w || canvas.height !== h) {
    renderer.setSize(w, h, false);
    perspective.aspect = w / Math.max(h, 1);
    perspective.updateProjectionMatrix();
    if (planMode) fitTo(focused, false);
    layoutDirty = true;
  }
}

async function loadGltf(file) {
  if (!cache.has(file)) {
    cache.set(
      file,
      loader.loadAsync(`/twin/glb/${file}`).then((g) => g.scene)
    );
  }
  return (await cache.get(file)).clone(true);
}

function walkNamed(obj) {
  const names = [];
  let n = obj;
  while (n) {
    if (n.name) names.push(n.name);
    if (n.userData && n.userData.asset_id) names.push(n.userData.asset_id);
    n = n.parent;
  }
  return names;
}

function stationRoot(obj) {
  let n = obj;
  while (n) {
    if (n.userData && n.userData.asset_id) return n;
    n = n.parent;
  }
  return null;
}

function lookup(assetId) {
  return (assetMap.assets || []).find((a) => a.asset_id === assetId) || null;
}

function frameOn(obj) {
  if (!obj) return;
  const b = new THREE.Box3().setFromObject(obj);
  if (b.isEmpty()) return;
  const c = new THREE.Vector3();
  b.getCenter(c);
  const s = Math.max(b.getSize(new THREE.Vector3()).length(), 0.8);
  controls.target.copy(c);
  perspective.position.set(c.x + s * 0.7, c.y + s * 0.45, c.z + s * 0.55);
}

// ---------- plan view: fixed bird's-eye orthographic camera ----------

function viewDirection() {
  if (view === "top") return new THREE.Vector3(0, 1, 0);
  const yaw = THREE.MathUtils.degToRad(16); // small yaw keeps the 21 m line near-horizontal; pitch carries the 3D read
  const pitch = THREE.MathUtils.degToRad(38);
  return new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).normalize();
}

function aimCamera(target) {
  const dir = viewDirection();
  ortho.up.set(0, view === "top" ? 0 : 1, view === "top" ? -1 : 0);
  ortho.position.copy(target).addScaledVector(dir, 60);
  ortho.lookAt(target);
  ortho.updateMatrixWorld(true);
}

const camState = { target: new THREE.Vector3(), halfW: 10, halfH: 10 };
let tween = null;

function applyCamState(s) {
  aimCamera(s.target);
  ortho.left = -s.halfW;
  ortho.right = s.halfW;
  ortho.top = s.halfH;
  ortho.bottom = -s.halfH;
  ortho.updateProjectionMatrix();
  layoutDirty = true;
}

// Fit a world box into the viewport minus the parent's overlay inset. Padding is in world
// metres so a single station still gets room for its label.
function fitState(box, pad) {
  const W = Math.max(canvas.clientWidth, 1);
  const H = Math.max(canvas.clientHeight, 1);
  const center = box.getCenter(new THREE.Vector3());
  aimCamera(center);
  const inv = ortho.matrixWorldInverse;
  const min = new THREE.Vector2(Infinity, Infinity);
  const max = new THREE.Vector2(-Infinity, -Infinity);
  const p = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(inv);
    min.min(new THREE.Vector2(p.x, p.y));
    max.max(new THREE.Vector2(p.x, p.y));
  }
  const spanX = max.x - min.x + pad * 2;
  const spanY = max.y - min.y + pad * 2;
  const availW = Math.max(W - inset.left - inset.right, 80);
  const availH = Math.max(H - inset.top - inset.bottom, 80);
  const ppu = Math.min(availW / spanX, availH / spanY);
  const halfW = W / 2 / ppu;
  const halfH = H / 2 / ppu;
  const cx = inset.left + availW / 2;
  const cy = inset.top + availH / 2;
  const offX = (W / 2 - cx) / ppu + (min.x + max.x) / 2;
  const offY = (cy - H / 2) / ppu + (min.y + max.y) / 2;
  // view-space offsets → world via the camera basis
  const right = new THREE.Vector3().setFromMatrixColumn(ortho.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(ortho.matrixWorld, 1);
  const target = center.clone().addScaledVector(right, offX).addScaledVector(up, offY);
  return { target, halfW, halfH };
}

function lineBox() {
  const box = new THREE.Box3();
  for (const root of pickRoots) if (root.userData.kind === "station") box.expandByObject(root);
  return box;
}

// Selecting a station frames its cell (neighbours stay visible for spatial context); the
// station itself is marked by the outline. No selection frames the whole line.
function focusBox(assetId) {
  const root = assetId ? scene.getObjectByName(assetId) : null;
  if (!root) return lineBox();
  const box = new THREE.Box3().setFromObject(root);
  const cell = root.userData.cell;
  if (cell) {
    for (const other of pickRoots) if (other.userData.cell === cell) box.expandByObject(other);
  }
  const size = box.getSize(new THREE.Vector3());
  if (size.x < 4) box.expandByVector(new THREE.Vector3((4 - size.x) / 2, 0, 0));
  return box;
}

function fitTo(assetId, animate = true) {
  if (!planMode) return;
  const box = focusBox(assetId);
  if (box.isEmpty()) return;
  const next = fitState(box, assetId ? 0.8 : 0.9);
  if (!animate || reduceMotion) {
    camState.target.copy(next.target);
    camState.halfW = next.halfW;
    camState.halfH = next.halfH;
    applyCamState(camState);
    tween = null;
    return;
  }
  tween = { from: { target: camState.target.clone(), halfW: camState.halfW, halfH: camState.halfH }, to: next, t0: performance.now(), ms: 320 };
}

function stepTween(now) {
  if (!tween) return;
  const k = Math.min((now - tween.t0) / tween.ms, 1);
  const e = 1 - Math.pow(1 - k, 3);
  camState.target.lerpVectors(tween.from.target, tween.to.target, e);
  camState.halfW = tween.from.halfW + (tween.to.halfW - tween.from.halfW) * e;
  camState.halfH = tween.from.halfH + (tween.to.halfH - tween.from.halfH) * e;
  applyCamState(camState);
  if (k >= 1) tween = null;
}

function setOutline(root) {
  if (outline) {
    scene.remove(outline);
    outline.geometry.dispose();
    outline = null;
  }
  if (!root) return;
  const b = new THREE.Box3().setFromObject(root);
  if (b.isEmpty()) return;
  const m = 0.12;
  const y = b.min.y + 0.01;
  const pts = [
    new THREE.Vector3(b.min.x - m, y, b.min.z - m), new THREE.Vector3(b.max.x + m, y, b.min.z - m),
    new THREE.Vector3(b.max.x + m, y, b.max.z + m), new THREE.Vector3(b.min.x - m, y, b.max.z + m),
    new THREE.Vector3(b.min.x - m, y, b.min.z - m),
  ];
  outline = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), outlineMat);
  outline.renderOrder = 2;
  scene.add(outline);
}

function applyPlanMaterials() {
  for (const root of pickRoots) {
    const dim = Boolean(focused) && root.userData.asset_id !== focused;
    root.traverse((o) => {
      if (o.isMesh) o.material = dim ? dimMat : neutralMat;
    });
  }
}

// Screen-space rects per station, in iframe pixels. Parent positions labels on these.
function postLayout() {
  if (!planMode || parent === window) return;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  const p = new THREE.Vector3();
  const anchors = [];
  for (const root of pickRoots) {
    const b = root.userData.box;
    if (!b) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(camera);
      const sx = (p.x + 1) / 2 * W;
      const sy = (1 - p.y) / 2 * H;
      minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
    }
    anchors.push({ asset_id: root.userData.asset_id, x: minX, y: minY, w: maxX - minX, h: maxY - minY });
  }
  parent.postMessage({ type: "twin:layout", view, width: W, height: H, anchors }, parentOrigin);
}

function postStations() {
  if (parent === window) return;
  const stations = sceneSpec.placements
    .filter((p) => p.kind === "station")
    .map((p) => {
      const rec = lookup(p.asset_id);
      return {
        asset_id: p.asset_id,
        model: p.model || p.file.replace(/\.glb$/, ""),
        cell: p.cell || null,
        position: p.position,
        monitored: Boolean(rec),
        role: rec ? rec.role : null,
        source: rec ? rec.source : null,
        loaded: pickRoots.some((r) => r.userData.asset_id === p.asset_id),
      };
    });
  parent.postMessage({ type: "twin:stations", cells: sceneSpec.cells || [], stations, license: sceneSpec.source, cite: sceneSpec.cite }, parentOrigin);
}

// ---------- shared focus / light ----------

// inspection: hide other station roots. plan: never hide, dim + outline + zoom.
function focusAsset(id) {
  focused = id || null;
  if (planMode) {
    applyPlanMaterials();
    setOutline(focused ? scene.getObjectByName(focused) : null);
    fitTo(focused);
  } else {
    for (const root of pickRoots) {
      root.visible = !focused || root.userData.asset_id === focused;
    }
    const obj = focused ? scene.getObjectByName(focused) : null;
    if (obj) frameOn(obj);
    else {
      const hero = scene.getObjectByName(assetMap.hero);
      frameOn(hero || pickRoots[0]);
    }
  }
  const url = new URL(location.href);
  if (focused) url.searchParams.set("asset", focused);
  else url.searchParams.delete("asset");
  history.replaceState(null, "", url);
}

function setView(next) {
  if (!planMode || !PLAN_VIEWS.has(next) || next === view) return;
  view = next;
  const url = new URL(location.href);
  url.searchParams.set("view", view);
  history.replaceState(null, "", url);
  fitTo(focused);
}

function setHud(assetId, part, source) {
  if (hud.asset) hud.asset.textContent = assetId || "—";
  if (hud.part) hud.part.textContent = part || "—";
  if (hud.source) hud.source.textContent = source || "—";
  if (hud.asset) hud.asset.className = assetId === assetMap.hero ? "hero" : "";
  window.dispatchEvent(new CustomEvent("twinselect", { detail: { asset_id: assetId, part, source } }));
}

function clearLit() {
  if (lit && lit.material && lit.userData._baseEmissive) {
    lit.material.emissive.copy(lit.userData._baseEmissive);
  }
  lit = null;
  if (point) {
    scene.remove(point);
    point = null;
  }
}

function lightMesh(mesh) {
  clearLit();
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const m = mats[0];
  if (m && m.emissive) {
    mesh.material = m.clone();
    mesh.userData._baseEmissive = m.emissive.clone();
    mesh.material.emissive = new THREE.Color(0xe6dcc8);
    mesh.material.emissiveIntensity = 0.7;
    lit = mesh;
  }
  const w = new THREE.Vector3();
  mesh.getWorldPosition(w);
  point = new THREE.PointLight(0xe6dcc8, 3, 3);
  point.position.copy(w);
  scene.add(point);
}

function lightPart(assetId, part) {
  if (planMode) return false;
  const root = scene.getObjectByName(assetId);
  if (!root) return false;
  const node = root.getObjectByName(part) || root;
  if (partMode) return Boolean(highlightPart(node));
  const mesh = node.isMesh ? node : node.getObjectByProperty("isMesh", true);
  if (mesh) lightMesh(mesh);
  return Boolean(mesh);
}

// part mode: grayscale everywhere except the picked sub-tree, which gets the blue part material.
function highlightPart(node) {
  if (litPart) litPart.traverse((o) => { if (o.isMesh) o.material = neutralMat; });
  litPart = node || null;
  if (litPart) litPart.traverse((o) => { if (o.isMesh) o.material = partMat; });
  return litPart;
}

// Named ancestor of a mesh that is a meaningful part (skips auto names like mesh_12 / color_3).
function partNodeFor(obj, root) {
  const rec = lookup(root.userData.asset_id);
  let n = obj;
  let fallback = null;
  while (n && n !== root) {
    if (rec && rec.click_nodes.includes(n.name) && n.name !== root.userData.asset_id) return n;
    if (!fallback && n.name && !n.name.startsWith("mesh_") && !n.name.startsWith("color")) fallback = n;
    n = n.parent;
  }
  return fallback || obj;
}

window.addEventListener("message", (event) => {
  if (event.source !== parent) return;
  if (event.origin !== parentOrigin) return;
  if (!bridgeReady || !event.data || typeof event.data !== "object") return;
  const { type, assetId, part } = event.data;
  const validAsset = typeof assetId === "string" && assetId.length > 0 && assetId.length <= 128;
  if (type === "twin:focus") {
    if (validAsset) focusAsset(assetId);
    return;
  }
  if (type === "twin:fit") {
    focusAsset(null);
    return;
  }
  if (type === "twin:part:clear") {
    if (partMode) highlightPart(null);
    return;
  }
  if (type === "twin:view") {
    const next = event.data.view;
    const box = event.data.inset;
    if (box && typeof box === "object") {
      inset = {
        left: Math.max(0, Number(box.left) || 0), top: Math.max(0, Number(box.top) || 0),
        right: Math.max(0, Number(box.right) || 0), bottom: Math.max(0, Number(box.bottom) || 0),
      };
    }
    if (typeof next === "string" && PLAN_VIEWS.has(next) && next !== view) setView(next);
    else fitTo(focused, false);
    return;
  }
  const validPart = typeof part === "string" && part.length > 0 && part.length <= 128;
  if (type === "twin:light" && validAsset && validPart) lightPart(assetId, part);
});

function hitAt(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  pointer.x = ((clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((clientY - r.top) / r.height) * 2 + 1;
  scene.updateMatrixWorld(true);
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObjects(pickRoots, true);
}

function pick(ev) {
  const hits = hitAt(ev.clientX, ev.clientY);
  if (!hits.length) {
    if (partMode) {
      highlightPart(null);
      if (parent !== window) parent.postMessage({ type: "twin:part", asset_id: partAsset, part: null }, parentOrigin);
      return;
    }
    if (planMode) return; // empty click keeps the selection; parent owns "Fit line"
    clearLit();
    setHud("—", "—", "—");
    if (focused) focusAsset(null);
    return;
  }
  const hit = hits[0];
  const root = stationRoot(hit.object);
  const assetId = root ? root.userData.asset_id : null;
  if (partMode) {
    if (!root) return;
    const node = highlightPart(partNodeFor(hit.object, root));
    const part = node ? node.name : assetId;
    setHud(assetId, part, lookup(assetId)?.source);
    if (parent !== window) parent.postMessage({ type: "twin:part", asset_id: assetId, part }, parentOrigin);
    return;
  }
  if (planMode) {
    if (assetId && parent !== window) parent.postMessage({ type: "twin:select", asset_id: assetId }, parentOrigin);
    else if (assetId) focusAsset(assetId);
    return;
  }
  const rec = lookup(assetId);
  const names = walkNamed(hit.object);
  const named =
    (rec && rec.click_nodes.find((n) => names.includes(n) && n !== assetId)) ||
    names.find((n) => n && n !== assetId && !n.startsWith("color") && !n.startsWith("mesh_"));
  const part = named || (rec && rec.part) || assetId;
  const source =
    rec && rec.source
      ? rec.source
      : assetId
        ? "scenery"
        : "—";
  if (hit.object.isMesh) lightMesh(hit.object);
  setHud(assetId, part, source);
  if (assetId && assetId !== focused) focusAsset(assetId);
}

let hoverAt = 0;
function hover(ev) {
  const now = performance.now();
  if (now - hoverAt < 60) return;
  hoverAt = now;
  const hits = hitAt(ev.clientX, ev.clientY);
  const root = hits.length ? stationRoot(hits[0].object) : null;
  const id = root ? root.userData.asset_id : null;
  if (id === hovered) return;
  hovered = id;
  canvas.style.cursor = id ? "pointer" : "default";
  if (parent !== window) parent.postMessage({ type: "twin:hover", asset_id: id }, parentOrigin);
}

async function boot() {
  const [spec, map] = await Promise.all([
    fetch("/twin/scene.json").then((r) => r.json()),
    fetch("/twin/asset-map.json").then((r) => r.json()),
  ]);
  sceneSpec = spec;
  assetMap = map;
  const box = new THREE.Box3();

  for (const p of sceneSpec.placements) {
    if (p.kind === "scenery") continue;
    if (partMode && p.asset_id !== partAsset) continue;
    let model;
    try {
      model = await loadGltf(p.file);
    } catch (e) {
      console.warn("skip", p.file, e);
      continue;
    }
    model.name = p.asset_id;
    model.userData.asset_id = p.asset_id;
    model.userData.kind = p.kind;
    model.userData.cell = p.cell || null;
    if (partMode) model.position.set(0, p.position[1], 0);
    else model.position.set(p.position[0], p.position[1], p.position[2]);
    model.rotation.set(p.rotation[0], p.rotation[1], p.rotation[2], "XYZ");
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = false;
      }
    });
    line.add(model);
    pickRoots.push(model);
    if (p.kind === "station") box.expandByObject(model);
  }
  scene.updateMatrixWorld(true);
  for (const root of pickRoots) root.userData.box = new THREE.Box3().setFromObject(root);

  if (planMode) {
    applyPlanMaterials();
    groundGrid.position.y = -0.005;
    resize();
    fitTo(null, false);
  } else if (partMode) {
    applyPlanMaterials();
    groundGrid.position.y = -0.005;
    const root = pickRoots[0];
    if (root) {
      const b = root.userData.box;
      const c = b.getCenter(new THREE.Vector3());
      const s = Math.max(b.getSize(new THREE.Vector3()).length(), 0.8);
      controls.target.copy(c);
      perspective.position.set(c.x + s * 0.75, c.y + s * 0.55, c.z + s * 0.75);
      controls.minDistance = s * 0.3;
      controls.maxDistance = s * 3;
      controls.maxPolarAngle = Math.PI / 2 - 0.02;
    }
    perspective.near = 0.02;
    perspective.far = 80;
    perspective.updateProjectionMatrix();
  } else {
    const heroObj = scene.getObjectByName(assetMap.hero);
    const focus = new THREE.Vector3();
    if (heroObj) heroObj.getWorldPosition(focus);
    else if (!box.isEmpty()) box.getCenter(focus);
    controls.target.copy(focus);
    perspective.position.set(focus.x + 3.2, focus.y + 2.1, focus.z + 2.4);
    perspective.near = 0.05;
    perspective.far = 80;
    perspective.updateProjectionMatrix();
  }
  window.__twin = { scene, camera, box, pickRoots, focusAsset, lightPart, highlightPart, setView, fit: () => focusAsset(null), view: () => view, setFrozen(value) { controls.enabled = !value && !planMode; } };
  window.dispatchEvent(new CustomEvent("twinready"));

  const hero = scene.getObjectByName(assetMap.hero);
  if (hero && !planMode) {
    setHud(assetMap.hero, lookup(assetMap.hero)?.part, lookup(assetMap.hero)?.source);
  }
  const q = partMode ? null : new URLSearchParams(location.search).get("asset");
  if (q) {
    const rec = lookup(q);
    focusAsset(q);
    if (!planMode) setHud(q, rec?.part || q, rec?.source || "scenery");
    if (planMode) fitTo(q, false);
  }

  canvas.addEventListener("click", pick);
  if (grayMode) canvas.addEventListener("pointermove", hover);
  window.addEventListener("resize", resize);
  resize();
  window.__twin.pickAt = (nx, ny) => {
    pointer.x = nx;
    pointer.y = ny;
    scene.updateMatrixWorld(true);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickRoots, true);
    if (!hits.length) return { hit: false };
    const o = hits[0].object;
    const root = stationRoot(o);
    return { hit: true, asset: root && root.userData.asset_id, name: o.name };
  };
  bridgeReady = true;
  if (parent !== window) {
    postStations();
    parent.postMessage({ type: "twin:ready", view }, parentOrigin);
  }

  let last = 0;
  const minFrameMs = grayMode ? 0 : 1000 / 30;
  function frame(t) {
    requestAnimationFrame(frame);
    if (t - last < minFrameMs) return;
    last = t;
    if (planMode) stepTween(t);
    else controls.update();
    resize();
    renderer.render(scene, camera);
    if (layoutDirty) {
      layoutDirty = false;
      postLayout();
    }
  }
  requestAnimationFrame(frame);
}

boot();
