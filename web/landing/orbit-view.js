import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { isolateFiles, placementFor, shouldAutoOrbit, focusProgress } from "./orbit.mjs";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const loader = new GLTFLoader();

async function loadScene() {
  const response = await fetch("/twin/scene.json");
  if (!response.ok) throw new Error("scene unavailable");
  return response.json();
}

async function mountConcept(el, scene) {
  const assetId = el.dataset.concept;
  const files = isolateFiles(scene, assetId);
  const placement = placementFor(scene, assetId);
  if (!files.length || !placement) return;

  const canvas = document.createElement("canvas");
  el.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0xf8fafc, 0);

  const world = new THREE.Scene();
  const neutral = new THREE.MeshStandardMaterial({ color: 0x9b9b9b, roughness: 0.8, metalness: 0.1, side: THREE.DoubleSide });
  world.add(new THREE.HemisphereLight(0xffffff, 0xd4d4d4, 1));
  world.add(new THREE.AmbientLight(0xffffff, 0.65));
  const key = new THREE.DirectionalLight(0xffffff, 0.7);
  key.position.set(4, 8, 3);
  world.add(key);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 80);
  const model = await loader.loadAsync(`/twin/glb/${placement.file}`);
  const root = model.scene;
  root.position.set(0, 0, 0);
  world.add(root);
  root.traverse(node => { if (node.isMesh) node.material = neutral; });
  const stage = el.closest(".scroll-diagnostic");
  const part = stage ? root.getObjectByName("URjoint1_Bodies") : null;
  const highlight = neutral.clone();
  if (part) part.traverse(node => { if (node.isMesh) node.material = highlight; });

  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.2);
  const dist = radius * 2.4;
  camera.position.set(center.x + dist * 0.7, center.y + dist * 0.45, center.z + dist * 0.7);
  camera.lookAt(center);

  let angle = 0;
  const focusBox = part ? new THREE.Box3().setFromObject(part) : box;
  const focusCenter = focusBox.getCenter(new THREE.Vector3());
  const focusRadius = focusBox.getSize(new THREE.Vector3()).length() / 2;
  const direction = new THREE.Vector3(0.7, 0.45, 0.7).normalize();
  const target = new THREE.Vector3();
  const red = new THREE.Color(0xc62828);

  function frame() {
    const { width, height } = el.getBoundingClientRect();
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (stage && part) {
      const bounds = stage.getBoundingClientRect();
      const mobile = window.innerWidth <= 700;
      const progress = focusProgress(
        mobile ? el.getBoundingClientRect().top - innerHeight * 0.6 : bounds.top - 80,
        mobile ? innerHeight * 0.4 : bounds.height - innerHeight + 80,
        reducedMotion.matches,
      );
      const eased = progress * progress * (3 - 2 * progress);
      const halfFov = Math.min(camera.fov * Math.PI / 360, Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect));
      const startDistance = radius / Math.sin(halfFov) * 1.05;
      const endDistance = Math.max(focusRadius / Math.sin(halfFov) * 1.3, radius * 0.65);
      target.lerpVectors(center, focusCenter, eased);
      camera.position.copy(target).addScaledVector(direction, THREE.MathUtils.lerp(startDistance, endDistance, eased));
      camera.lookAt(target);
      highlight.color.copy(neutral.color).lerp(red, eased);
    } else if (shouldAutoOrbit(reducedMotion.matches)) {
      angle += 0.004;
      camera.position.x = center.x + Math.cos(angle) * dist;
      camera.position.z = center.z + Math.sin(angle) * dist;
      camera.lookAt(center);
    }
    renderer.render(world, camera);
    requestAnimationFrame(frame);
  }
  frame();
}

async function start() {
  try {
    const scene = await loadScene();
    for (const el of document.querySelectorAll("[data-concept]")) {
      try {
        await mountConcept(el, scene);
      } catch {
        el.replaceChildren();
      }
    }
  } catch {
    for (const el of document.querySelectorAll("[data-concept]")) el.replaceChildren();
  }
}

start();
