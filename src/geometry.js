// ---------- Geometry Ops ----------
// Opérations topologiques pures (testables sous Node, sans DOM).
// Principe clé : les géométries Three.js dupliquent les sommets aux coutures
// (normales/UV). Toutes les opérations travaillent sur des GROUPES de
// positions co-localisées pour éviter de déchirer le mesh.

import * as THREE from 'three';

const R = 1e5; // arrondi pour la clé de position (précision ~1e-5)

function posKey(x, y, z) {
  return `${Math.round(x * R)},${Math.round(y * R)},${Math.round(z * R)}`;
}

// Regroupe les vertices co-localisés (même position) d'une géométrie.
export function positionGroups(geo) {
  const pos = geo.attributes.position;
  const map = new Map();
  const groupOf = new Int32Array(pos.count);
  const groups = [];
  for (let i = 0; i < pos.count; i++) {
    const k = posKey(pos.getX(i), pos.getY(i), pos.getZ(i));
    let g = map.get(k);
    if (g === undefined) {
      g = groups.length;
      map.set(k, g);
      groups.push([]);
    }
    groupOf[i] = g;
    groups[g].push(i);
  }
  return { groupOf, groups, count: groups.length };
}

// Voisinage entre groupes (triangles partagés).
export function groupAdjacency(geo, pg) {
  const idx = geo.index ? geo.index.array : null;
  const triCount = idx ? idx.length / 3 : geo.attributes.position.count / 3;
  const adj = Array.from({ length: pg.count }, () => new Set());
  const v = (t, c) => (idx ? idx[t * 3 + c] : t * 3 + c);
  for (let t = 0; t < triCount; t++) {
    const a = pg.groupOf[v(t, 0)];
    const b = pg.groupOf[v(t, 1)];
    const c = pg.groupOf[v(t, 2)];
    if (a !== b) { adj[a].add(b); adj[b].add(a); }
    if (b !== c) { adj[b].add(c); adj[c].add(b); }
    if (c !== a) { adj[c].add(a); adj[a].add(c); }
  }
  return adj;
}

// Indexe une géométrie non-indexée (index séquentiel).
export function ensureIndexed(geo) {
  if (geo.index) return geo;
  const n = geo.attributes.position.count;
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

// Lissage laplacien par groupes (préserve les coutures : tous les sommets
// co-localisés bougent ensemble). Modifie la géométrie en place.
export function smoothLaplacian(geo, factor = 0.5, iterations = 1) {
  ensureIndexed(geo);
  const pg = positionGroups(geo);
  const adj = groupAdjacency(geo, pg);
  const pos = geo.attributes.position;
  const hasUv = !!geo.attributes.uv;
  const uv = geo.attributes.uv;

  for (let it = 0; it < iterations; it++) {
    const targets = new Float32Array(pg.count * 3);
    for (let g = 0; g < pg.count; g++) {
      let sx = 0, sy = 0, sz = 0, n = 0;
      adj[g].forEach((nb) => {
        const vi = pg.groups[nb][0];
        sx += pos.getX(vi); sy += pos.getY(vi); sz += pos.getZ(vi);
        n++;
      });
      const vi = pg.groups[g][0];
      if (n > 0) {
        targets[g * 3] = sx / n; targets[g * 3 + 1] = sy / n; targets[g * 3 + 2] = sz / n;
      } else {
        targets[g * 3] = pos.getX(vi); targets[g * 3 + 1] = pos.getY(vi); targets[g * 3 + 2] = pos.getZ(vi);
      }
    }
    for (let g = 0; g < pg.count; g++) {
      const tx = targets[g * 3], ty = targets[g * 3 + 1], tz = targets[g * 3 + 2];
      for (const vi of pg.groups[g]) {
        pos.setXYZ(
          vi,
          pos.getX(vi) + (tx - pos.getX(vi)) * factor,
          pos.getY(vi) + (ty - pos.getY(vi)) * factor,
          pos.getZ(vi) + (tz - pos.getZ(vi)) * factor
        );
      }
    }
    if (hasUv) {
      // les UV suivent légèrement pour éviter les déchirures de texture
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), uv.getY(i));
    }
  }
  geo.computeVertexNormals();
  return geo;
}

