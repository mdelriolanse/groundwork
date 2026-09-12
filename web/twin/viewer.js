import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const canvas = document.getElementById("c");
const hud = {
  asset: document.getElementById("asset"),
  part: document.getElementById("part"),
  source: document.getElementById("source"),
};

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c0c0c);
scene.add(new THREE.HemisphereLight(0xc8d4e8, 0x3a3228, 1.0));
scene.add(new THREE.AmbientLight(0xffffff, 0.45));
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(6, 12, 4);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
camera.position.set(8, 6, 8);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const loader = new GLTFLoader();
const cache = new Map();

let pickRoots = [];
let assetMap = { hero: "RPP1", assets: [] };
let lit = null;
let point = null;
let focused = null;

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w || canvas.height !== h) {
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
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
  camera.position.set(c.x + s * 0.7, c.y + s * 0.45, c.z + s * 0.55);
}

// ponytail: hide other station roots; ?asset= is the deep link
function focusAsset(id) {
  focused = id || null;
  for (const root of pickRoots) {
    root.visible = !focused || root.userData.asset_id === focused;
  }
  const obj = focused ? scene.getObjectByName(focused) : null;
  if (obj) frameOn(obj);
  else {
    const hero = scene.getObjectByName(assetMap.hero);
    frameOn(hero || pickRoots[0]);
  }
  const url = new URL(location.href);
  if (focused) url.searchParams.set("asset", focused);
  else url.searchParams.delete("asset");
  history.replaceState(null, "", url);
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

function pick(ev) {
  const r = canvas.getBoundingClientRect();
  pointer.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
  scene.updateMatrixWorld(true);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(pickRoots, true);
  if (!hits.length) {
    clearLit();
    setHud("—", "—", "—");
    if (focused) focusAsset(null);
    return;
  }
  const hit = hits[0];
  const root = stationRoot(hit.object);
  const assetId = root ? root.userData.asset_id : null;
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

async function boot() {
  const [sceneSpec, map] = await Promise.all([
    fetch("/twin/scene.json").then((r) => r.json()),
    fetch("/twin/asset-map.json").then((r) => r.json()),
  ]);
  assetMap = map;
  const box = new THREE.Box3();

  for (const p of sceneSpec.placements) {
    if (p.kind === "scenery") continue;
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
    model.position.set(p.position[0], p.position[1], p.position[2]);
    model.rotation.set(p.rotation[0], p.rotation[1], p.rotation[2], "XYZ");
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = false;
      }
    });
    scene.add(model);
    pickRoots.push(model);
    if (p.kind === "station") box.expandByObject(model);
  }

  const heroObj = scene.getObjectByName(assetMap.hero);
  const focus = new THREE.Vector3();
  if (heroObj) heroObj.getWorldPosition(focus);
  else if (!box.isEmpty()) box.getCenter(focus);
  controls.target.copy(focus);
  camera.position.set(focus.x + 3.2, focus.y + 2.1, focus.z + 2.4);
  camera.near = 0.05;
  camera.far = 80;
  camera.updateProjectionMatrix();
  scene.updateMatrixWorld(true);
  window.__twin = { scene, camera, box, pickRoots, focusAsset, setFrozen(value) { controls.enabled = !value; }, lightPart(assetId, part) {
    const root = scene.getObjectByName(assetId);
    if (!root) return false;
    const node = root.getObjectByName(part) || root;
    const mesh = node.isMesh ? node : node.getObjectByProperty("isMesh", true);
    if (mesh) lightMesh(mesh);
    return Boolean(mesh);
  } };
  window.dispatchEvent(new CustomEvent("twinready"));

  const hero = scene.getObjectByName(assetMap.hero);
  if (hero) {
    setHud(assetMap.hero, lookup(assetMap.hero)?.part, lookup(assetMap.hero)?.source);
  }
  const q = new URLSearchParams(location.search).get("asset");
  if (q) {
    const rec = lookup(q);
    focusAsset(q);
    setHud(q, rec?.part || q, rec?.source || "scenery");
  }

  canvas.addEventListener("click", pick);
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

  let last = 0;
  function frame(t) {
    requestAnimationFrame(frame);
    if (t - last < 1000 / 30) return;
    last = t;
    controls.update();
    resize();
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}

boot();
