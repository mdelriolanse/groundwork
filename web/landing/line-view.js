import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { lineStatus } from "./line-state.mjs";

const frame = document.querySelector(".line-view");
const motion = matchMedia("(prefers-reduced-motion: reduce)");
let visible = false;

async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("Unavailable");
  return response.json();
}

async function mount() {
  const [spec, tape, seed] = await Promise.all([json("/twin/scene.json"), json("/prototype/feed.json"), json("/prototype/incidents.json")]);
  const canvas = frame.querySelector("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setClearColor(0xe9edf1);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb0b0b0, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(5, 12, 7);
  scene.add(sun);
  scene.add(new THREE.GridHelper(40, 40, 0xc7cdd4, 0xdce1e7));
  const line = new THREE.Group();
  line.rotation.y = -Math.PI / 2;
  scene.add(line);
  const material = color => new THREE.MeshStandardMaterial({ color, roughness: .65, metalness: .1, side: THREE.DoubleSide });
  const gray = material(0xb9bec4), green = material(0x38a568), red = material(0xd12e36);
  green.emissive.set(0x196e3f);
  red.emissive.set(0xa81722);
  const loader = new GLTFLoader(), cache = new Map(), stations = [];
  const placements = spec.placements.filter(p => p.kind === "station");
  await Promise.all([...new Set(placements.map(p => p.file))].map(async file => {
    cache.set(file, await loader.loadAsync(`/twin/glb/${file}`));
  }));
  for (const placement of placements) {
    const root = cache.get(placement.file).scene.clone(true);
    root.position.fromArray(placement.position);
    root.rotation.set(...placement.rotation);
    root.traverse(node => { if (node.isMesh) node.material = gray; });
    line.add(root);
    stations.push({ id: placement.asset_id, root });
  }
  const box = new THREE.Box3().setFromObject(line), center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, .1, 200);
  const offset = new THREE.Vector3(2, 15, 18);
  const target = center.clone();
  let elapsed = 0, previous = 0;
  function fit() {
    camera.zoom = 1;
    target.copy(center);
    camera.position.copy(center).add(offset);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(() => {
    const { width, height } = frame.getBoundingClientRect();
    renderer.setSize(width, height, false);
    const aspect = width / height, halfWidth = size.x * .57;
    camera.left = -halfWidth; camera.right = halfWidth;
    camera.top = halfWidth / aspect; camera.bottom = -halfWidth / aspect;
    camera.updateProjectionMatrix();
  }).observe(frame);
  fit();
  motion.addEventListener("change", () => { elapsed = 0; fit(); });
  let lastStatus = "";
  function render(time) {
    requestAnimationFrame(render);
    const dt = previous ? Math.min((time - previous) / 1000, .1) : 0; previous = time;
    if (!visible || document.hidden) return;
    if (!motion.matches) {
      elapsed += dt;
      const entrance = Math.min(elapsed / 5, 1), sweep = -Math.cos(elapsed / 9);
      camera.zoom = 1 + 1.8 * entrance;
      target.copy(center);
      target.x += sweep * size.x * .3 * entrance;
      camera.position.copy(target).add(offset);
      camera.updateProjectionMatrix(); camera.lookAt(target);
    }
    const recorded = tape.hops[motion.matches ? 9 : Math.floor(time / 1800) % Math.min(10, tape.hops.length)];
    const current = lineStatus(null, null, recorded, null);
    current.flagged = (seed.incidents || []).map(incident => incident.asset_id).filter(Boolean);
    const key = JSON.stringify(current);
    if (lastStatus !== key) {
      for (const { id, root } of stations) root.traverse(node => { if (node.isMesh) node.material = current.flagged.includes(id) ? red : current.running.includes(id) ? green : gray; });
      lastStatus = key;
    }
    const pulse = motion.matches ? .3 : .2 + .3 * (.5 + .5 * Math.sin(time / 700));
    green.emissiveIntensity = pulse; red.emissiveIntensity = pulse;
    renderer.render(scene, camera);
  }
  requestAnimationFrame(render);
}
new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }, { rootMargin: "100px" }).observe(frame);
mount().catch(() => { frame.classList.add("unavailable"); });