// ---------- Subdivision (midpoint, approx. Loop) ----------
// Subdivise chaque triangle en 4 via les milieux d'arêtes. Les sommets
// originaux sont conservés ; les milieux sont partagés par paire d'indices.
export function subdivide(geo, levels = 1) {
  let g = ensureIndexed(geo);
  for (let lvl = 0; lvl < levels; lvl++) g = subdivideOnce(g);
  return g;
}

function subdivideOnce(geo) {
  const idx = geo.index.array;
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const triCount = idx.length / 3;

  const positions = new Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    positions[i * 3] = pos.getX(i);
    positions[i * 3 + 1] = pos.getY(i);
    positions[i * 3 + 2] = pos.getZ(i);
  }
  const uvs = uv ? new Array(uv.count * 2) : null;
  if (uv) for (let i = 0; i < uv.count; i++) { uvs[i * 2] = uv.getX(i); uvs[i * 2 + 1] = uv.getY(i); }

  const midMap = new Map();
  const mid = (i, j) => {
    const key = i < j ? `${i}_${j}` : `${j}_${i}`;
    let m = midMap.get(key);
    if (m === undefined) {
      positions.push(
        (pos.getX(i) + pos.getX(j)) / 2,
        (pos.getY(i) + pos.getY(j)) / 2,
        (pos.getZ(i) + pos.getZ(j)) / 2
      );
      if (uv) uvs.push((uv.getX(i) + uv.getX(j)) / 2, (uv.getY(i) + uv.getY(j)) / 2);
      m = positions.length / 3 - 1;
      midMap.set(key, m);
    }
    return m;
  };

  const newIdx = new Uint32Array(triCount * 12);
  let w = 0;
  for (let t = 0; t < triCount; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    newIdx[w++] = a;  newIdx[w++] = ab; newIdx[w++] = ca;
    newIdx[w++] = ab; newIdx[w++] = b;  newIdx[w++] = bc;
    newIdx[w++] = ca; newIdx[w++] = bc; newIdx[w++] = c;
    newIdx[w++] = ab; newIdx[w++] = bc; newIdx[w++] = ca;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (uvs) out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  out.setIndex(new THREE.BufferAttribute(newIdx, 1));
  out.computeVertexNormals();
  return out;
}

