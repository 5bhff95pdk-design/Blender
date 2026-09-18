// ---------- UI : menus, outliner, panneaux, shading, gizmo, vues ----------

import * as THREE from 'three';
import {
  scene, camera, orthoCam, activeCamera, setActiveCamera,
  orbit, transform, grid, axes, cursorGroup, app, envTexture,
} from './ctx.js';
import { State, select } from './state.js';
import { computeStats, updateSelectionVisuals, centerOrigin } from './objects.js';
import { undo, redo, canUndo, canRedo, isRestoring } from './persistence.js';
import * as edit from './editMode.js';
import * as sculpt from './sculpt.js';

const $ = (id) => document.getElementById(id);

// ---------- Toast ----------
export function showToast(msg, duration = 2500) {
  if (isRestoring()) return;
  const toast = $('toast');
  toast.textContent = msg;
  toast.classList.add('visible');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.remove('visible'), duration);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Mode ----------
export function setMode(mode) {
  if (State.mode === 'EDIT') edit.exitEditMode();
  if (State.mode === 'SCULPT') sculpt.exitSculptMode();

  let effective = mode;
  if (mode === 'EDIT') {
    if (State.selected?.isMesh) edit.enterEditMode(State.selected);
    else { showToast('Sélectionnez un mesh d\'abord'); effective = 'OBJECT'; }
  }
  if (mode === 'SCULPT') {
    if (State.selected?.isMesh) sculpt.enterSculptMode(State.selected);
    else { showToast('Sélectionnez un mesh pour sculpter'); effective = 'OBJECT'; }
  }
  State.mode = effective;
  document.body.className = `mode-${effective.toLowerCase()}`;
  $('modeSelect').value = effective;
  refreshEditTabs();
  if (mode === effective) showToast(`Mode : ${effective}`);
}

// ---------- Shading ----------
export function setShade(shade) {
  State.shade = shade;
  document.querySelectorAll('.shade-btn').forEach((b) => b.classList.toggle('active', b.dataset.shade === shade));

  State.objects.forEach((o) => {
    if (!o.isMesh) return;
    o.material.wireframe = shade === 'wireframe';
  });

  // environnement studio pour Material Preview / Rendered
  scene.environment = (shade === 'material' || shade === 'rendered') ? envTexture() : null;
  scene.background = new THREE.Color(shade === 'rendered' ? '#0a0a0e' : '#1a1a1e');
  $('worldColor').value = shade === 'rendered' ? '#0a0a0e' : '#1a1a1e';
  updateViewInfo();
}

// ---------- Vues ----------
const viewTween = { active: false, t: 0, from: new THREE.Vector3(), to: new THREE.Vector3(), dur: 0.35 };

export function setView(name) {
  const dirs = {
    front: [0, 0, 1], back: [0, 0, -1],
    right: [1, 0, 0], left: [-1, 0, 0],
    top: [0.0001, 1, 0.0001], bottom: [0.0001, -1, 0.0001],
  };
  const d = dirs[name];
  if (!d) return;
  const cam = activeCamera();
  const dist = cam.position.distanceTo(orbit.target);
  viewTween.active = true;
  viewTween.t = 0;
  viewTween.from.copy(cam.position);
  viewTween.to.copy(orbit.target).addScaledVector(new THREE.Vector3(...d), dist);
}

export function focusSelection() {
  if (State.selection.size === 0) return;
  const c = new THREE.Vector3();
  State.selection.forEach((o) => c.add(o.position));
  c.divideScalar(State.selection.size);
  orbit.target.copy(c);
  orbit.update();
  updateViewInfo();
}

export function toggleOrtho() {
  const persp = activeCamera().isPerspectiveCamera;
  if (persp) {
    const dist = camera.position.distanceTo(orbit.target);
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist;
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    orthoCam.left = -halfH * aspect; orthoCam.right = halfH * aspect;
    orthoCam.top = halfH; orthoCam.bottom = -halfH;
    orthoCam.position.copy(camera.position);
    orthoCam.quaternion.copy(camera.quaternion);
    orthoCam.updateProjectionMatrix();
    setActiveCamera(orthoCam);
    orbit.object = orthoCam;
    transform.camera = orthoCam;
    State.ortho = true;
  } else {
    setActiveCamera(camera);
    orbit.object = camera;
    transform.camera = camera;
    State.ortho = false;
  }
  $('orthoBtn').classList.toggle('active', State.ortho);
  updateViewInfo();
}

