// ---------- Mode Sculpture ----------
// Brushes Draw / Inflate / Smooth / Grab qui travaillent par GROUPES de
// positions co-localisées : pas de déchirure aux coutures, et Smooth est
// un vrai lissage laplacien (moyenne des voisins topologiques).

import * as THREE from 'three';
import { app } from './ctx.js';
import { State } from './state.js';
import { positionGroups, groupAdjacency, ensureIndexed } from './geometry.js';

let sculptMesh = null;
let isSculpting = false;
let lastSculptPos = null;
let pg = null;       // groupes de positions
let adj = null;      // voisinage entre groupes
let avgScale = 1;    // pour convertir le rayon monde -> local
let dirty = false;
let strokeDirty = false;

const _v = new THREE.Vector3();

export function sculptTarget() { return sculptMesh; }

export function enterSculptMode(mesh) {
  if (!mesh || !mesh.isMesh) return;
  sculptMesh = mesh;
  ensureIndexed(mesh.geometry);
  pg = positionGroups(mesh.geometry);
  adj = groupAdjacency(mesh.geometry, pg);
  avgScale = (Math.abs(mesh.scale.x) + Math.abs(mesh.scale.y) + Math.abs(mesh.scale.z)) / 3 || 1;
  dirty = false;
  app.showToast?.(`Mode Sculpt : ${State.sculpt.brush} | Rayon ${State.sculpt.radius}`);
}

export function exitSculptMode() {
  if (sculptMesh && dirty) {
    // la géométrie sculptée devient la nouvelle base (les coups de pinceau
    // ont déjà poussé leurs snapshots d'undo individuellement)
    sculptMesh.userData.baseGeometry = sculptMesh.geometry.clone();
    sculptMesh.userData.modifiers = [];
  }
  sculptMesh = null;
  pg = null;
  adj = null;
  isSculpting = false;
  lastSculptPos = null;
}

export function beginStroke() {
  isSculpting = true;
  lastSculptPos = null;
}

export function endStroke() {
  isSculpting = false;
  lastSculptPos = null;
}

export function strokeActive() { return isSculpting; }

// point/normal : impact monde
export function sculptAt(point, normal) {
  if (!sculptMesh || !pg) return;
  const geo = sculptMesh.geometry;
  const pos = geo.attributes.position;
  const inv = new THREE.Matrix4().copy(sculptMesh.matrixWorld).invert();
  const localPoint = point.clone().applyMatrix4(inv);
  const localNormal = normal.clone().transformDirection(inv).normalize();

  const localRadius = State.sculpt.radius / avgScale;
  const radiusSq = localRadius * localRadius;
  const strength = State.sculpt.strength * 0.02;
  const brush = State.sculpt.brush;

  // positions de groupes (représentants) pour le lissage
  const groupPos = [];
  for (let g = 0; g < pg.count; g++) {
    const vi = pg.groups[g][0];
    groupPos.push(new THREE.Vector3(pos.getX(vi), pos.getY(vi), pos.getZ(vi)));
  }

  for (let g = 0; g < pg.count; g++) {
    const vert = groupPos[g];
    const distSq = vert.distanceToSquared(localPoint);
    if (distSq >= radiusSq) continue;
    const falloff = 1 - Math.sqrt(distSq) / localRadius;
    const smoothFalloff = falloff * falloff * (3 - 2 * falloff); // smoothstep

    if (brush === 'draw') {
      vert.addScaledVector(localNormal, strength * smoothFalloff * 5);
    } else if (brush === 'inflate') {
      const dir = vert.clone().sub(new THREE.Vector3(0, 0, 0));
      if (dir.lengthSq() < 1e-10) continue;
      vert.addScaledVector(dir.normalize(), strength * smoothFalloff * 3);
    } else if (brush === 'smooth') {
      // vrai laplacien : moyenne des voisins topologiques
      let sx = 0, sy = 0, sz = 0, n = 0;
      adj[g].forEach((nb) => { const p = groupPos[nb]; sx += p.x; sy += p.y; sz += p.z; n++; });
      if (n > 0) {
        vert.x += (sx / n - vert.x) * smoothFalloff * State.sculpt.strength * 0.5;
        vert.y += (sy / n - vert.y) * smoothFalloff * State.sculpt.strength * 0.5;
        vert.z += (sz / n - vert.z) * smoothFalloff * State.sculpt.strength * 0.5;
      }
    } else if (brush === 'grab') {
      if (lastSculptPos) {
        const delta = localPoint.clone().sub(lastSculptPos);
        vert.addScaledVector(delta, smoothFalloff);
      }
    }
  }

  // applique les positions de groupes à TOUS les sommets co-localisés
  for (let g = 0; g < pg.count; g++) {
    const vert = groupPos[g];
    for (const vi of pg.groups[g]) pos.setXYZ(vi, vert.x, vert.y, vert.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  lastSculptPos = localPoint.clone();
  dirty = true;
  strokeDirty = true;
}

export function markDirty() { dirty = true; strokeDirty = true; }