// ---------- Solidify ----------
// Coque avant + arrière (offset le long des normales) + parois sur les
// arêtes de bord. Les coutures du mesh d'origine sont préservées.
export function solidify(geo, thickness = 0.05) {
  ensureIndexed(geo);
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const pg = positionGroups(geo);
  const idx = geo.index.array;
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const uv = geo.attributes.uv;
  const n = pos.count;
  const triCount = idx.length / 3;

  // Copies arrière : une par groupe, normale = moyenne normalisée du groupe
  // (les sommets co-localisés d'un cube appartiennent à 3 faces différentes)
  const backPositions = new Array(pg.count * 3);
  const backNormals = new Array(pg.count * 3);
  const backUvs = uv ? new Array(pg.count * 2) : null;
  for (let g = 0; g < pg.count; g++) {
    let ax = 0, ay = 0, az = 0;
    for (const vi of pg.groups[g]) {
      ax += nrm.getX(vi); ay += nrm.getY(vi); az += nrm.getZ(vi);
    }
    const len = Math.hypot(ax, ay, az) || 1;
    ax /= len; ay /= len; az /= len;
    const vi = pg.groups[g][0];
    backPositions[g * 3] = pos.getX(vi) - ax * thickness;
    backPositions[g * 3 + 1] = pos.getY(vi) - ay * thickness;
    backPositions[g * 3 + 2] = pos.getZ(vi) - az * thickness;
    backNormals[g * 3] = -ax;
    backNormals[g * 3 + 1] = -ay;
    backNormals[g * 3 + 2] = -az;
    if (uv) { backUvs[g * 2] = uv.getX(vi); backUvs[g * 2 + 1] = uv.getY(vi); }
  }
  const backIdx = new Uint32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    const a = pg.groupOf[idx[t * 3]], b = pg.groupOf[idx[t * 3 + 1]], c = pg.groupOf[idx[t * 3 + 2]];
    // winding inversé pour la face arrière
    backIdx[t * 3] = n + a; backIdx[t * 3 + 1] = n + c; backIdx[t * 3 + 2] = n + b;
  }

  // Arêtes de bord (utilisées par un seul triangle) avec leur direction
  const edgeCount = new Map();
  const directed = new Map();
  for (let t = 0; t < triCount; t++) {
    for (let e = 0; e < 3; e++) {
      const a = idx[t * 3 + e], b = idx[t * 3 + ((e + 1) % 3)];
      const ga = pg.groupOf[a], gb = pg.groupOf[b];
      if (ga === gb) continue;
      const uk = ga < gb ? `${ga}_${gb}` : `${gb}_${ga}`;
      edgeCount.set(uk, (edgeCount.get(uk) || 0) + 1);
      const dk = `${ga}_${gb}`;
      if (!directed.has(dk)) directed.set(dk, [a, b]);
    }
  }

  // Parois : sommets dupliqués (arêtes dures)
  const wallPositions = [], wallNormals = [], wallUvs = [];
  const wallIdx = [];
  const pushWallVert = (x, y, z, nx, ny, nz, u, v) => {
    wallPositions.push(x, y, z);
    wallNormals.push(nx, ny, nz);
    if (uv) wallUvs.push(u, v);
    return n + pg.count + wallPositions.length / 3 - 1;
  };

  directed.forEach(([a, b], dk) => {
    const [ga, gb] = dk.split('_').map(Number);
    const uk = ga < gb ? `${ga}_${gb}` : `${gb}_${ga}`;
    if (edgeCount.get(uk) !== 1) return; // pas une arête de bord
    const aBack = n + ga, bBack = n + gb;
    // Points pour 2 triangles plats : (a, bBack, b) et (a, aBack, bBack)
    const p = (i) => i < n
      ? [pos.getX(i), pos.getY(i), pos.getZ(i)]
      : [backPositions[(i - n) * 3], backPositions[(i - n) * 3 + 1], backPositions[(i - n) * 3 + 2]];
    const pu = (i) => i < n
      ? [uv.getX(i), uv.getY(i)]
      : [backUvs[(i - n) * 2], backUvs[(i - n) * 2 + 1]];
    const A = p(a), B = p(b), AB = p(aBack), BB = p(bBack);
    const tri1 = [A, BB, B], tri2 = [A, AB, BB];
    const uvs1 = [pu(a), pu(bBack), pu(b)], uvs2 = [pu(a), pu(aBack), pu(bBack)];
    for (const [tri, us] of [[tri1, uvs1], [tri2, uvs2]]) {
      // normale plate
      const ux = tri[1][0] - tri[0][0], uy = tri[1][1] - tri[0][1], uz = tri[1][2] - tri[0][2];
      const vx = tri[2][0] - tri[0][0], vy = tri[2][1] - tri[0][1], vz = tri[2][2] - tri[0][2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const ids = tri.map((pt, k) => pushWallVert(pt[0], pt[1], pt[2], nx, ny, nz, us[k][0], us[k][1]));
      wallIdx.push(ids[0], ids[1], ids[2]);
    }
  });

  // Assemblage
  const out = new THREE.BufferGeometry();
  const allPos = [];
  for (let i = 0; i < n; i++) allPos.push(pos.getX(i), pos.getY(i), pos.getZ(i));
  allPos.push(...backPositions, ...wallPositions);
  out.setAttribute('position', new THREE.Float32BufferAttribute(allPos, 3));

  const allNrm = [];
  for (let i = 0; i < n; i++) allNrm.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
  allNrm.push(...backNormals, ...wallNormals);
  out.setAttribute('normal', new THREE.Float32BufferAttribute(allNrm, 3));

  if (uv) {
    const allUv = [];
    for (let i = 0; i < n; i++) allUv.push(uv.getX(i), uv.getY(i));
    allUv.push(...backUvs, ...wallUvs);
    out.setAttribute('uv', new THREE.Float32BufferAttribute(allUv, 2));
  }

  const allIdx = new Uint32Array(idx.length + backIdx.length + wallIdx.length);
  allIdx.set(idx, 0);
  allIdx.set(backIdx, idx.length);
  allIdx.set(wallIdx, idx.length + backIdx.length);
  out.setIndex(new THREE.BufferAttribute(allIdx, 1));
  return out;
}