export function toggleXray() {
  State.xray = !State.xray;
  $('xrayBtn').classList.toggle('active', State.xray);
  State.objects.forEach((o) => {
    if (!o.isMesh) return;
    o.material.transparent = State.xray;
    o.material.opacity = State.xray ? 0.5 : 1;
    o.material.depthWrite = !State.xray;
  });
}

function shadeSmooth() {
  const m = State.selected;
  if (!m?.isMesh) return;
  m.geometry.computeVertexNormals();
  m.material.flatShading = false;
  m.material.needsUpdate = true;
  app.pushHistory?.('Ombrage lissé');
  showToast('Ombrage lissé');
}

function shadeFlat() {
  const m = State.selected;
  if (!m?.isMesh) return;
  m.material.flatShading = true;
  m.material.needsUpdate = true;
  app.pushHistory?.('Ombrage plat');
  showToast('Ombrage plat');
}

// ---------- Menus (Fichier / Édition / Objet / Vue) ----------
const MENUS = {
  file: [
    { label: 'Nouvelle scène', action: () => app.newScene() },
    { label: 'Ouvrir…', action: () => app.openSceneFile() },
    { label: 'Sauvegarder la scène', shortcut: 'Ctrl+S', action: () => app.saveSceneFile() },
    { label: 'Exporter GLTF', action: () => app.exportGltf() },
  ],
  edit: [
    { label: 'Annuler', shortcut: 'Ctrl+Z', action: undo, enabled: canUndo },
    { label: 'Rétablir', shortcut: 'Ctrl+Shift+Z', action: redo, enabled: canRedo },
    null,
    { label: 'Dupliquer', shortcut: 'Shift+D', action: () => app.duplicateSelected() },
    { label: 'Supprimer', shortcut: 'X', action: () => app.deleteSelected() },
  ],
  object: [
    { label: 'Centrer origine', action: () => State.selected?.isMesh && centerOrigin(State.selected) },
    { label: 'Ombrage lissé', action: shadeSmooth },
    { label: 'Ombrage plat', action: shadeFlat },
    null,
    { label: 'Vue sur sélection', shortcut: 'F', action: focusSelection },
  ],
  view: [
    { label: 'Face', shortcut: '1', action: () => setView('front') },
    { label: 'Droite', shortcut: '3', action: () => setView('right') },
    { label: 'Dessus', shortcut: '7', action: () => setView('top') },
    null,
    { label: 'Perspective / Ortho', shortcut: '5', action: toggleOrtho },
    { label: 'X-Ray', shortcut: 'Alt+Z', action: toggleXray },
    { label: 'Wireframe', shortcut: 'Z', action: () => setShade(State.shade === 'wireframe' ? 'solid' : 'wireframe') },
  ],
};

function setupMenus() {
  document.querySelectorAll('.menu-btn').forEach((btn) => {
    const key = btn.dataset.menu;
    if (!key || !MENUS[key]) return;
    const dd = document.createElement('div');
    dd.className = 'menu-dropdown';
    MENUS[key].forEach((item) => {
      if (!item) {
        dd.appendChild(Object.assign(document.createElement('hr'), { className: 'menu-sep' }));
        return;
      }
      const el = document.createElement('button');
      el.className = 'menu-item';
      el._def = item;
      el.innerHTML = `<span>${escapeHtml(item.label)}</span>${item.shortcut ? `<kbd>${item.shortcut}</kbd>` : ''}`;
      el.addEventListener('click', () => {
        if (el.classList.contains('disabled')) return;
        closeMenus();
        item.action?.();
      });
      dd.appendChild(el);
    });
    btn.parentElement.classList.add('menu-wrap');
    btn.parentElement.appendChild(dd);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = dd.classList.contains('visible');
      closeMenus();
      if (!isOpen) {
        // grise les actions indisponibles (ex: Annuler si pile vide)
        dd.querySelectorAll('.menu-item').forEach((el) => {
          el.classList.toggle('disabled', el._def?.enabled ? !el._def.enabled() : false);
        });
        dd.classList.add('visible');
      }
    });
  });
  document.addEventListener('click', closeMenus);
}

