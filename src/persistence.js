// ---------- Persistance : undo/redo + sauvegarde/chargement ----------
// L'undo repose sur des snapshots complets de la scène (géométries incluses).
// Format JSON compact et versionné, réutilisé pour la sauvegarde fichier.

import * as THREE from 'three';
import { scene, app } from './ctx.js';
import { State } from './state.js';
import { addLight, addCamera, makeMeshFromData } from './objects.js';

const SCENE_VERSION = 1;
const MAX_UNDO = 40;

// Pendant une restauration, les factories ne doivent ni logger l'historique
// ni afficher de toasts (sinon la pile d'undo serait corrompue).
let _restoring = false;
export function isRestoring() { return _restoring; }

// ---------- Sérialisation ----------
export function serializeScene() {
  return {
    version: SCENE_VERSION,
    world: { background: `#${scene.background.getHexString()}` },
    primaryId: State.selected?.userData?.id ?? null,
    objects: State.objects.map(serializeObject),
  };
}

function serializeObject(obj) {
  const base = {
    id: obj.userData.id,
    name: obj.name,
    visible: obj.visible,
    position: obj.position.toArray(),
    rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
    scale: obj.scale.toArray(),
  };
  if (obj.isMesh) {
    const g = obj.geometry;
    base.kind = 'mesh';
    base.material = { ...obj.userData.materialProps };
    base.modifiers = obj.userData.modifiers.map((m) => ({ type: m.type, params: { ...m.params } }));
    base.geometry = {
      position: Array.from(g.attributes.position.array),
      normal: g.attributes.normal ? Array.from(g.attributes.normal.array) : null,
      uv: g.attributes.uv ? Array.from(g.attributes.uv.array) : null,
      index: g.index ? Array.from(g.index.array) : null,
    };
  } else if (obj.isLight) {
    base.kind = 'light';
    base.lightType = obj.userData.lightType;
    base.color = `#${obj.color.getHexString()}`;
    base.intensity = obj.intensity;
    if (obj.isSpotLight) base.angle = obj.angle;
    if (obj.isPointLight || obj.isSpotLight) base.distance = obj.distance;
  } else if (obj.isCamera) {
    base.kind = 'camera';
    base.fov = obj.fov;
  }
  return base;
}

// ---------- Restauration ----------
export function restoreScene(data) {
  // sortir des modes d'édition avant de reconstruire
  if (State.mode !== 'OBJECT') app.setMode?.('OBJECT');

  _restoring = true;
  try {
    // vider la scène
    State.selection.clear();
    State.selected = null;
    [...State.objects].forEach((obj) => {
      scene.remove(obj);
      if (obj.isMesh) {
        obj.geometry.dispose();
        obj.material.dispose();
      }
    });
    State.objects.length = 0;

    if (data.world?.background) scene.background = new THREE.Color(data.world.background);

    const byId = new Map();
    for (const d of data.objects) {
      let obj = null;
      if (d.kind === 'mesh') {
        obj = makeMeshFromData(d);
      } else if (d.kind === 'light') {
        obj = rebuildLight(d);
      } else if (d.kind === 'camera') {
        obj = rebuildCamera(d);
      }
      if (obj) {
        obj.visible = d.visible ?? true;
        byId.set(d.id, obj);
      }
    }
    const primary = data.primaryId ? byId.get(data.primaryId) : null;
    if (primary) {
      State.selection.clear();
      State.selection.add(primary);
      State.selected = primary;
    }
  } finally {
    _restoring = false;
  }
  app.updateSelectionVisuals?.();
  app.refreshUI?.();
  app.updateStats?.();
}

function rebuildLight(d) {
  const obj = addLight(d.lightType);
  obj.name = d.name;
  obj.userData.id = d.id;
  obj.position.fromArray(d.position);
  obj.rotation.fromArray(d.rotation);
  obj.scale.fromArray(d.scale);
  obj.color.set(d.color);
  obj.intensity = d.intensity;
  if (obj.isSpotLight && d.angle !== undefined) obj.angle = d.angle;
  if ((obj.isPointLight || obj.isSpotLight) && d.distance !== undefined) obj.distance = d.distance;
  return obj;
}

function rebuildCamera(d) {
  const obj = addCamera();
  obj.name = d.name;
  obj.userData.id = d.id;
  obj.position.fromArray(d.position);
  obj.rotation.fromArray(d.rotation);
  obj.scale.fromArray(d.scale);
  obj.fov = d.fov;
  return obj;
}

// ---------- Undo / Redo ----------
const undoStack = [];
const redoStack = [];

export function pushHistory(action) {
  if (_restoring) return;

  // journal d'affichage
  State.history.unshift({ action, time: new Date().toLocaleTimeString() });
  if (State.history.length > 30) State.history.pop();

  undoStack.push(serializeScene());
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
  app.refreshUI?.();
}

export function undo() {
  if (undoStack.length <= 1) { app.showToast?.('Rien à annuler'); return; }
  redoStack.push(undoStack.pop());
  restoreScene(undoStack[undoStack.length - 1]);
  State.history.unshift({ action: '↩ Annulation', time: new Date().toLocaleTimeString() });
  app.refreshUI?.();
  app.showToast?.('Annulé');
}

export function redo() {
  if (redoStack.length === 0) { app.showToast?.('Rien à rétablir'); return; }
  const next = redoStack.pop();
  undoStack.push(next);
  restoreScene(next);
  State.history.unshift({ action: '↪ Rétablissement', time: new Date().toLocaleTimeString() });
  app.refreshUI?.();
  app.showToast?.('Rétabli');
}

export function canUndo() { return undoStack.length > 1; }
export function canRedo() { return redoStack.length > 0; }

// Réinitialise l'historique (nouvelle scène / chargement)
export function resetHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
  State.history.length = 0;
}

// ---------- Sauvegarde / Chargement fichier ----------
export function saveSceneFile() {
  const data = serializeScene();
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'scene.blenderm.json';
  a.click();
  URL.revokeObjectURL(url);
  app.showToast?.('Scène sauvegardée');
}

export function loadSceneFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.objects)) throw new Error('format invalide');
      restoreScene(data);
      resetHistory();
      pushHistory('Ouverture');
      app.showToast?.(`Scène chargée : ${data.objects.length} objets`);
    } catch (e) {
      app.showToast?.('Fichier de scène invalide');
      console.error(e);
    }
  };
  reader.readAsText(file);
}

export function newScene() {
  restoreScene({ version: SCENE_VERSION, world: { background: '#1a1a1e' }, objects: [] });
  app.addPrimitive?.('cube');
  resetHistory();
  pushHistory('Nouvelle scène');
  app.showToast?.('Nouvelle scène');
}
