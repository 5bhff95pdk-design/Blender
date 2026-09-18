// ---------- Blender Mobile — point d'entrée ----------
// Assemble les modules, enregistre les services partagés (ctx.app) et
// lance la boucle d'animation.

import * as THREE from 'three';
import './style.css';
import {
  scene, renderer, camera, orbit, cursorGroup, lights, app, activeCamera,
} from './ctx.js';
import { State, select } from './state.js';
import * as objects from './objects.js';
import * as persistence from './persistence.js';
import * as editMode from './editMode.js';
import * as sculpt from './sculpt.js';
import * as ui from './ui.js';
import * as renderExport from './renderExport.js';
import * as interact from './interact.js';

// ---------- Registre de services ----------
Object.assign(app, {
  // objects
  addPrimitive: objects.addPrimitive,
  addLight: objects.addLight,
  addCamera: objects.addCamera,
  applyModifier: objects.applyModifier,
  removeModifier: objects.removeModifier,
  deleteSelected: objects.deleteSelected,
  duplicateSelected: objects.duplicateSelected,
  updateSelectionVisuals: objects.updateSelectionVisuals,
  updateStats: ui.updateStats,
  // persistence
  pushHistory: persistence.pushHistory,
  undo: persistence.undo,
  redo: persistence.redo,
  saveSceneFile: persistence.saveSceneFile,
  openSceneFile: openSceneFile,
  newScene: persistence.newScene,
  // modes / édition
  setMode: ui.setMode,
  setTool: interact.setTool,
  editHelpers: editMode.helpersGroup,
  // ui / vues
  refreshUI: ui.refreshUI,
  refreshEditTabs: ui.refreshEditTabs,
  setShade: ui.setShade,
  setView: ui.setView,
  focusSelection: ui.focusSelection,
  toggleOrtho: ui.toggleOrtho,
  toggleXray: ui.toggleXray,
  setShadows,
  showToast: ui.showToast,
  // rendu / export
  openRender: renderExport.openRender,
  closeRender: renderExport.closeRender,
  saveRenderImage: renderExport.saveRenderImage,
  exportGltf: renderExport.exportGltf,
});

function setShadows(enabled) {
  lights.key.castShadow = enabled;
  State.objects.forEach((o) => { if (o.isLight) o.castShadow = enabled; });
  renderer.shadowMap.needsUpdate = true;
  ui.showToast?.(enabled ? 'Ombres activées' : 'Ombres désactivées');
}

// ---------- Ouverture de fichier (input caché) ----------
function openSceneFile() {
  let input = document.getElementById('sceneFileInput');
  if (!input) {
    input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.id = 'sceneFileInput';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      if (input.files?.[0]) persistence.loadSceneFile(input.files[0]);
      input.value = '';
    });
  }
  input.click();
}

// ---------- Resize ----------
function onResize() {
  const wrap = document.getElementById('viewportWrap');
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener('resize', onResize);

// ---------- Boucle d'animation ----------
let lastTime = 0;
let frameCount = 0;
let lastFpsTime = 0;

function animate(time) {
  requestAnimationFrame(animate);
  const dt = Math.min(100, time - lastTime) / 1000;
  lastTime = time;

  frameCount++;
  if (time - lastFpsTime > 1000) {
    document.getElementById('fpsCounter').textContent = `${frameCount} fps`;
    frameCount = 0;
    lastFpsTime = time;
  }

  orbit.update();
  cursorGroup.rotation.y += 0.005;

  ui.updateFrame(dt);
  renderer.render(scene, activeCamera());
}

// ---------- Init ----------
function init() {
  ui.setupUI();
  interact.setupInteraction();

  // Scène par défaut : cube comme Blender
  const cube = objects.addPrimitive('cube');
  cube.position.set(0, 0.8, 0);
  select(cube);
  objects.updateSelectionVisuals();

  persistence.resetHistory();
  persistence.pushHistory('Démarrage');

  onResize();
  animate(0);
  ui.refreshUI();

  // indices tactiles : disparaissent après 5 s
  setTimeout(() => {
    const hints = document.getElementById('touchHints');
    if (hints) hints.style.opacity = '0';
  }, 5000);

  ui.showToast('Blender Mobile prêt — touchez un objet, 2 doigts pour orbiter/zoomer', 3500);

  // PWA
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    ui.showToast?.('Installez Blender Mobile sur votre écran d\'accueil 📲');
  });
}

init();

// Debug / tests
window.BlenderMobile = {
  scene, camera: activeCamera, renderer, State, app,
  objects, persistence, editMode, sculpt, ui, interact, renderExport,
};
