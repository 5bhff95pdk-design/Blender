// Test d'intégration complet sous Node (jsdom + shim WebGLRenderer).
// Exécution : npm test (ou: node --import ./tests/register.mjs tests/integration.test.mjs)

import { JSDOM } from 'jsdom';
import fs from 'node:fs';

// ---------- DOM ----------
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: false });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.Event = dom.window.Event;
globalThis.FileReader = dom.window.FileReader;
globalThis.Blob = dom.window.Blob;
globalThis.requestAnimationFrame = () => 0; // jamais exécuté : pas de boucle infinie
globalThis.performance = dom.window.performance;
// polyfills
dom.window.URL.createObjectURL = () => 'blob:fake';
dom.window.URL.revokeObjectURL = () => {};
globalThis.URL = dom.window.URL;

let passed = 0, failed = 0;
const ok = (cond, msg) => { if (cond) passed++; else { failed++; console.error('  ✗ FAIL:', msg); } };

// ---------- Import de l'app ----------
const B = await import(new URL('../src/main.js', import.meta.url).href).then(() => window.BlenderMobile);
ok(!!B, 'module main.js chargé, window.BlenderMobile exposé');
ok(B.State.objects.length === 1, `scène initiale = 1 cube (reçu ${B.State.objects.length})`);
ok(B.State.history.length === 1, `historique initial (reçu ${B.State.history.length})`);

const cube = () => B.State.objects.find((o) => o.isMesh);
const tris = (m) => m.geometry.index.count / 3;

// ---------- Ajout + Undo/Redo ----------
B.app.addPrimitive('sphere');
ok(B.State.objects.length === 2, 'ajout sphère');
B.app.undo();
ok(B.State.objects.length === 1, `undo retire la sphère (reçu ${B.State.objects.length})`);
B.app.redo();
ok(B.State.objects.length === 2, `redo restaure la sphère (reçu ${B.State.objects.length})`);
B.app.undo();

// ---------- Modificateurs ----------
B.app.applyModifier('subsurf');
ok(tris(cube()) === 48, `subsurf cube: 48 tris (reçu ${tris(cube())})`);
B.app.undo();
ok(tris(cube()) === 12, `undo subsurf (reçu ${tris(cube())})`);

B.app.applyModifier('mirror');
ok(tris(cube()) === 24, `mirror cube: 24 tris (reçu ${tris(cube())})`);
ok(Array.from(cube().geometry.attributes.position.array).every(Number.isFinite), 'mirror: positions finies');
B.app.undo();

B.app.applyModifier('array', { count: 3, spacing: 1.2 });
ok(tris(cube()) === 36, `array x3: 36 tris (reçu ${tris(cube())})`);
B.app.undo();

B.app.applyModifier('solidify');
ok(tris(cube()) === 24, `solidify cube fermé: 24 tris (reçu ${tris(cube())})`);
B.app.undo();

// retrait réel d'un modificateur
B.app.applyModifier('subsurf');
B.app.removeModifier(0);
ok(tris(cube()) === 12, `modificateur retiré réellement (reçu ${tris(cube())})`);

// ---------- Mode Édition ----------
B.app.setMode('EDIT');
ok(B.State.mode === 'EDIT', 'mode Édition');
const helpers = B.app.editHelpers();
ok(!!helpers, 'helpers d\'édition présents');
ok(helpers.children[0].count === 8, `cube = 8 points soudés (reçu ${helpers.children[0].count})`);

// extrusion réelle de la face du dessus
const { editMode } = B;
editMode.setSelectionMode('face');
const idx = cube().geometry.index.array;
const pos = cube().geometry.attributes.position;
const topTris = [];
for (let t = 0; t < idx.length / 3; t++) {
  let allTop = true;
  for (let e = 0; e < 3; e++) if (pos.getY(idx[t * 3 + e]) <= 0.49) allTop = false;
  if (allTop) topTris.push(t);
}
ok(topTris.length === 2, `face du dessus = 2 tris (reçu ${topTris.length})`);
topTris.forEach((t) => B.State.edit.selectedFaces.add(t));
const before = tris(cube());
editMode.extrudeSelection();
ok(tris(cube()) === before + 10, `extrusion: +2 haut +8 parois (reçu ${tris(cube()) - before})`);
ok(B.State.edit.selectedGroups.size > 0, 'sommets du haut sélectionnés après extrusion');

// inset réel (les faces du haut sont à y≈0.9 après extrusion de 0.4 depuis y=0.5)
editMode.setSelectionMode('face');
const idx2 = cube().geometry.index.array;
const pos2 = cube().geometry.attributes.position;
const topTris2 = [];
for (let t = 0; t < idx2.length / 3; t++) {
  let allTop = true;
  for (let e = 0; e < 3; e++) if (pos2.getY(idx2[t * 3 + e]) <= 0.8) allTop = false;
  if (allTop) topTris2.push(t);
}
topTris2.forEach((t) => B.State.edit.selectedFaces.add(t));
const beforeInset = tris(cube());
if (topTris2.length >= 2) {
  editMode.insetSelection();
  ok(tris(cube()) === beforeInset + 8, `inset: +2 faces + parois (reçu ${tris(cube()) - beforeInset})`);
} else {
  ok(false, `inset: faces du dessus introuvables après extrusion (reçu ${topTris2.length})`);
}

B.app.setMode('OBJECT');
B.app.undo(); // annule l'inset -> retour à l'état extrudé
ok(tris(cube()) === before + 10, `undo inset (reçu ${tris(cube())}, attendu ${before + 10})`);
B.app.undo(); // annule l'extrusion
ok(tris(cube()) === 12, `undo extrusion (reçu ${tris(cube())})`);

