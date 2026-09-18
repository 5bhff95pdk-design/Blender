// ---------- Interactions : pointer, tactile, clavier, outils ----------
// 1 doigt = sélection (tap) / orbite (drag) · 2 doigts = zoom/pan (OrbitControls,
// plus de double-zoom) · long press = menu contextuel.

import * as THREE from 'three';
import {
  scene, renderer, orbit, transform, pivot, cursorGroup, app, activeCamera,
} from './ctx.js';
import { State, select } from './state.js';
import { updateSelectionVisuals } from './objects.js';
import * as edit from './editMode.js';
import * as sculpt from './sculpt.js';

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const dom = renderer.domElement;

let editDrag = null;        // handler de drag du mode Édition
let editDragStart = null;   // point monde de départ du drag
let measureState = null;    // { a: Vector3, marker, line } pour l'outil Mesure
let longPressTimer = null;
let startPos = null;
let isDragging = false;

function setMouseFromEvent(e) {
  const rect = dom.getBoundingClientRect();
  const cx = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
  const cy = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
  mouse.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(mouse, activeCamera());
}

function getIntersects() {
  const meshes = State.objects.filter((o) => o.isMesh);
  return raycaster.intersectObjects(meshes, false);
}

// ---------- Outils ----------
export function setTool(tool) {
  State.tool = tool;

  if (['move', 'rotate', 'scale'].includes(tool)) {
    transform.setMode(tool === 'move' ? 'translate' : tool);
    transform.enabled = true;
    if (State.selection.size > 0) updateSelectionVisuals(); // rattache (objet ou pivot)
  } else if (tool === 'select') {
    transform.enabled = false;
    transform.detach();
  } else if (tool.startsWith('sculpt-')) {
    State.sculpt.brush = tool.replace('sculpt-', '');
    if (State.mode !== 'SCULPT' && State.selected?.isMesh) app.setMode?.('SCULPT');
    app.showToast?.(`Pinceau : ${State.sculpt.brush}`);
  } else if (tool === 'extrude') {
    if (State.mode === 'EDIT') edit.extrudeSelection();
    else app.showToast?.('Extrusion : passez en Mode Édition');
  } else if (tool === 'inset') {
    if (State.mode === 'EDIT') edit.insetSelection();
    else app.showToast?.('Inset : passez en Mode Édition (mode Face)');
  } else if (tool === 'bevel') {
    if (State.mode === 'EDIT') edit.bevelSelection();
    else app.showToast?.('Bevel : passez en Mode Édition');
  } else if (tool === 'cursor') {
    app.showToast?.('Curseur 3D : touchez un point');
  } else if (tool === 'measure') {
    clearMeasure();
    app.showToast?.('Mesure : touchez deux points');
  } else if (tool === 'loopcut') {
    app.showToast?.('Loop Cut : à venir');
    return; // garde l'outil précédent actif
  }

  document.querySelectorAll('.tool-btn').forEach((b) => {
    if (b.dataset.tool === tool) b.classList.add('active');
    else if (tool.startsWith('sculpt-') && b.dataset.tool === `sculpt-${State.sculpt.brush}`) b.classList.add('active');
    else b.classList.remove('active');
  });
}

// ---------- Mesure ----------
function clearMeasure() {
  if (measureState) {
    scene.remove(measureState.marker, measureState.line);
    measureState.marker.geometry.dispose(); measureState.marker.material.dispose();
    measureState.line.geometry.dispose(); measureState.line.material.dispose();
    measureState = null;
  }
}

function measureClick(hitPoint) {
  if (!measureState) {
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.03, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xeb7700 })
    );
    marker.position.copy(hitPoint);
    scene.add(marker);
    measureState = { a: hitPoint.clone(), marker, line: null };
  } else {
    const { a } = measureState;
    const dist = a.distanceTo(hitPoint);
    const geo = new THREE.BufferGeometry().setFromPoints([a, hitPoint]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xeb7700 }));
    scene.add(line);
    measureState.marker.position.copy(hitPoint);
    measureState.line = line;
    app.pushHistory?.('Mesure');
    app.showToast?.(`Distance : ${dist.toFixed(3)} u`, 4000);
  }
}

// ---------- Pivot multi-sélection ----------
const prevPivotMatrix = new THREE.Matrix4();

