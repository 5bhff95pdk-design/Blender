// ---------- Mode Édition ----------
// Points soudés par position (InstancedMesh : 1 draw call), sélection
// vertex OU face, drag sans déchirure, extrusion et inset RÉELLES
// (nouvelles faces + parois latérales).

import * as THREE from 'three';
import { scene, app } from './ctx.js';
import { State } from './state.js';
import {
  positionGroups, ensureIndexed,
  extrudeFaces, insetFaces, bevelApprox,
} from './geometry.js';

let editMesh = null;
let helpers = null;        // Group (matrix = mesh.matrixWorld)
let points = null;         // InstancedMesh des points soudés
let edgesOverlay = null;   // LineSegments (cage d'arêtes)
let faceOverlay = null;    // LineSegments (faces sélectionnées)
let pg = null;             // positionGroups courant
let dirty = false;         // la géométrie a été modifiée

const POINT_COLOR = new THREE.Color(0xffffff);
const SELECT_COLOR = new THREE.Color(0xeb7700);
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();

export function editTarget() { return editMesh; }
export function isDirty() { return dirty; }
export function helpersGroup() { return helpers; }

// ---------- Entrée / Sortie ----------
export function enterEditMode(mesh) {
  if (!mesh || !mesh.isMesh) return;
  editMesh = mesh;
  dirty = false;
  ensureIndexed(mesh.geometry);
  rebuildHelpers();
  app.showToast?.(`Mode Édition : ${pg.count} sommets soudés`);
}

export function exitEditMode() {
  if (helpers) {
    scene.remove(helpers);
    disposeHelpers();
    helpers = null;
    points = null;
    edgesOverlay = null;
    faceOverlay = null;
  }
  const mesh = editMesh;
  editMesh = null;
  pg = null;
  State.edit.selectedGroups.clear();
  State.edit.selectedFaces.clear();
  if (mesh) {
    mesh.geometry.computeVertexNormals();
    const outline = mesh.getObjectByName('outline');
    if (outline) {
      outline.geometry.dispose();
      outline.geometry = new THREE.EdgesGeometry(mesh.geometry, 15);
    }
    if (dirty) {
      // la géométrie éditée devient la nouvelle base (pile de modificateurs réinitialisée)
      // NB : chaque opération (drag, extrusion, inset, bevel) a déjà poussé son
      // propre snapshot d'undo — pas de snapshot redondant ici.
      mesh.userData.baseGeometry = mesh.geometry.clone();
      mesh.userData.modifiers = [];
      app.updateStats?.();
    }
  }
}

function disposeHelpers() {
  if (points) { points.geometry.dispose(); points.material.dispose(); points.dispose(); }
  if (edgesOverlay) { edgesOverlay.geometry.dispose(); edgesOverlay.material.dispose(); }
  if (faceOverlay) { faceOverlay.geometry.dispose(); faceOverlay.material.dispose(); }
}

// Reconstruit les helpers après un changement de topologie.
function rebuildHelpers() {
  if (helpers) {
    scene.remove(helpers);
    disposeHelpers();
  }
  pg = positionGroups(editMesh.geometry);
  editMesh.updateMatrixWorld();
  helpers = new THREE.Group();
  helpers.matrixAutoUpdate = false;
  helpers.matrix.copy(editMesh.matrixWorld);

  // Points soudés (1 instance par groupe de position)
  const sphere = new THREE.SphereGeometry(0.045, 8, 6);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  mat.depthTest = false; // toujours visible comme dans Blender
  points = new THREE.InstancedMesh(sphere, mat, pg.count);
  points.renderOrder = 999;
  for (let g = 0; g < pg.count; g++) {
    const vi = pg.groups[g][0];
    const p = editMesh.geometry.attributes.position;
    _m.makeTranslation(p.getX(vi), p.getY(vi), p.getZ(vi));
    points.setMatrixAt(g, _m);
    points.setColorAt(g, POINT_COLOR);
  }
  helpers.add(points);

  // Cage d'arêtes (espace local)
  const edgesGeo = new THREE.EdgesGeometry(editMesh.geometry, 1);
  edgesOverlay = new THREE.LineSegments(edgesGeo, new THREE.LineBasicMaterial({ color: 0x2a2a2e, transparent: true, opacity: 0.85 }));
  helpers.add(edgesOverlay);

  faceOverlay = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xeb7700, depthTest: false, transparent: true })
  );
  faceOverlay.renderOrder = 998;
  helpers.add(faceOverlay);

  scene.add(helpers);
  buildGroupKeyMap();
  updateSelectionVisuals();
}

// ---------- Sélection ----------
export function updateSelectionVisuals() {
  if (!points || !pg) return;
  const sel = State.edit.selectionMode === 'vertex'
    ? State.edit.selectedGroups
    : groupsOfSelectedFaces();
  for (let g = 0; g < pg.count; g++) {
    points.setColorAt(g, sel.has(g) ? SELECT_COLOR : POINT_COLOR);
  }
  if (points.instanceColor) points.instanceColor.needsUpdate = true;
  updateFaceOverlay();
}