// ---------- Extrusion de faces ----------
// Extrue les triangles sélectionnés le long d'`offset` (espace local) :
// nouvelles faces supérieures + parois latérales sur le bord de la
// sélection. Retourne la nouvelle géométrie et l'indice des nouveaux
// sommets "haut" par groupe (pour sélection/drag ultérieur).
export function extrudeFaces(geo, triIdxs, offset) {
  ensureIndexed(geo);
  const pg = positionGroups(geo);
  const idx = geo.index.array;
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const n = pos.count;
  const selected = triIdxs instanceof Set ? triIdxs : new Set(triIdxs);

  // groupes concernés + comptage des arêtes sélectionnées
  const selGroups = new Set();
  const edgeSelCount = new Map(); // "ga_gb" non-dirigé -> nb d'usages dans la sélection
  const dirEdge = new Map();      // "ga_gb" dirigé -> [aIdx, bIdx]
  selected.forEach((t) => {
    for (let e = 0; e < 3; e++) {
      const a = idx[t * 3 + e], b = idx[t * 3 + ((e + 1) % 3)];
      const ga = pg.groupOf[a], gb = pg.groupOf[b];
      selGroups.add(ga); selGroups.add(gb);
      if (ga === gb) continue;
      const uk = ga < gb ? `${ga}_${gb}` : `${gb}_${ga}`;
      edgeSelCount.set(uk, (edgeSelCount.get(uk) || 0) + 1);
      const dk = `${ga}_${gb}`;
      if (!dirEdge.has(dk)) dirEdge.set(dk, [a, b]);
    }
  });

  // sommets "haut" : un par groupe sélectionné
  const topOfGroup = new Map();
  const topPositions = [], topUvs = [];
  selGroups.forEach((g) => {
    const vi = pg.groups[g][0];
    topPositions.push(pos.getX(vi) + offset.x, pos.getY(vi) + offset.y, pos.getZ(vi) + offset.z);
    if (uv) topUvs.push(uv.getX(vi), uv.getY(vi));
    topOfGroup.set(g, n + topPositions.length / 3 - 1);
  });

  const newTris = [];
  // faces du haut (même winding)
  selected.forEach((t) => {
    newTris.push(
      topOfGroup.get(pg.groupOf[idx[t * 3]]),
      topOfGroup.get(pg.groupOf[idx[t * 3 + 1]]),
      topOfGroup.get(pg.groupOf[idx[t * 3 + 2]])
    );
  });
  // parois sur le bord de la sélection (arête utilisée par 1 seul triangle sélectionné)
  dirEdge.forEach(([a, b], dk) => {
    const [ga, gb] = dk.split('_').map(Number);
    const uk = ga < gb ? `${ga}_${gb}` : `${gb}_${ga}`;
    if (edgeSelCount.get(uk) !== 1) return;
    const aTop = topOfGroup.get(ga), bTop = topOfGroup.get(gb);
    newTris.push(a, b, bTop);
    newTris.push(a, bTop, aTop);
  });

  return assembleWith(geo, topPositions, topUvs, newTris, topOfGroup);
}