function onObjectChange() {
  if (transform.object !== pivot || State.selection.size === 0) return;
  pivot.updateMatrix();
  const delta = new THREE.Matrix4().multiplyMatrices(pivot.matrix, prevPivotMatrix.clone().invert());
  State.selection.forEach((obj) => {
    if (obj === pivot) return;
    obj.updateMatrix();
    const m = new THREE.Matrix4().multiplyMatrices(delta, obj.matrix);
    m.decompose(obj.position, obj.quaternion, obj.scale);
  });
  prevPivotMatrix.copy(pivot.matrix);
}

function onDraggingChanged(e) {
  orbit.enabled = !e.value;
  if (e.value) {
    if (transform.object === pivot) {
      pivot.updateMatrix();
      prevPivotMatrix.copy(pivot.matrix);
    }
  } else {
    app.pushHistory?.('Transformation');
    updateSelectionVisuals(); // recalcule le pivot au centroïde
    app.refreshUI?.();
  }
}

// ---------- Pointer ----------
function setupPointer() {
  dom.addEventListener('pointerdown', (e) => {
    isDragging = false;
    startPos = { x: e.clientX, y: e.clientY };
    setMouseFromEvent(e);

    // Sculpture
    if (State.mode === 'SCULPT' && sculpt.sculptTarget()) {
      const hits = getIntersects();
      if (hits.length > 0 && hits[0].object === sculpt.sculptTarget()) {
        sculpt.beginStroke();
        sculpt.sculptAt(hits[0].point, hits[0].face.normal);
      }
      orbit.enabled = false;
      return;
    }

    // Mode Édition
    if (State.mode === 'EDIT' && edit.editTarget()) {
      if (State.edit.selectionMode === 'vertex') {
        const hit = edit.pickGroup(raycaster);
        if (hit) {
          edit.toggleGroup(hit.instanceId, e.shiftKey);
          orbit.enabled = false;
          editDragStart = hit.point.clone();
          editDrag = edit.beginDrag(editDragStart);
          return;
        }
      } else {
        const hit = edit.pickFace(raycaster);
        if (hit) {
          edit.toggleFace(hit.faceIndex, e.shiftKey);
          orbit.enabled = false;
          editDragStart = hit.point.clone();
          editDrag = edit.beginDrag(editDragStart);
          return;
        }
      }
    }

    // Outils points (curseur 3D, mesure)
    if (State.tool === 'cursor' || State.tool === 'measure') {
      const hits = getIntersects();
      if (hits.length > 0) {
        if (State.tool === 'cursor') {
          cursorGroup.position.copy(hits[0].point);
          app.showToast?.(`Curseur 3D : ${hits[0].point.x.toFixed(2)}, ${hits[0].point.y.toFixed(2)}, ${hits[0].point.z.toFixed(2)}`);
        } else {
          measureClick(hits[0].point);
        }
      }
      return;
    }

    // Sélection objet : long press = menu contextuel (mobile)
    if (State.mode === 'OBJECT' && State.tool === 'select') {
      longPressTimer = setTimeout(() => {
        setMouseFromEvent(e);
        const hits = getIntersects();
        if (hits.length > 0) {
          select(hits[0].object);
          updateSelectionVisuals();
          const ctxMenu = document.getElementById('contextMenu');
          ctxMenu.style.left = `${Math.min(e.clientX, window.innerWidth - 180)}px`;
          ctxMenu.style.top = `${Math.min(e.clientY, window.innerHeight - 220)}px`;
          ctxMenu.classList.add('visible');
        }
      }, 550);
    }
  });

  dom.addEventListener('pointermove', (e) => {
    if (startPos) {
      const dist = Math.hypot(e.clientX - startPos.x, e.clientY - startPos.y);
      if (dist > 5) isDragging = true;
      if (dist > 10 && longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    }

    if (sculpt.strokeActive() && State.mode === 'SCULPT') {
      setMouseFromEvent(e);
      const hits = getIntersects();
      if (hits.length > 0 && hits[0].object === sculpt.sculptTarget()) {
        sculpt.sculptAt(hits[0].point, hits[0].face.normal);
      }
      return;
    }

    if (editDrag) {
      setMouseFromEvent(e);
      // intersection avec le plan de drag (face caméra, passe par l'origine du rayon)
      const camDir = new THREE.Vector3();
      activeCamera().getWorldDirection(camDir);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir.negate(), raycaster.ray.origin);
      const hit = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(plane, hit)) editDrag.move(hit);
    }
  });

  dom.addEventListener('pointerup', (e) => {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }

    if (sculpt.strokeActive()) {
      sculpt.endStroke();
      orbit.enabled = true;
      return;
    }

    if (editDrag) {
      editDrag.end();
      editDrag = null;
      orbit.enabled = true;
      return;
    }

    if (!isDragging && State.mode === 'OBJECT' && State.tool === 'select' && !transform.dragging) {
      setMouseFromEvent(e);
      const hits = getIntersects();
      if (hits.length > 0) {
        select(hits[0].object, { additive: e.shiftKey || e.ctrlKey });
      } else if (!e.shiftKey && !e.ctrlKey) {
        // clic vide : désélectionne
        State.selection.clear();
        State.selected = null;
      }
      updateSelectionVisuals();
    }

    isDragging = false;
    startPos = null;
  });
}