function groupsOfSelectedFaces() {
  const out = new Set();
  if (!editMesh?.geometry?.index) return out;
  const idx = editMesh.geometry.index.array;
  State.edit.selectedFaces.forEach((t) => {
    for (let e = 0; e < 3; e++) out.add(pg.groupOf[idx[t * 3 + e]]);
  });
  return out;
}

function updateFaceOverlay() {
  if (!faceOverlay) return;
  const verts = [];
  const idx = editMesh?.geometry?.index?.array;
  const pos = editMesh?.geometry?.attributes?.position;
  if (idx && pos) {
    const done = new Set();
    State.edit.selectedFaces.forEach((t) => {
      for (let e = 0; e < 3; e++) {
        const a = idx[t * 3 + e], b = idx[t * 3 + ((e + 1) % 3)];
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        if (done.has(key)) continue;
        done.add(key);
        verts.push(pos.getX(a), pos.getY(a), pos.getZ(a), pos.getX(b), pos.getY(b), pos.getZ(b));
      }
    });
  }
  faceOverlay.geometry.dispose();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  faceOverlay.geometry = geo;
}

export function setSelectionMode(mode) {
  State.edit.selectionMode = mode;
  if (mode === 'vertex') State.edit.selectedFaces.clear();
  else State.edit.selectedGroups.clear();
  updateSelectionVisuals();
  app.refreshEditTabs?.();
}

export function selectedGroupsCount() {
  return State.edit.selectionMode === 'vertex'
    ? State.edit.selectedGroups.size
    : groupsOfSelectedFaces().size;
}

// ---------- Picking ----------
// Retournent le hit complet (point + instanceId/faceIndex) pour le drag.
export function pickGroup(raycaster) {
  if (!points) return null;
  const hits = raycaster.intersectObject(points, false);
  return hits.length > 0 ? hits[0] : null;
}

export function pickFace(raycaster) {
  if (!editMesh) return null;
  const hits = raycaster.intersectObject(editMesh, false);
  return hits.length > 0 ? hits[0] : null;
}

export function toggleGroup(g, additive) {
  const set = State.edit.selectedGroups;
  if (!additive) set.clear();
  if (additive && set.has(g)) set.delete(g);
  else set.add(g);
  updateSelectionVisuals();
}

export function toggleFace(f, additive) {
  const set = State.edit.selectedFaces;
  if (!additive) set.clear();
  if (additive && set.has(f)) set.delete(f);
  else set.add(f);
  updateSelectionVisuals();
}

export function selectAll(select = true) {
  if (State.edit.selectionMode === 'vertex') {
    State.edit.selectedGroups.clear();
    if (select && pg) for (let g = 0; g < pg.count; g++) State.edit.selectedGroups.add(g);
  } else {
    State.edit.selectedFaces.clear();
    if (select && editMesh?.geometry?.index) {
      for (let t = 0; t < editMesh.geometry.index.count / 3; t++) State.edit.selectedFaces.add(t);
    }
  }
  updateSelectionVisuals();
}

// ---------- Drag ----------
// Déplace les groupes sélectionnés sur un plan face caméra.
// Retourne un handler onMove(worldPoint) / onEnd().
export function beginDrag(worldPoint) {
  if (!editMesh || !pg) return null;
  const sel = State.edit.selectionMode === 'vertex'
    ? [...State.edit.selectedGroups]
    : [...groupsOfSelectedFaces()];
  if (sel.length === 0) return null;

  const inv = new THREE.Matrix4().copy(editMesh.matrixWorld).invert();
  const startLocal = worldPoint.clone().applyMatrix4(inv);
  const startPositions = new Map(); // group -> Vector3 locale
  for (const g of sel) {
    const vi = pg.groups[g][0];
    startPositions.set(g, new THREE.Vector3().fromBufferAttribute(editMesh.geometry.attributes.position, vi));
  }

  dirty = true;
  const pos = editMesh.geometry.attributes.position;
  let moved = false;

  return {
    move(worldPoint2) {
      const local = worldPoint2.clone().applyMatrix4(inv);
      const delta = local.clone().sub(startLocal);
      if (delta.lengthSq() < 1e-12) return;
      moved = true;
      for (const g of sel) {
        const target = startPositions.get(g).clone().add(delta);
        for (const vi of pg.groups[g]) pos.setXYZ(vi, target.x, target.y, target.z);
        _m.makeTranslation(target.x, target.y, target.z);
        points.setMatrixAt(g, _m);
      }
      pos.needsUpdate = true;
      points.instanceMatrix.needsUpdate = true;
    },
    end() {
      // reconstruit la cage d'arêtes (positions modifiées)
      edgesOverlay.geometry.dispose();
      edgesOverlay.geometry = new THREE.EdgesGeometry(editMesh.geometry, 1);
      updateFaceOverlay();
      app.updateStats?.();
      if (moved) app.pushHistory?.('Déplacement sommets'); // un drag = un pas d'undo
    },
  };
}

