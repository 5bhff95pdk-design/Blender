// ---------- Objets : factories, sélection, modificateurs ----------
// Toutes les opérations sur les objets de la scène (ajout, suppression,
// duplication, modificateurs, matériaux).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene, transform, pivot, app } from './ctx.js';
import { State, select, clearSelection } from './state.js';
import { subsurf, bevelApprox, solidify, ensureIndexed } from './geometry.js';

let objCounter = 0;
function makeObjectName(type) {
  objCounter++;
  return `${type}_${String(objCounter).padStart(3, '0')}`;
}

// ---------- Matériaux ----------
export function createBlenderMaterial(color = '#ff8a2a', metallic = 0.1, roughness = 0.5) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    metalness: metallic,
    roughness: roughness,
    envMapIntensity: 0.8,
  });
}

function applyShadingToObject(obj) {
  if (!obj.isMesh) return;
  obj.material.wireframe = State.shade === 'wireframe';
  obj.material.transparent = State.xray;
  obj.material.opacity = State.xray ? 0.5 : 1;
  obj.material.depthWrite = !State.xray;
}

// ---------- Factory ----------
export function addMesh(geometry, name, color, { selectIt = true } = {}) {
  geometry.computeVertexNormals();
  const mat = createBlenderMaterial(color);
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = name;
  mesh.userData = {
    id: THREE.MathUtils.generateUUID(),
    type: 'MESH',
    baseGeometry: geometry.clone(),
    modifiers: [],
    materialProps: { color, metallic: 0.1, roughness: 0.5, emissive: '#000000' },
  };
  // Contour de sélection (toggle via visible, pas opacity : évite les draw calls)
  const edges = new THREE.EdgesGeometry(geometry, 15);
  const outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xeb7700 }));
  outline.name = 'outline';
  outline.visible = false;
  mesh.add(outline);

  mesh.position.set((Math.random() - 0.5) * 0.5, 0.8 + Math.random() * 0.3, (Math.random() - 0.5) * 0.5);
  applyShadingToObject(mesh);

  scene.add(mesh);
  State.objects.push(mesh);
  if (selectIt) select(mesh);
  app.refreshUI?.();
  return mesh;
}

export function addPrimitive(type) {
  let geo, name, color;
  const palette = ['#ff8a2a', '#4a90d9', '#6abf4b', '#d94a9a', '#ffd23d', '#8a6bff'];
  color = palette[Math.floor(Math.random() * palette.length)];

  switch (type) {
    case 'cube': geo = new THREE.BoxGeometry(1, 1, 1); name = makeObjectName('Cube'); break;
    case 'sphere': geo = new THREE.SphereGeometry(0.6, 32, 32); name = makeObjectName('Sphere'); break;
    case 'ico': geo = new THREE.IcosahedronGeometry(0.6, 2); name = makeObjectName('IcoSphere'); break;
    case 'cylinder': geo = new THREE.CylinderGeometry(0.5, 0.5, 1.2, 32); name = makeObjectName('Cylinder'); break;
    case 'plane': geo = new THREE.PlaneGeometry(2, 2, 4, 4); name = makeObjectName('Plane'); break;
    case 'torus': geo = new THREE.TorusGeometry(0.5, 0.2, 16, 48); name = makeObjectName('Torus'); break;
    case 'cone': geo = new THREE.ConeGeometry(0.6, 1.2, 32); name = makeObjectName('Cone'); break;
    case 'monkey': {
      // Suzanne approximative (icosaèdre déformé)
      geo = new THREE.IcosahedronGeometry(0.6, 2);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        pos.setXYZ(i, x * 1.1, y * 1.2 + (x > 0 ? 0.1 : 0), z * 0.9);
      }
      pos.needsUpdate = true;
      name = makeObjectName('Suzanne');
      color = '#ff8a2a';
      break;
    }
    default: geo = new THREE.BoxGeometry(1, 1, 1); name = makeObjectName('Cube');
  }
  const mesh = addMesh(geo, name, color);
  app.pushHistory?.(`Ajout ${name}`);
  app.showToast?.(`Ajouté : ${name}`);
  return mesh;
}

export function addLight(type) {
  let light;
  const name = makeObjectName(type.replace('light-', '').charAt(0).toUpperCase() + type.replace('light-', '').slice(1));
  if (type === 'light-point') {
    light = new THREE.PointLight(0xffffff, 2, 10);
    light.position.set(2, 3, 2);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffffaa }));
    sphere.name = 'lightGizmo';
    light.add(sphere);
  } else if (type === 'light-sun') {
    light = new THREE.DirectionalLight(0xffffff, 1.5);
    light.position.set(3, 5, 2);
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
  } else if (type === 'light-spot') {
    light = new THREE.SpotLight(0xffffff, 3, 15, Math.PI / 6, 0.3);
    light.position.set(2, 4, 2);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
  }
  light.name = name;
  light.userData = { id: THREE.MathUtils.generateUUID(), type: 'LIGHT', lightType: type };
  scene.add(light);
  State.objects.push(light);
  select(light);
  app.pushHistory?.(`Ajout ${name}`);
  app.refreshUI?.();
  app.showToast?.(`Lumière ajoutée : ${name}`);
  return light;
}