function closeMenus() {
  document.querySelectorAll('.menu-dropdown').forEach((d) => d.classList.remove('visible'));
}

// ---------- Outliner ----------
function updateOutliner() {
  const list = $('outlinerList');
  list.innerHTML = State.objects.map((obj) => {
    const icon = obj.isMesh ? '◫' : obj.isLight ? '☀' : '◎';
    const sel = State.selection.has(obj) ? 'selected' : '';
    const vis = obj.visible ? '👁' : '–';
    return `<div class="outliner-item ${sel}" data-id="${obj.userData.id}">
      <span class="oi-icon">${icon}</span>
      <span class="oi-name">${escapeHtml(obj.name)}</span>
      <button class="oi-vis" data-id="${obj.userData.id}" title="Visibilité">${vis}</button>
    </div>`;
  }).join('');

  list.querySelectorAll('.outliner-item').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('oi-vis')) return;
      const obj = State.objects.find((o) => o.userData.id === el.dataset.id);
      if (!obj) return;
      if (State.mode !== 'OBJECT') setMode('OBJECT');
      select(obj, { additive: e.shiftKey || e.ctrlKey });
      updateSelectionVisuals();
    });
  });
  list.querySelectorAll('.oi-vis').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const obj = State.objects.find((o) => o.userData.id === btn.dataset.id);
      if (!obj) return;
      obj.visible = !obj.visible;
      btn.textContent = obj.visible ? '👁' : '–';
      app.updateStats?.();
    });
  });
}

// ---------- Historique ----------
function updateHistoryUI() {
  $('historyList').innerHTML = State.history
    .map((h) => `<div class="history-item">${escapeHtml(h.time)} — ${escapeHtml(h.action)}</div>`)
    .join('');
}

// ---------- Stats ----------
export function updateStats() {
  const s = computeStats();
  $('stats').textContent = `Verts: ${s.verts} | Tris: ${s.tris} | Objets: ${s.objects}`;
}

// ---------- Modificateurs ----------
const MOD_LABELS = {
  subsurf: 'Subdivision', mirror: 'Miroir', array: 'Réseau',
  solidify: 'Solidify', bevel: 'Bevel (approx.)',
};

function updateModifiersUI() {
  const list = $('modifierList');
  const mesh = State.selected;
  if (!mesh?.isMesh || !mesh.userData.modifiers || mesh.userData.modifiers.length === 0) {
    list.innerHTML = '<div style="color:var(--text-dim);font-size:11px;padding:8px;">Aucun modificateur</div>';
    return;
  }
  list.innerHTML = mesh.userData.modifiers.map((m, i) => `
    <div class="mat-item" data-index="${i}">
      <span class="oi-icon">🔧</span>
      <span style="flex:1;font-size:12px;">${escapeHtml(MOD_LABELS[m.type] ?? m.type)}</span>
      <button class="small-btn mod-remove" data-index="${i}" title="Retirer">✕</button>
    </div>`).join('');
  list.querySelectorAll('.mod-remove').forEach((btn) => {
    btn.addEventListener('click', () => app.removeModifier?.(Number(btn.dataset.index)));
  });
}

// ---------- Panneau Propriétés ----------
function refreshProperties() {
  const obj = State.selected;
  if (!obj) return;
  $('objName').value = obj.name;
  if (obj.isMesh) {
    $('posX').value = obj.position.x.toFixed(2); $('posY').value = obj.position.y.toFixed(2); $('posZ').value = obj.position.z.toFixed(2);
    $('rotX').value = THREE.MathUtils.radToDeg(obj.rotation.x).toFixed(0);
    $('rotY').value = THREE.MathUtils.radToDeg(obj.rotation.y).toFixed(0);
    $('rotZ').value = THREE.MathUtils.radToDeg(obj.rotation.z).toFixed(0);
    $('scaleX').value = obj.scale.x.toFixed(2); $('scaleY').value = obj.scale.y.toFixed(2); $('scaleZ').value = obj.scale.z.toFixed(2);
    if (obj.userData.materialProps) {
      $('baseColor').value = obj.userData.materialProps.color;
      $('metallic').value = obj.userData.materialProps.metallic;
      $('roughness').value = obj.userData.materialProps.roughness;
      $('emissiveColor').value = obj.userData.materialProps.emissive;
      $('metalVal').textContent = obj.userData.materialProps.metallic;
      $('roughVal').textContent = obj.userData.materialProps.roughness;
    }
    $('visViewport').checked = obj.visible;
    updateMaterialList();
  }
}

