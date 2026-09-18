// Tests unitaires des opérations géométriques (node tests/geometry.test.mjs)
import * as THREE from 'three';
import {
  positionGroups, groupAdjacency, subdivide, smoothLaplacian,
  solidify, extrudeFaces, insetFaces, ensureIndexed,
} from '../src/geometry.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error('  ✗ FAIL:', msg); }
}

function box() { return new THREE.BoxGeometry(1, 1, 1); }
function noNaN(geo, label) {
  const p = geo.attributes.position.array;
  const ok = Array.from(p).every((v) => Number.isFinite(v));
  assert(ok, `${label}: positions finies (pas de NaN)`);
  if (geo.attributes.normal) {
    const nrm = geo.attributes.normal.array;
    assert(Array.from(nrm).every((v) => Number.isFinite(v)), `${label}: normales finies`);
  }
}
function triCount(geo) {
  return geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
}

// --- positionGroups ---
{
  const g = box();
  const pg = positionGroups(g);
  assert(pg.count === 8, `positionGroups: cube -> 8 groupes (reçu ${pg.count})`);
  assert(pg.groups.every((arr) => arr.length === 3), 'positionGroups: 3 sommets co-localisés par coin (coutures)');
  const adj = groupAdjacency(g, pg);
  // 3 voisins par les arêtes du cube + 1 par la diagonale de face (triangulation)
  assert(adj.length === 8 && adj[0].size === 4, `groupAdjacency: coin de cube a 4 voisins triangulaires (reçu ${adj[0].size})`);
}

// --- subdivide ---
{
  const g = box();
  const s = subdivide(g, 1);
  assert(triCount(s) === triCount(g) * 4, `subdivide: 4x triangles (reçu ${triCount(s)} vs ${triCount(g) * 4})`);
  assert(s.attributes.position.count > g.attributes.position.count, 'subdivide: nouveaux sommets ajoutés');
  noNaN(s, 'subdivide');
  const s2 = subdivide(box(), 2);
  assert(triCount(s2) === 12 * 16, `subdivide x2: 192 triangles (reçu ${triCount(s2)})`);
  // volume approximatif conservé (convexe) via centroïde et enveloppe : on vérifie juste le rayon max
  const p = s.attributes.position;
  let maxR = 0;
  for (let i = 0; i < p.count; i++) maxR = Math.max(maxR, p.getX(i) ** 2 + p.getY(i) ** 2 + p.getZ(i) ** 2);
  assert(Math.sqrt(maxR) < 0.87, `subdivide: les sommets restent dans le cube (rayon max ${Math.sqrt(maxR).toFixed(3)} < 0.87)`);
}

// --- smoothLaplacian ---
{
  const g = new THREE.SphereGeometry(1, 32, 16);
  const before = g.attributes.position.array.slice();
  smoothLaplacian(g, 0.5, 1);
  noNaN(g, 'smoothLaplacian');
  let moved = 0;
  for (let i = 0; i < g.attributes.position.count; i++) {
    const d = Math.hypot(
      g.attributes.position.getX(i) - before[i * 3],
      g.attributes.position.getY(i) - before[i * 3 + 1],
      g.attributes.position.getZ(i) - before[i * 3 + 2]
    );
    if (d > 1e-6) moved++;
  }
  assert(moved > 0, 'smoothLaplacian: des sommets ont bougé');
  // pas de déchirure : les sommets co-localisés restent co-localisés
  const pg = positionGroups(g);
  assert(pg.count === positionGroups(new THREE.SphereGeometry(1, 32, 16)).count,
    'smoothLaplacian: pas de déchirure des coutures (même nb de groupes)');
}