export function addCamera() {
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  cam.position.set(4, 3, 4);
  cam.lookAt(0, 0.8, 0);
  cam.name = makeObjectName('Camera');
  cam.userData = { id: THREE.MathUtils.generateUUID(), type: 'CAMERA' };
  const helperGeo = new THREE.ConeGeometry(0.15, 0.3, 4);
  helperGeo.rotateX(Math.PI);
  const helper = new THREE.Mesh(helperGeo, new THREE.MeshBasicMaterial({ color: 0xdddddd, wireframe: true }));
  helper.name = 'camGizmo';
  cam.add(helper);
  scene.add(cam);
  State.objects.push(cam);
  select(cam);
  app.pushHistory?.(`Ajout ${cam.name}`);
  app.refreshUI?.();
  return cam;
}

// Mesh reconstruit depuis une sauvegarde (persistence.js)
export function makeMeshFromData(data) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(data.geometry.position, 3));
  if (data.geometry.normal) geo.setAttribute('normal', new THREE.Float32BufferAttribute(data.geometry.normal, 3));
  if (data.geometry.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(data.geometry.uv, 2));
  if (data.geometry.index) geo.setIndex(data.geometry.index);
  const mesh = addMesh(geo, data.name, data.material.color, { selectIt: false });
  mesh.position.fromArray(data.position);
  mesh.rotation.fromArray(data.rotation);
  mesh.scale.fromArray(data.scale);
  mesh.visible = data.visible ?? true;
  mesh.userData.id = data.id;
  mesh.userData.modifiers = data.modifiers?.map((m) => ({ ...m })) ?? [];
  const mp = data.material;
  mesh.material.metalness = mp.metallic;
  mesh.material.roughness = mp.roughness;
  mesh.material.emissive.set(mp.emissive);
  mesh.userData.materialProps = { ...mp };
  applyShadingToObject(mesh);
  return mesh;
}

// ---------- Sélection (multi) ----------
export function updateSelectionVisuals() {
  State.objects.forEach((o) => {
    const outline = o.isMesh ? o.getObjectByName('outline') : null;
    if (outline) outline.visible = State.selection.has(o);
  });
  const sel = [...State.selection];
  // le gizmo ne s'affiche que pour les outils de transformation
  if (sel.length > 0 && transform.enabled) {
    if (sel.length === 1) {
      transform.attach(sel[0]);
    } else {
      const centroid = new THREE.Vector3();
      sel.forEach((o) => centroid.add(o.position));
      centroid.divideScalar(sel.length);
      pivot.position.copy(centroid);
      pivot.quaternion.identity();
      pivot.scale.set(1, 1, 1);
      transform.attach(pivot);
    }
  } else {
    transform.detach();
  }
  app.refreshUI?.();
}

export function deleteSelected() {
  if (State.selection.size === 0) return;
  // sortir d'abord des modes dépendants de la sélection
  if (State.mode !== 'OBJECT') app.setMode?.('OBJECT');
  let n = 0;
  [...State.selection].forEach((obj) => {
    const idx = State.objects.indexOf(obj);
    if (idx >= 0) State.objects.splice(idx, 1);
    scene.remove(obj);
    if (obj.isMesh) {
      obj.geometry.dispose();
      obj.material.dispose();
      const outline = obj.getObjectByName('outline');
      if (outline) { outline.geometry.dispose(); outline.material.dispose(); }
    }
    n++;
  });
  clearSelection();
  transform.detach();
  app.pushHistory?.('Suppression');
  app.refreshUI?.();
  app.showToast?.(n > 1 ? `${n} objets supprimés` : 'Objet supprimé');
}

export function duplicateSelected() {
  const meshes = [...State.selection].filter((o) => o.isMesh);
  if (meshes.length === 0) { app.showToast?.('Sélectionnez un mesh'); return; }
  if (State.mode !== 'OBJECT') app.setMode?.('OBJECT');
  const clones = [];
  meshes.forEach((src) => {
    const clone = src.clone();
    clone.geometry = src.geometry.clone();
    clone.material = src.material.clone();
    const outline = clone.getObjectByName('outline');
    if (outline) {
      outline.geometry = src.getObjectByName('outline').geometry.clone();
      outline.material = outline.material.clone();
      outline.visible = false;
    }
    clone.position.x += 0.5;
    clone.name = makeObjectName(src.name.split('_')[0]);
    // userData cloné proprement (baseGeometry reste une vraie géométrie)
    clone.userData = {
      id: THREE.MathUtils.generateUUID(),
      type: 'MESH',
      baseGeometry: src.userData.baseGeometry.clone(),
      modifiers: src.userData.modifiers.map((m) => ({ ...m, params: { ...m.params } })),
      materialProps: { ...src.userData.materialProps },
    };
    scene.add(clone);
    State.objects.push(clone);
    clones.push(clone);
  });
  select(clones[clones.length - 1]);
  State.selection.clear();
  clones.forEach((c) => State.selection.add(c));
  State.selected = clones[clones.length - 1];
  app.pushHistory?.('Duplication');
  updateSelectionVisuals();
  app.showToast?.(clones.length > 1 ? `${clones.length} objets dupliqués` : 'Objet dupliqué');
}