function updateMaterialList() {
  const list = $('materialList');
  const m = State.selected;
  if (!m?.isMesh) { list.innerHTML = ''; return; }
  const color = `#${m.material.color.getHexString()}`;
  list.innerHTML = `<div class="mat-item active"><div class="mat-preview" style="background:${color}"></div><span style="flex:1;font-size:12px;">${escapeHtml(m.name)}_Mat</span></div>`;
}

function updateViewInfo() {
  const proj = State.ortho ? 'Ortho' : 'Persp';
  const shadeFr = { solid: 'Solide', wireframe: 'Fil de fer', material: 'Matériau', rendered: 'Rendu' }[State.shade];
  const selName = State.selection.size === 0 ? '' : State.selection.size === 1 ? State.selected?.name : `${State.selection.size} objets`;
  $('viewInfo').textContent = `${proj} | ${shadeFr}${selName ? ' | ' + selName : ''}`;
}

// ---------- Rafraîchissement global ----------
export function refreshUI() {
  updateOutliner();
  updateHistoryUI();
  updateModifiersUI();
  refreshProperties();
  updateStats();
  updateViewInfo();
}

// ---------- Onglets mode Édition (vertex / face) ----------
export function refreshEditTabs() {
  const tabs = $('editTabs');
  if (!tabs) return;
  tabs.classList.toggle('visible', State.mode === 'EDIT');
  tabs.querySelectorAll('.etab-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.emode === State.edit.selectionMode);
  });
}

// ---------- Gizmo de navigation (coin) ----------
const AXIS_DEFS = [
  { dir: [1, 0, 0], label: 'X', color: '#ff5a5a', filled: true },
  { dir: [-1, 0, 0], label: 'X', color: '#ff5a5a', filled: false },
  { dir: [0, 1, 0], label: 'Y', color: '#7ee24b', filled: true },
  { dir: [0, -1, 0], label: 'Y', color: '#7ee24b', filled: false },
  { dir: [0, 0, 1], label: 'Z', color: '#4b9dff', filled: true },
  { dir: [0, 0, -1], label: 'Z', color: '#4b9dff', filled: false },
];
const VIEW_BY_INDEX = ['right', 'left', 'top', 'bottom', 'front', 'back'];
const gizmoDots = [];
const _q = new THREE.Quaternion();
const _gv = new THREE.Vector3();

function setupGizmo() {
  const corner = $('gizmoCorner');
  if (!corner) return;
  AXIS_DEFS.forEach((def, i) => {
    const dot = document.createElement('button');
    dot.className = `gizmo-dot ${def.filled ? 'filled' : 'hollow'}`;
    dot.textContent = def.label;
    dot.style.color = def.color;
    dot.style.borderColor = def.color;
    dot.addEventListener('click', () => setView(VIEW_BY_INDEX[i]));
    corner.appendChild(dot);
    gizmoDots.push(dot);
  });
}

function updateGizmo() {
  if (gizmoDots.length === 0) return;
  const corner = $('gizmoCorner');
  const rect = corner.getBoundingClientRect();
  const cx = rect.width / 2, cy = rect.height / 2;
  const radius = Math.min(cx, cy) - 12;
  _q.copy(activeCamera().quaternion).invert();
  AXIS_DEFS.forEach((def, i) => {
    _gv.set(...def.dir).applyQuaternion(_q);
    const x = cx + _gv.x * radius;
    const y = cy - _gv.y * radius;
    gizmoDots[i].style.transform = `translate(${x - 11}px, ${y - 11}px)`;
    gizmoDots[i].style.zIndex = String(100 + Math.round(_gv.z * 50));
    gizmoDots[i].style.opacity = _gv.z < -0.9 ? '0' : '1';
  });
}

