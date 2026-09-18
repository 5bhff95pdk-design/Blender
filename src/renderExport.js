// ---------- Rendu & Export ----------
// Rendu "final" : un SEUL renderer hors-écran persistant (fin de la fuite
// de contextes WebGL), scène nettoyée (grille/axes/gizmo/curseur cachés).
// Export GLTF : uniquement les objets utilisateur (meshes + lumières).

import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import {
  scene, activeCamera,
  grid, axes, cursorGroup, transformHelper, app, envTexture,
} from './ctx.js';
import { State } from './state.js';

const RENDER_W = 1920;
const RENDER_H = 1080;

let rRenderer = null; // créé une fois, réutilisé

function renderRenderer() {
  if (!rRenderer) {
    const rCanvas = document.getElementById('renderCanvas');
    rCanvas.width = RENDER_W;
    rCanvas.height = RENDER_H;
    rRenderer = new THREE.WebGLRenderer({ canvas: rCanvas, antialias: true, preserveDrawingBuffer: true });
    rRenderer.setSize(RENDER_W, RENDER_H, false);
    rRenderer.shadowMap.enabled = true;
    rRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    rRenderer.toneMappingExposure = 1.2;
    rRenderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  return rRenderer;
}

export function openRender() {
  document.getElementById('renderOverlay').classList.add('visible');

  const r = renderRenderer();
  // rendu depuis la caméra ACTIVE (persp ou ortho)
  const active = activeCamera();
  const cam = active.clone();
  const renderAspect = RENDER_W / RENDER_H;
  if (cam.isPerspectiveCamera) {
    cam.aspect = renderAspect;
  } else {
    const curAspect = (cam.right - cam.left) / (cam.top - cam.bottom);
    const factor = renderAspect / curAspect;
    cam.left *= factor; cam.right *= factor;
  }
  cam.updateProjectionMatrix();

  // overlays masqués pour le rendu final (le sol capteur d'ombres est conservé)
  const prevVisible = new Map();
  const hide = (obj) => { if (obj) { prevVisible.set(obj, obj.visible); obj.visible = false; } };
  [grid, axes, cursorGroup, transformHelper].forEach(hide);
  State.objects.forEach((o) => {
    if (o.isMesh) hide(o.getObjectByName('outline'));
  });
  const helpersGroup = app.editHelpers?.();
  hide(helpersGroup);

  // éclairage d'environnement pour un rendu plus riche
  const hadEnv = scene.environment;
  if (State.shade === 'material' || State.shade === 'rendered') scene.environment = envTexture();
  const prevBg = scene.background.clone();
  if (State.shade === 'rendered') scene.background = new THREE.Color('#0a0a0e');

  r.render(scene, cam);

  // restauration
  scene.environment = hadEnv;
  scene.background = prevBg;
  prevVisible.forEach((v, obj) => { obj.visible = v; });

  const meshCount = State.objects.filter((o) => o.isMesh).length;
  let tris = 0;
  State.objects.forEach((o) => {
    if (o.isMesh && o.geometry?.index) tris += o.geometry.index.count / 3;
  });
  document.getElementById('renderInfo').textContent =
    `${RENDER_W}x${RENDER_H} | ${meshCount} mesh(es) | ${Math.floor(tris)} tris | WebGL + ACES`;
  app.showToast?.('Rendu terminé');
}

export function closeRender() {
  document.getElementById('renderOverlay').classList.remove('visible');
}

export function saveRenderImage() {
  const link = document.createElement('a');
  link.download = 'blender-mobile-render.png';
  link.href = document.getElementById('renderCanvas').toDataURL('image/png');
  link.click();
  app.showToast?.('Image sauvegardée');
}

export function exportGltf() {
  // uniquement les objets utilisateur ; les outlines sont ignorés (onlyVisible)
  const outlines = [];
  State.objects.forEach((o) => {
    if (o.isMesh) {
      const outline = o.getObjectByName('outline');
      if (outline) { outlines.push([outline, outline.visible]); outline.visible = false; }
    }
  });
  const exportables = State.objects.filter((o) => o.isMesh || o.isLight);

  const exporter = new GLTFExporter();
  exporter.parse(
    exportables,
    (gltf) => {
      const blob = new Blob([JSON.stringify(gltf)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'blender-mobile-export.gltf';
      a.click();
      URL.revokeObjectURL(url);
      outlines.forEach(([o, v]) => { o.visible = v; });
      app.showToast?.('Export GLTF (meshes + lumières)');
    },
    (err) => {
      outlines.forEach(([o, v]) => { o.visible = v; });
      console.error(err);
      app.showToast?.('Erreur export GLTF');
    },
    { binary: false, onlyVisible: true }
  );
}

export function disposeRenderRenderer() {
  if (rRenderer) {
    rRenderer.dispose();
    rRenderer.forceContextLoss?.();
    rRenderer = null;
  }
}