// ---------- Modificateurs ----------
// Reconstruit la géométrie depuis baseGeometry + pile de modificateurs.
function rebuildFromStack(mesh) {
  let geo = mesh.userData.baseGeometry.clone();
  for (const mod of mesh.userData.modifiers) {
    const next = applyModifierOp(geo, mod);
    if (next) geo = next;
  }
  mesh.geometry.dispose();
  mesh.geometry = geo;
  const outline = mesh.getObjectByName('outline');
  if (outline) {
    outline.geometry.dispose();
    outline.geometry = new THREE.EdgesGeometry(geo, 15);
  }
  mesh.geometry.computeVertexNormals();
}

function applyModifierOp(geo, mod) {
  switch (mod.type) {
    case 'subsurf': return subsurf(geo, mod.params?.levels ?? 1);
    case 'mirror': {
      ensureIndexed(geo);
      const mirrored = geo.clone();
      mirrored.applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
      // inverser le winding pour garder les normales vers l'extérieur
      const idx = mirrored.index.array;
      for (let t = 0; t < idx.length; t += 3) {
        const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp;
      }
      mirrored.computeVertexNormals();
      return mergeGeometries([geo, mirrored]);
    }
    case 'array': {
      ensureIndexed(geo);
      const count = mod.params?.count ?? 3;
      const spacing = mod.params?.spacing ?? 1.2;
      const geos = [];
      for (let i = 0; i < count; i++) {
        const g = geo.clone();
        g.translate(i * spacing, 0, 0);
        geos.push(g);
      }
      return mergeGeometries(geos);
    }
    case 'solidify': {
      ensureIndexed(geo);
      return solidify(geo, mod.params?.thickness ?? 0.05);
    }
    case 'bevel': return bevelApprox(geo, { levels: mod.params?.levels ?? 2 });
    default: return null;
  }
}

export function applyModifier(type, params = {}) {
  const mesh = State.selected;
  if (!mesh || !mesh.isMesh) { app.showToast?.('Sélectionnez un mesh'); return; }
  if (State.mode !== 'OBJECT') app.setMode?.('OBJECT');
  mesh.userData.modifiers.push({ type, params });
  rebuildFromStack(mesh);
  app.pushHistory?.(`Modificateur ${type}`);
  app.refreshUI?.();
  app.updateStats?.();
  const labels = { subsurf: 'Subdivision', mirror: 'Miroir', array: 'Réseau', solidify: 'Solidify', bevel: 'Bevel (approx.)' };
  app.showToast?.(`${labels[type] ?? type} appliqué`);
}

export function removeModifier(index) {
  const mesh = State.selected;
  if (!mesh || !mesh.isMesh || !mesh.userData.modifiers) return;
  mesh.userData.modifiers.splice(index, 1);
  rebuildFromStack(mesh);
  app.pushHistory?.('Modificateur retiré');
  app.refreshUI?.();
  app.updateStats?.();
}

// Cuit la géométrie actuelle comme nouvelle base (après édition/sculpture) :
// la pile de modificateurs repart de zéro.
export function bakeGeometry(mesh) {
  mesh.userData.baseGeometry = mesh.geometry.clone();
  mesh.userData.modifiers = [];
}

export function centerOrigin(mesh) {
  if (!mesh || !mesh.isMesh) return;
  mesh.geometry.center();
  const outline = mesh.getObjectByName('outline');
  if (outline) {
    outline.geometry.dispose();
    outline.geometry = new THREE.EdgesGeometry(mesh.geometry, 15);
  }
  bakeGeometry(mesh);
  app.pushHistory?.('Origine centrée');
  app.showToast?.('Origine centrée');
}

// Stats corrigées (plus d'accumulation croisée)
export function computeStats() {
  let verts = 0, tris = 0;
  State.objects.forEach((o) => {
    if (o.isMesh && o.geometry) {
      const pos = o.geometry.attributes.position;
      if (pos) verts += pos.count;
      if (o.geometry.index) tris += o.geometry.index.count / 3;
      else if (pos) tris += pos.count / 3;
    }
  });
  return { verts: Math.floor(verts), tris: Math.floor(tris), objects: State.objects.length };
}
