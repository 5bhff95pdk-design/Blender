// ---------- Contexte de scène ----------
// Singletons partagés : scène, caméras, renderer, contrôles, helpers.
// `app` est un registre de services rempli à l'init (évite les cycles de modules).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

export const canvas = document.getElementById('c');
export const scene = new THREE.Scene();
scene.background = new THREE.Color('#1a1a1e');
scene.fog = new THREE.Fog('#1a1a1e', 20, 60);

export const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(3, 2.5, 4);

// Caméra orthographique (bascule Persp/Ortho)
export const orthoCam = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 200);
orthoCam.position.copy(camera.position);

let _activeCamera = camera;
export function activeCamera() { return _activeCamera; }
export function setActiveCamera(cam) { _activeCamera = cam; }

export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.outputColorSpace = THREE.SRGBColorSpace;

// Contrôles
export const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.08;
orbit.minDistance = 0.5;
orbit.maxDistance = 100;
orbit.target.set(0, 0.8, 0);
orbit.update();

export const transform = new TransformControls(camera, renderer.domElement);
// three <r169 : TransformControls EST un Object3D ; >= r169 : getHelper()
export const transformHelper = typeof transform.getHelper === 'function' ? transform.getHelper() : transform;
scene.add(transformHelper);

// Helpers
export const grid = new THREE.GridHelper(20, 20, '#3a3a3a', '#2a2a2a');
scene.add(grid);

export const axes = new THREE.AxesHelper(1.5);
scene.add(axes);

// Lumières studio
export const lights = {
  ambient: new THREE.AmbientLight(0xffffff, 0.4),
  key: new THREE.DirectionalLight(0xfff2e0, 1.2),
  fill: new THREE.DirectionalLight(0xc2d6ff, 0.5),
  rim: new THREE.DirectionalLight(0xffffff, 0.3),
};
lights.key.position.set(5, 8, 5);
lights.key.castShadow = true;
lights.key.shadow.mapSize.set(2048, 2048);
lights.key.shadow.camera.near = 0.5;
lights.key.shadow.camera.far = 30;
lights.key.shadow.camera.left = -10;
lights.key.shadow.camera.right = 10;
lights.key.shadow.camera.top = 10;
lights.key.shadow.camera.bottom = -10;
lights.fill.position.set(-4, 3, -3);
lights.rim.position.set(0, 5, -5);
scene.add(lights.ambient, lights.key, lights.fill, lights.rim);

// Curseur 3D (style Blender)
export const cursorGroup = new THREE.Group();
{
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.12, 0.14, 32),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.8 })
  );
  ring.rotation.x = Math.PI / 2;
  const crossX = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.02), new THREE.MeshBasicMaterial({ color: 0xff4444 }));
  const crossY = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.4), new THREE.MeshBasicMaterial({ color: 0x44ff44 }));
  const crossZ = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.4), new THREE.MeshBasicMaterial({ color: 0x4444ff }));
  crossZ.rotation.z = Math.PI / 2;
  cursorGroup.add(ring, crossX, crossY, crossZ);
}
cursorGroup.position.set(0, 0.01, 0);
scene.add(cursorGroup);

// Sol capteur d'ombres (invisible mais reçoit les ombres)
export const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 40),
  new THREE.ShadowMaterial({ opacity: 0.15 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
floor.name = '__floor';
scene.add(floor);

// Pivot multi-sélection (transform de plusieurs objets)
export const pivot = new THREE.Group();
pivot.visible = false;
scene.add(pivot);

// Environnement studio (généré une fois, pour les modes Material/Rendered)
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
let _envTexture = null;
export function envTexture() {
  if (_envTexture) return _envTexture;
  const pmrem = new THREE.PMREMGenerator(renderer);
  _envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return _envTexture;
}

// Registre de services (rempli par main.js à l'init)
export const app = {};