// ---------- Suppression / duplication (multi) ----------
B.app.addPrimitive('cone'); // 2 objets
B.State.selection.clear();
B.State.objects.forEach((o) => B.State.selection.add(o)); // sélection multiple
B.State.selected = B.State.objects[1];
B.app.duplicateSelected();
ok(B.State.objects.length === 4, `duplication multi de 2 objets (reçu ${B.State.objects.length})`);
const dup = B.State.objects[3];
ok(!!dup.userData.baseGeometry?.attributes?.position, 'duplicate: baseGeometry reste une vraie géométrie (bug #3 corrigé)');
B.app.deleteSelected(); // supprime les 2 clones
ok(B.State.objects.length === 2, `suppression multi (reçu ${B.State.objects.length})`);
B.app.undo();
ok(B.State.objects.length === 4, `undo suppression (reçu ${B.State.objects.length})`);

// ---------- Émissive préservée (bug #4) ----------
const m = B.State.objects.find((o) => o.isMesh);
m.userData.materialProps.emissive = '#ff0000';
m.material.emissive.set('#ff0000');
B.app.addPrimitive('sphere');
ok(m.material.emissive.getHexString() === 'ff0000', `émissive préservée à la sélection (reçu ${m.material.emissive.getHexString()})`);

// ---------- Stats (bug #5) ----------
const statsTxt = document.getElementById('stats').textContent;
ok(/Verts: \d+ \| Tris: \d+ \| Objets: \d+/.test(statsTxt), `format stats correct ("${statsTxt}")`);
const match = statsTxt.match(/Tris: (\d+)/);
const expectedTris = B.State.objects.filter((o) => o.isMesh).reduce((s, o) => s + o.geometry.index.count / 3, 0);
ok(Number(match[1]) === Math.floor(expectedTris), `compteur de tris exact (${match[1]} vs ${expectedTris})`);

// ---------- Sérialisation round-trip ----------
const data = B.persistence.serializeScene();
B.persistence.restoreScene(JSON.parse(JSON.stringify(data)));
ok(B.State.objects.length === 5, `round-trip conserve les objets (reçu ${B.State.objects.length})`);
ok(B.State.objects.every((o) => o.name && o.userData.id), 'objets restaurés avec nom/id');
const restoredTris = B.State.objects.filter((o) => o.isMesh).reduce((s, o) => s + (o.geometry.index?.count ?? 0) / 3, 0);
ok(Math.floor(restoredTris) === expectedTris, `round-trip conserve la géométrie (${restoredTris} vs ${expectedTris})`);

// ---------- UI : menus, shading, ortho, vues ----------
document.querySelector('.menu-btn[data-menu="file"]').click();
ok(document.querySelector('.menu-dropdown').classList.contains('visible'), 'menu Fichier s\'ouvre');
document.body.click();
ok(!document.querySelector('.menu-dropdown').classList.contains('visible'), 'menu se referme au clic extérieur');

document.querySelector('.shade-btn[data-shade="wireframe"]').click();
ok(cube().material.wireframe === true, 'shading wireframe appliqué');
document.querySelector('.shade-btn[data-shade="solid"]').click();

B.app.toggleOrtho();
ok(B.State.ortho === true, 'bascule Ortho');
ok(document.getElementById('viewInfo').textContent.includes('Ortho'), 'viewInfo affiche Ortho');
B.app.toggleOrtho();

B.app.setView('front');
ok(true, 'setView front (tween) sans erreur');

B.app.toggleXray();
ok(cube().material.transparent === true && cube().material.opacity === 0.5, 'X-Ray appliqué');
B.app.toggleXray();

// onglets édition
B.app.setMode('EDIT');
ok(document.getElementById('editTabs').classList.contains('visible'), 'onglets vertex/face visibles en mode Édition');
editMode.setSelectionMode('face');
ok(document.querySelector('.etab-btn[data-emode="face"]').classList.contains('active'), 'onglet face actif');
B.app.setMode('OBJECT');

// outliner : œil de visibilité
const eyeBtn = document.querySelector('.oi-vis');
eyeBtn.click();
ok(cube().visible === false, 'œil outliner masque l\'objet');
eyeBtn.click();
ok(cube().visible === true, 'œil outliner réaffiche l\'objet');

// gizmo navigation
ok(document.querySelectorAll('.gizmo-dot').length === 6, 'gizmo: 6 axes');

// rendu x3 (API + pas d'erreur, le renderer est réutilisé)
B.app.openRender(); B.app.closeRender();
B.app.openRender(); B.app.closeRender();
B.app.openRender(); B.app.closeRender();
ok(true, '3 rendus successifs sans erreur (renderer unique)');

// ---------- Scène : nouvelle + fichier ----------
B.persistence.saveSceneFile();
ok(true, 'sauvegarde fichier sans erreur');
B.app.newScene();
ok(B.State.objects.length === 1 && B.State.history.length === 1, `nouvelle scène réinitialisée (reçu ${B.State.objects.length} objets, ${B.State.history.length} entrées)`);

// ---------- Clavier ----------
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', shiftKey: true, bubbles: true }));
ok(document.getElementById('addPopup').classList.contains('visible'), 'Shift+A ouvre le menu Ajouter');
document.body.click();

console.log(`\n${passed} OK, ${failed} échec(s)`);
process.exit(failed ? 1 : 0);