// ---------- Inset de faces ----------
// Rétrécit la région sélectionnée vers son centroïde (facteur 0..1) et
// crée les parois de jonction. Les sommets d'origine (anneau externe) sont
// conservés pour ne pas déformer les faces voisines.
export function insetFaces(geo, triIdxs, factor = 0.7) {
  ensureIndexed(geo);
  const pg = positionGroups(geo);
  const idx = geo.index.array;
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const n = pos.count;
  const selected = triIdxs instanceof Set ? triIdxs : new Set(triIdxs);

  const selGroups = new Set();
  const edgeSelCount = new Map();
  const dirEdge = new Map();
  selected.forEach((t) => {
    for (let e = 0; e < 3; e++) {
      const a = idx[t * 3 + e], b = idx[t * 3 + ((e + 1) % 3)];
      const ga = pg.groupOf[a], gb = pg.groupOf[b];
      selGroups.add(ga); selGroups.add(gb);
      if (ga === gb) continue;
      const uk = ga < gb ? `${ga}_${gb}` : `${gb}_${ga}`;
      edgeSelCount.set(uk, (edgeSelCount.get(uk) || 0) + 1);
      const dk = `${ga}_${gb}`;
      if (!dirEdge.has(dk)) dirEdge.set(dk, [a, b]);
    }
  });

  // centroïde de la région
  let cx = 0, cy = 0, cz = 0;
  selGroups.forEach((g) => {
    const vi = pg.groups[g][0];
    cx += pos.getX(vi); cy += pos.getY(vi); cz += pos.getZ(vi);
  });
  cx /= selGroups.size; cy /= selGroups.size; cz /= selGroups.size;

  // copies "inset" : position rétrécie vers le centroïde
  const insetOfGroup = new Map();
  const insetPositions = [], insetUvs = [];
  selGroups.forEach((g) => {
    const vi = pg.groups[g][0];
    const x = pos.getX(vi), y = pos.getY(vi), z = pos.getZ(vi);
    insetPositions.push(cx + (x - cx) * factor, cy + (y - cy) * factor, cz + (z - cz) * factor);
    if (uv) insetUvs.push(uv.getX(vi), uv.getY(vi));
    insetOfGroup.set(g, n + insetPositions.length / 3 - 1);
  });

  const newTris = [];
  // faces inset (les triangles sélectionnés sont remplacés par leurs versions rétrécies)
  selected.forEach((t) => {
    newTris.push(
      insetOfGroup.get(pg.groupOf[idx[t * 3]]),
      insetOfGroup.get(pg.groupOf[idx[t * 3 + 1]]),
      insetOfGroup.get(pg.groupOf[idx[t * 3 + 2]])
    );
  });
  // parois entre l'anneau externe et l'anneau inset
  dirEdge.forEach(([a, b], dk) => {
    const [ga, gb] = dk.split('_').map(Number);
    const uk = ga < gb ? `${ga}_${gb}` : `${gb}_${ga}`;
    if (edgeSelCount.get(uk) !== 1) return;
    const aIn = insetOfGroup.get(ga), bIn = insetOfGroup.get(gb);
    newTris.push(a, b, bIn);
    newTris.push(a, bIn, aIn);
  });

  // On garde uniquement les triangles NON sélectionnés d'origine
  const keepIdx = [];
  for (let t = 0; t < idx.length / 3; t++) {
    if (!selected.has(t)) keepIdx.push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]);
  }

  return assembleWith(geo, insetPositions, insetUvs, newTris, insetOfGroup, keepIdx);
}

// Assemble une géométrie : triangles conservés + nouveaux sommets + nouveaux triangles.
function assembleWith(geo, addPositions, addUvs, newTris, groupMapOfNewVerts, keepIdx = null) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const idx = geo.index.array;
  const n = pos.count;

  const base = keepIdx || Array.from(idx);
  const allPos = [];
  for (let i = 0; i < n; i++) allPos.push(pos.getX(i), pos.getY(i), pos.getZ(i));
  allPos.push(...addPositions);

  const allIdx = new Uint32Array(base.length + newTris.length);
  allIdx.set(base, 0);
  allIdx.set(newTris, base.length);

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(allPos, 3));
  if (uv) {
    const allUv = [];
    for (let i = 0; i < n; i++) allUv.push(uv.getX(i), uv.getY(i));
    allUv.push(...addUvs);
    out.setAttribute('uv', new THREE.Float32BufferAttribute(allUv, 2));
  }
  out.setIndex(new THREE.BufferAttribute(allIdx, 1));
  out.computeVertexNormals();
  return { geometry: out, newVertOfGroup: groupMapOfNewVerts };
}

// ---------- Bevel (approximation) ----------
// Arrondit les arêtes : subdivision + lissage. Moins précis qu'un vrai
// chanfrein mais robuste sur n'importe quelle topologie.
export function bevelApprox(geo, { levels = 2, smooth = 0.4, iterations = 2 } = {}) {
  let g = subdivide(geo, levels);
  smoothLaplacian(g, smooth, iterations);
  return g;
}

// Sous-division "subsurf" : subdivision + lissage plus prononcé.
export function subsurf(geo, levels = 1) {
  let g = subdivide(geo, levels);
  smoothLaplacian(g, 0.5, levels);
  return g;
}