// ---------- Clavier ----------
function setupKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

    const k = e.key.toLowerCase();

    // Undo / Redo
    if ((e.ctrlKey || e.metaKey) && k === 'z') {
      e.preventDefault();
      if (e.shiftKey) app.redo?.(); else app.undo?.();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); app.redo?.(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); app.saveSceneFile?.(); return; }

    // Outils
    if (k === 'w') app.setTool?.('select');
    if (k === 'g') app.setTool?.('move');
    if (k === 'r') app.setTool?.('rotate');
    if (k === 's' && !e.ctrlKey && !e.metaKey) app.setTool?.('scale');
    if (k === 'e' && State.mode === 'EDIT') edit.extrudeSelection();
    if (k === 'i' && State.mode === 'EDIT') edit.insetSelection();
    if (k === 'b' && State.mode === 'EDIT') edit.bevelSelection();

    // Actions
    if (k === 'x' || k === 'delete') app.deleteSelected?.();
    if (k === 'd' && e.shiftKey) { e.preventDefault(); app.duplicateSelected?.(); }
    if (k === 'a' && e.shiftKey) { e.preventDefault(); document.getElementById('addPopup').classList.add('visible'); }
    if (k === 'a' && e.ctrlKey) {
      e.preventDefault();
      if (State.mode === 'EDIT') edit.selectAll(true);
      else { State.selection.clear(); State.objects.forEach((o) => State.selection.add(o)); State.selected = State.objects[State.objects.length - 1] ?? null; updateSelectionVisuals(); }
    }
    if (k === 'f') app.focusSelection?.();
    if (k === 'z' && e.altKey) { e.preventDefault(); app.toggleXray?.(); }
    else if (k === 'z' && !e.ctrlKey && !e.metaKey) {
      app.setShade?.(State.shade === 'wireframe' ? 'solid' : 'wireframe');
    }

    if (k === 'tab') {
      e.preventDefault();
      app.setMode?.(State.mode === 'EDIT' ? 'OBJECT' : 'EDIT');
    }

    // Vues (comme Numpad)
    if (k === '1') { if (State.mode === 'EDIT') edit.setSelectionMode('vertex'); else app.setView?.('front'); }
    if (k === '3') { if (State.mode === 'EDIT') edit.setSelectionMode('face'); else app.setView?.('right'); }
    if (k === '7') app.setView?.('top');
    if (k === '5') app.toggleOrtho?.();
  });
}

// ---------- Context menu (clic droit desktop) ----------
function setupContextMenu() {
  dom.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    setMouseFromEvent(e);
    const hits = getIntersects();
    if (hits.length > 0) {
      select(hits[0].object);
      updateSelectionVisuals();
      const ctxMenu = document.getElementById('contextMenu');
      ctxMenu.style.left = `${Math.min(e.clientX, window.innerWidth - 180)}px`;
      ctxMenu.style.top = `${Math.min(e.clientY, window.innerHeight - 220)}px`;
      ctxMenu.classList.add('visible');
    }
  });
  document.addEventListener('click', () => document.getElementById('contextMenu').classList.remove('visible'));
}

export function setupInteraction() {
  setupPointer();
  setupKeyboard();
  setupContextMenu();

  transform.addEventListener('dragging-changed', onDraggingChanged);
  transform.addEventListener('objectChange', onObjectChange);
}
