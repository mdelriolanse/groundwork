import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { isolateFiles, placementFor, shouldAutoOrbit } from "./orbit.mjs";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0xf8fafc, 1);

  const world = new THREE.Scene();
  world.add(new THREE.HemisphereLight(0xffffff, 0xcbd5e1, 1));
  world.add(new THREE.AmbientLight(0xffffff, 0.65));
  const key = new THREE.DirectionalLight(0xffffff, 0.7);
  key.position.set(4, 8, 3);
  world.add(key);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 80);
  const model = await loader.loadAsync(`/twin/glb/${placement.file}`);
  const root = model.scene;
  root.position.set(0, 0, 0);
  world.add(root);

  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.2);
  const dist = radius * 2.4;
  camera.position.set(center.x + dist * 0.7, center.y + dist * 0.45, center.z + dist * 0.7);
  camera.lookAt(center);

  let angle = 0;
  const orbit = shouldAutoOrbit(reducedMotion);

  function frame() {
    const { width, height } = el.getBoundingClientRect();
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (orbit) {
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