// ---------- Boucle UI ----------
export function updateFrame(dt) {
  // tween de vue caméra
  if (viewTween.active) {
    viewTween.t = Math.min(1, viewTween.t + dt / viewTween.dur);
    const k = viewTween.t * viewTween.t * (3 - 2 * viewTween.t); // smoothstep
    activeCamera().position.lerpVectors(viewTween.from, viewTween.to, k);
    if (viewTween.t >= 1) viewTween.active = false;
  }
  updateGizmo();

  // HUD de transformation
  if (transform.dragging) {
    $('transformHud').classList.add('visible');
    const t = transform.object;
    if (t) {
      $('hudX').value = t.position.x.toFixed(2);
      $('hudY').value = t.position.y.toFixed(2);
      $('hudZ').value = t.position.z.toFixed(2);
    }
  } else {
    $('transformHud').classList.remove('visible');
  }
}

// ---------- Setup ----------
export function setupUI() {
  setupMenus();
  setupGizmo();

  // Mode
  $('modeSelect').addEventListener('change', (e) => setMode(e.target.value));

  // Onglets édition
  $('editTabs')?.querySelectorAll('.etab-btn').forEach((b) => {
    b.addEventListener('click', () => edit.setSelectionMode(b.dataset.emode));
  });

  // Shading
  document.querySelectorAll('.shade-btn').forEach((btn) => {
    btn.addEventListener('click', () => setShade(btn.dataset.shade));
  });

  // Outils
  document.querySelectorAll('.tool-btn').forEach((btn) => {
    btn.addEventListener('click', () => app.setTool?.(btn.dataset.tool));
  });

  // Menu Ajouter
  const addPopup = $('addPopup');
  $('addBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    addPopup.classList.toggle('visible');
  });
  document.addEventListener('click', () => addPopup.classList.remove('visible'));
  addPopup.addEventListener('click', (e) => e.stopPropagation());
  addPopup.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      const type = b.dataset.add;
      if (type.startsWith('light-')) app.addLight?.(type);
      else if (type === 'camera') app.addCamera?.();
      else app.addPrimitive?.(type);
      addPopup.classList.remove('visible');
    });
  });

  // Nom + transformations
  $('objName').addEventListener('change', (e) => {
    if (State.selected) { State.selected.name = e.target.value || State.selected.name; refreshUI(); }
  });
  ['posX', 'posY', 'posZ'].forEach((id, i) => {
    $(id).addEventListener('input', (e) => {
      if (State.selected) State.selected.position.setComponent(i, parseFloat(e.target.value) || 0);
    });
  });
  ['rotX', 'rotY', 'rotZ'].forEach((id, i) => {
    $(id).addEventListener('input', (e) => {
      if (State.selected) State.selected.rotation[['x', 'y', 'z'][i]] = THREE.MathUtils.degToRad(parseFloat(e.target.value) || 0);
    });
  });
  ['scaleX', 'scaleY', 'scaleZ'].forEach((id, i) => {
    $(id).addEventListener('input', (e) => {
      if (State.selected) State.selected.scale.setComponent(i, parseFloat(e.target.value) || 1);
    });
  });

  // Visibilité
  $('visViewport').addEventListener('change', (e) => { if (State.selected) State.selected.visible = e.target.checked; });

  // Matériau
  $('baseColor').addEventListener('input', (e) => {
    const m = State.selected;
    if (m?.isMesh) {
      m.material.color.set(e.target.value);
      m.userData.materialProps.color = e.target.value;
      updateMaterialList();
    }
  });
  $('metallic').addEventListener('input', (e) => {
    const m = State.selected;
    if (m?.isMesh) {
      m.material.metalness = parseFloat(e.target.value);
      m.userData.materialProps.metallic = parseFloat(e.target.value);
      $('metalVal').textContent = e.target.value;
    }
  });
  $('roughness').addEventListener('input', (e) => {
    const m = State.selected;
    if (m?.isMesh) {
      m.material.roughness = parseFloat(e.target.value);
      m.userData.materialProps.roughness = parseFloat(e.target.value);
      $('roughVal').textContent = e.target.value;
    }
  });
  $('emissiveColor').addEventListener('input', (e) => {
    const m = State.selected;
    if (m?.isMesh) {
      m.material.emissive.set(e.target.value);
      m.userData.materialProps.emissive = e.target.value;
    }
  });
  $('newMatBtn').addEventListener('click', () => {
    const m = State.selected;
    if (!m?.isMesh) return;
    // hex valide garanti (6 caractères)
    const hex = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
    m.material.color.set(hex);
    m.userData.materialProps.color = hex;
    refreshProperties();
    updateMaterialList();
    app.pushHistory?.('Nouveau matériau');
    showToast('Nouveau matériau');
  });

  // Actions
  $('deleteBtn').addEventListener('click', () => app.deleteSelected?.());
  $('duplicateBtn').addEventListener('click', () => app.duplicateSelected?.());
  $('centerBtn').addEventListener('click', () => State.selected?.isMesh && centerOrigin(State.selected));

  // Modificateurs
  document.querySelectorAll('.mod-btn').forEach((btn) => {
    btn.addEventListener('click', () => app.applyModifier?.(btn.dataset.mod));
  });

  // Monde
  $('worldColor').addEventListener('input', (e) => { scene.background = new THREE.Color(e.target.value); });
  $('worldIntensity').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    State.objects.forEach((o) => { if (o.isMesh) o.material.envMapIntensity = v; });
  });
  $('showGrid').addEventListener('change', (e) => { grid.visible = e.target.checked; });
  $('showAxes').addEventListener('change', (e) => { axes.visible = e.target.checked; });
  $('showShadows').addEventListener('change', (e) => {
    app.setShadows?.(e.target.checked);
  });

  // Vue
  $('focusBtn').addEventListener('click', focusSelection);
  $('orthoBtn').addEventListener('click', toggleOrtho);
  $('xrayBtn').addEventListener('click', toggleXray);

  // Rendu / export
  $('renderBtn').addEventListener('click', () => app.openRender?.());
  $('closeRenderBtn').addEventListener('click', () => app.closeRender?.());
  $('saveRenderBtn').addEventListener('click', () => app.saveRenderImage?.());
  $('exportGltfBtn').addEventListener('click', () => app.exportGltf?.());
  $('saveBtn').addEventListener('click', () => app.saveSceneFile?.());

  // Barre du bas (outils pas encore implémentés : honnête)
  $('snapBtn')?.addEventListener('click', () => { State.snap = !State.snap; $('snapBtn').classList.toggle('active', State.snap); showToast(State.snap ? 'Snapping activé (à venir)' : 'Snapping désactivé'); });
  $('propBtn')?.addEventListener('click', () => showToast('Édition proportionnelle : à venir'));
  $('pivotSelect')?.addEventListener('change', () => showToast('Pivot avancé : à venir'));

  // Panneau droit
  $('toggleRightBtn').addEventListener('click', () => $('rightPanel').classList.toggle('visible'));

  // Onglets du panneau
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.panel-section').forEach((s) => s.classList.remove('active'));
      btn.classList.add('active');
      $(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  // Nav mobile
  document.querySelectorAll('.mnav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mnav-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.mtab;
      const sheet = $('mobileSheetTools');
      if (tab === 'tools') {
        sheet.classList.toggle('visible');
        const gridEl = $('mobileToolsGrid');
        gridEl.innerHTML = $('leftToolbar').innerHTML;
        gridEl.querySelectorAll('.tool-btn').forEach((b) => {
          b.addEventListener('click', () => {
            app.setTool?.(b.dataset.tool);
            sheet.classList.remove('visible');
          });
        });
      } else {
        sheet.classList.remove('visible');
        if (tab === 'add') addPopup.classList.add('visible');
        else if (tab === 'props') $('rightPanel').classList.add('visible');
        else if (tab === 'render') app.openRender?.();
        else $('rightPanel').classList.remove('visible');
      }
    });
  });

  // Menu contextuel
  const ctxMenu = $('contextMenu');
  ctxMenu.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      const action = b.dataset.action;
      if (action === 'delete') app.deleteSelected?.();
      if (action === 'duplicate') app.duplicateSelected?.();
      if (action === 'hide' && State.selected) { State.selected.visible = false; refreshUI(); }
      if (action === 'focus') focusSelection();
      if (action === 'shade-smooth') shadeSmooth();
      if (action === 'shade-flat') shadeFlat();
      ctxMenu.classList.remove('visible');
    });
  });

  // Curseur 3D visible dans les modes Monde
  cursorGroup.visible = true;
}