// --- solidify ---
{
  const g = box();
  const s = solidify(g, 0.1);
  assert(s.index && s.index.count > g.index.count, 'solidify: plus de triangles');
  assert(triCount(s) === 24, `solidify cube fermé: 12 avant + 12 arrière, pas de parois (reçu ${triCount(s)})`);
  noNaN(s, 'solidify');
  // la coque arrière est décalée vers l'intérieur (normale moyennée du coin = diagonale)
  const p = s.attributes.position;
  let found = false;
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(Math.abs(p.getX(i)) - 0.4423) < 0.001) found = true;
  }
  assert(found, 'solidify: coque arrière décalée de ~0.1 le long de la diagonale du coin');
}

// --- solidify sur un mesh ouvert (parois) ---
{
  const g = new THREE.PlaneGeometry(2, 2); // 2 triangles, 4 arêtes de bord
  const s = solidify(g, 0.1);
  // 2 avant + 2 arrière + 4 parois x 2 triangles = 12
  assert(triCount(s) === 12, `solidify plan: 12 triangles avec parois (reçu ${triCount(s)})`);
  noNaN(s, 'solidify plan');
  let back = false;
  for (let i = 0; i < s.attributes.position.count; i++) {
    if (Math.abs(s.attributes.position.getZ(i) + 0.1) < 1e-6) back = true;
  }
  assert(back, 'solidify plan: coque arrière à z=-0.1');
}

// --- extrudeFaces ---
{
  const g = ensureIndexed(box());
  // extrude la face du dessus (triangles 8 et 9 d'un BoxGeometry standard : +Y)
  // On cherche les triangles dont les 3 sommets ont y > 0
  const idx = g.index.array;
  const pos = g.attributes.position;
  const topTris = new Set();
  for (let t = 0; t < idx.length / 3; t++) {
    let allTop = true;
    for (let e = 0; e < 3; e++) if (pos.getY(idx[t * 3 + e]) <= 0.49) allTop = false;
    if (allTop) topTris.add(t);
  }
  assert(topTris.size === 2, `extrude: face du dessus = 2 triangles (reçu ${topTris.size})`);

  const { geometry: ex, newVertOfGroup } = extrudeFaces(g, topTris, new THREE.Vector3(0, 0.5, 0));
  assert(triCount(ex) === 12 + 2 + 8, `extrude: 12 + 2 (haut) + 8 (parois) triangles (reçu ${triCount(ex)})`);
  noNaN(ex, 'extrude');
  assert(newVertOfGroup.size === 4, `extrude: 4 nouveaux sommets haut (reçu ${newVertOfGroup.size})`);
  // les sommets haut sont bien à y = 1.0 (0.5 + 0.5)
  let okTop = true;
  newVertOfGroup.forEach((vi) => { if (Math.abs(ex.attributes.position.getY(vi) - 1) > 1e-6) okTop = false; });
  assert(okTop, 'extrude: sommets haut à la bonne hauteur');
  // pas de sommet orphelin cassé : toutes les positions finies déjà vérifiées
}

// --- insetFaces ---
{
  const g = ensureIndexed(box());
  const idx = g.index.array;
  const pos = g.attributes.position;
  const topTris = new Set();
  for (let t = 0; t < idx.length / 3; t++) {
    let allTop = true;
    for (let e = 0; e < 3; e++) if (pos.getY(idx[t * 3 + e]) <= 0.49) allTop = false;
    if (allTop) topTris.add(t);
  }
  const { geometry: ins } = insetFaces(g, topTris, 0.5);
  // 12 - 2 (retirés) + 2 (inset) + 8 (parois) = 20
  assert(triCount(ins) === 20, `inset: 20 triangles attendus (reçu ${triCount(ins)})`);
  noNaN(ins, 'inset');
  // l'anneau externe d'origine est intact (les faces voisines ne bougent pas)
  const p2 = ins.attributes.position;
  let okRing = false;
  for (let i = 0; i < p2.count; i++) {
    if (Math.abs(p2.getY(i) - 0.5) < 1e-6 && Math.abs(p2.getX(i)) > 0.4) okRing = true;
  }
  assert(okRing, 'inset: anneau externe conservé');
}

console.log(`\n${passed} OK, ${failed} échec(s)`);
process.exit(failed ? 1 : 0);