// ---------- Extrusion réelle ----------
export function extrudeSelection() {
  if (!editMesh) return;
  let faces = State.edit.selectedFaces;
  if (faces.size === 0 && State.edit.selectedGroups.size > 0) {
    // extruder les faces entièrement couvertes par les sommets sélectionnés
    faces = facesFromGroups();
  }
  if (faces.size === 0) {
    app.showToast?.('Extrusion : sélectionnez des faces (mode Face) ou des sommets');
    return;
  }

  // direction : normale moyenne des faces sélectionnées (espace local)
  const geo = editMesh.geometry;
  const idx = geo.index.array;
  const pos = geo.attributes.position;
  const n = new THREE.Vector3();
  faces.forEach((t) => {
    const a = new THREE.Vector3().fromBufferAttribute(pos, idx[t * 3]);
    const b = new THREE.Vector3().fromBufferAttribute(pos, idx[t * 3 + 1]);
    const c = new THREE.Vector3().fromBufferAttribute(pos, idx[t * 3 + 2]);
    n.add(new THREE.Vector3().subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)));
  });
  n.normalize();

  const { geometry: newGeo, newVertOfGroup } = extrudeFaces(geo, faces, n.multiplyScalar(0.4));
  swapGeometry(newGeo);

  // sélectionne les nouveaux sommets "haut" pour un drag immédiat
  State.edit.selectedFaces.clear();
  State.edit.selectedGroups.clear();
  newVertOfGroup.forEach((vi, g) => {
    _v.fromBufferAttribute(newGeo.attributes.position, vi);
    State.edit.selectedGroups.add(groupAtPosition(_v));
  });
  State.edit.selectionMode = 'vertex';
  app.refreshEditTabs?.();
  updateSelectionVisuals();
  app.pushHistory?.('Extrusion');
  app.showToast?.(`Extrusion : ${faces.size} face(s) — déplacez les sommets`);
}

// ---------- Inset réel ----------
export function insetSelection() {
  if (!editMesh) return;
  const faces = State.edit.selectedFaces;
  if (faces.size === 0) {
    app.showToast?.('Inset : sélectionnez des faces (mode Face)');
    return;
  }
  const { geometry: newGeo, newVertOfGroup } = insetFaces(editMesh.geometry, faces, 0.7);
  swapGeometry(newGeo);

  State.edit.selectedFaces.clear();
  State.edit.selectedGroups.clear();
  newVertOfGroup.forEach((vi) => {
    _v.fromBufferAttribute(newGeo.attributes.position, vi);
    State.edit.selectedGroups.add(groupAtPosition(_v));
  });
  State.edit.selectionMode = 'vertex';
  app.refreshEditTabs?.();
  updateSelectionVisuals();
  app.pushHistory?.('Inset');
  app.showToast?.('Inset appliqué');
}

// ---------- Bevel (outil édition) ----------
export function bevelSelection() {
  if (!editMesh) return;
  const newGeo = bevelApprox(editMesh.geometry, { levels: 2, smooth: 0.4, iterations: 2 });
  swapGeometry(newGeo);
  State.edit.selectedGroups.clear();
  State.edit.selectedFaces.clear();
  updateSelectionVisuals();
  app.pushHistory?.('Bevel');
  app.showToast?.('Bevel (approx.) appliqué');
}

function facesFromGroups() {
  const out = new Set();
  const idx = editMesh.geometry.index.array;
  for (let t = 0; t < idx.length / 3; t++) {
    let all = true;
    for (let e = 0; e < 3; e++) {
      if (!State.edit.selectedGroups.has(pg.groupOf[idx[t * 3 + e]])) { all = false; break; }
    }
    if (all) out.add(t);
  }
  return out;
}

function groupAtPosition(v) {
  const key = `${Math.round(v.x * 1e5)},${Math.round(v.y * 1e5)},${Math.round(v.z * 1e5)}`;
  const g = groupKeyMap.get(key);
  return g ?? -1;
}

let groupKeyMap = new Map();
function buildGroupKeyMap() {
  groupKeyMap = new Map();
  const pos = editMesh.geometry.attributes.position;
  for (let g = 0; g < pg.count; g++) {
    const vi = pg.groups[g][0];
    groupKeyMap.set(`${Math.round(pos.getX(vi) * 1e5)},${Math.round(pos.getY(vi) * 1e5)},${Math.round(pos.getZ(vi) * 1e5)}`, g);
  }
}

function swapGeometry(newGeo) {
  editMesh.geometry.dispose();
  editMesh.geometry = newGeo;
  dirty = true;
  rebuildHelpers(); // recalcule pg, points, arêtes
  app.updateStats?.();
}
