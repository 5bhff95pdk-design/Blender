# Analyse — Blender Mobile (clone tactile)

> Analyse du dépôt au commit `5db1537` (« Merge Blender Mobile clone »), branche `arena/01a0b44c-blender`.
> Vérifié le 2026-09-18 : `npm install` ✅, `npm run build` ✅ (1,74 s), `npm run dev` ✅ (serveur démarré, page servie).

---

## ⚡ MISE À JOUR (post-refactor) — roadmap complet livré

L'analyse ci-dessous documente l'état d'origine. Le roadmap complet (phases 1→3) a depuis été implémenté :

| # | Constat initial | Statut |
|---|---|---|
| 0 | **(Découvert pendant le refactor)** L'app d'origine **plantait au démarrage** : `TransformControls.getHelper()` n'existe pas dans three r160 | ✅ Corrigé (compatible r160 et r169+) — attrapé par le test d'intégration |
| 1 | Fuite de contextes WebGL à chaque rendu | ✅ Renderer unique persistant, réutilisé |
| 2 | `mergeGeometries` perdait l'index → Miroir/Array cassés | ✅ Fusion via `BufferGeometryUtils` + winding du miroir corrigé |
| 3 | Duplication corrompait `userData`/`baseGeometry` | ✅ Clone propre, baseGeometry reste une géométrie |
| 4 | Émissive effacée à la désélection | ✅ Supprimé |
| 5 | Stats fausses (accumulation croisée) | ✅ Compteur exact, testé |
| 6 | Pinch-zoom double | ✅ Handler custom supprimé, OrbitControls seul |
| 7 | Mode Édition : déchirure + 1000 draw calls | ✅ Groupes de positions soudés + InstancedMesh (1 draw call) |
| 8 | Rendu final pollué (grille, gizmo) | ✅ Overlays masqués pendant le rendu |
| 9 | Export GLTF pollué | ✅ Meshes + lumières uniquement |
| 10 | Lumières non cliquables | ⚠️ Sélection via outliner (raycast sur gizmos lumineux : à venir) |
| 11 | Injection HTML via noms d'objets | ✅ Échappement systématique |
| — | Undo factice | ✅ Undo/Redo par snapshots complets (un pas par opération) |
| — | Pas de sauvegarde | ✅ Sauvegarde/chargement JSON + nouvelle scène |
| — | Extrude factice | ✅ Extrusion réelle (faces + parois) + Inset réel |
| — | Subdivision no-op | ✅ Subdivision réelle + lissage laplacien |
| — | Solidify/Bevel absents | ✅ Solidify réel (coque + parois) · Bevel = approximation documentée |
| — | Boutons morts (💾, menus, œil) | ✅ Tous câblés (menus Fichier/Édition/Objet/Vue, visibilité) |
| — | Multi-sélection absente | ✅ Shift+clic + pivot partagé (translate/rotate/scale) |
| — | Pas de gizmo de navigation | ✅ 6 axes cliquables avec tween de vue |
| — | Manifest dupliqué + icônes manquantes | ✅ Manifest unique + icônes 192/512 générées |
| — | Aucun test | ✅ `npm test` : 80 assertions (32 géométrie + 48 intégration jsdom) |

L'architecture est passée d'un monolithe de 1 327 lignes à 11 modules (voir README).
Loop Cut, le mode Edge, le snapping et l'édition proportionnelle restent à venir (désactivés/annoncés honnêtement dans l'UI).

---

---

## 1. Vue d'ensemble

| Élément | Détail |
|---|---|
| **Produit** | Clone de Blender « mobile-first », jouable au tactile, dans le navigateur |
| **Stack** | Vite 5 + Three.js 0.160 (vanilla JS, aucun framework UI) |
| **Code** | `index.html` (385 l.) · `src/main.js` (1 327 l.) · `src/style.css` (728 l.) — **2 055 lignes de src** |
| **Bundle** | 575 Ko JS minifié / **149 Ko gzip** — dépasse le seuil de 500 Ko (warning Vite) |
| **Langue UI** | Français, PWA (manifest + thème `#eb7700`) |
| **Tests** | Aucun (ni lint, ni CI, ni test) |

C'est une **démo prototype solide visuellement** : viewport Three.js, 3 modes (Objet/Édition/Sculpt), outliner, panneau propriétés, menu Add, raccourcis clavier Blender, UI mobile avec bottom-nav et sheets. Mais plusieurs fonctionnalités annoncées dans le README sont **simulées ou non câblées**, et il y a des bugs réels.

---

## 2. Architecture

Tout vit dans **un seul fichier** `src/main.js`, organisé en sections linéaires :

```
State (objet global mutable)  →  Scene setup (renderer, orbit, transform, lumières)
  → Factory (addPrimitive/addLight/addCamera)  →  Sélection (raycaster)
  → Edit Mode (helpers de vertices)  →  Sculpt Mode (brushes CPU)
  → Modifiers (applyModifier/mergeGeometries)  →  History (log simple)
  → UI (setupUI : ~40 getElementById + addEventListener)  →  Render (2ᵉ renderer)
  → Interaction (pointer + touch)  →  animate() → init()
```

Points forts :
- `State` central clair ; `window.BlenderMobile` exposé pour le debug.
- Bonne utilisation des addons Three.js (`OrbitControls`, `TransformControls`, `GLTFExporter`).
- CSS mobile-first propre : sheets coulissantes, `@media` à 900 px, bottom-nav.
- Choix UX pertinents : long-press → menu contextuel, toasts, HUD de transform.

Faiblesses structurelles :
- **Monolithe de 1 327 lignes** : aucun module, tout est couplé (DOM ↔ scène ↔ état). Toute évolution (undo réel, multi-sélection) exigera un découpage.
- **Undo inexistant** : `Ctrl+Z` affiche « à venir » ; `State.history` n'est qu'un journal d'affichage, pas une pile d'états.
- **Pas de persistance** : pas de sauvegarde/chargement de scène (le bouton 💾 `#saveBtn` n'a **aucun listener**).

---

## 3. Bugs identifiés

### 🔴 Critiques

| # | Bug | Localisation | Détail |
|---|---|---|---|
| 1 | **Fuite de contextes WebGL** | `openRender()` (~l. 963) | Chaque clic « Rendu » crée un `new THREE.WebGLRenderer` **jamais disposé**. Les navigateurs limitent à ~16 contextes actifs → au bout d'une quinzaine de rendus, perte du contexte et écran noir. |
| 2 | **`mergeGeometries()` perd l'index** | l. 559–593 | La fusion copie position/normal/uv mais **pas l'attribut `index`**. Or `BoxGeometry`, `SphereGeometry`… sont indexées → les modificateurs **Miroir / Array produisent une géométrie cassée** (triangles aléatoires), sauf sur des géométries non-indexées. |
| 3 | **`duplicateSelected()` corrompt `userData`** | l. 328–349 | `JSON.parse(JSON.stringify(userData))` sérialise `baseGeometry` (un `BufferGeometry`) en objet brut → la copie perd sa géométrie de référence ; `modifiers` devient un objet plain. Toute logique future s'appuyant sur `baseGeometry` cassera sur les clones. |

### 🟠 Majeurs

| # | Bug | Localisation | Détail |
|---|---|---|---|
| 4 | **Émissive effacée à la désélection** | `selectObject()` l. 279 | `material.emissive?.setHex(0x000000)` sur l'objet précédent → régler une couleur émissive puis changer de sélection **réinitialise l'émissive à noir**. |
| 5 | **Statistiques fausses** | `updateStats()` l. 635–647 | `faces += Math.floor(tris)` **accumule le total cumulé** à chaque objet au lieu du nombre de faces de l'objet. La ligne « Verts/Tris » est fausse dès 2 meshes. |
| 6 | **Pinch-zoom double** | `setupInteraction()` l. 1130+ | Un handler `touchmove` 2 doigts déplace la caméra le long de l'axe de vue, **en plus** du dolly d'`OrbitControls` (`touches.TWO = DOLLY_PAN` par défaut) → zoom ~2× trop rapide, comportement erratique. |
| 7 | **Mode Édition : déchirure du mesh** | `enterEditMode()` l. 351+ | Une sphère par vertex, mais les géométries Three.js dupliquent les sommets aux coutures (un cube = 24 vertices pour 8 coins). Déplacer un « coin » ne déplace qu'1 des 3 vertices co-localisés → **le mesh se déchire**. Il faudrait du vertex-welding (Map par position). |
| 8 | **Rendu final pollué** | `openRender()` | Le « rendu Cycles » ré-affiche la **même scène** : grille, axes, curseur 3D animé et **gizmo TransformControls** apparaissent dans l'image 1920×1080. |
| 9 | **Export GLTF pollué** | `exportGltf()` l. 1027 | Exporte `scene` entière : grille, axes, floor, outlines, helpers d'édition inclus. Blender n'exporte que les objets. |
| 10 | **Lumières/caméras non cliquables** | `getIntersects()` l. 264 | Le raycast filtre `isMesh || isLight` mais les lights n'ont pas de géométrie hitable (récursif `false` → le petit sphere du PointLight est ignoré) et les caméras sont exclues. Sélection possible uniquement via l'outliner. |
| 11 | **Injection HTML via le nom** | `updateOutliner()` l. 607+ / `updateHistoryUI()` | `obj.name` (éditable par l'utilisateur) est injecté dans `innerHTML` sans échappement → self-XSS (`<img onerror=...>` comme nom d'objet). |

### 🟡 Mineurs

- **`setTool('select')` incohérent** (l. 708–713) : `detach()`, re-`attach()`, re-`detach()` — le gizmo reste attaché mais désactivé ; code contradictoire.
- **`newMatBtn`** : couleur aléatoire `Math.floor(Math.random()*16777215).toString(16)` peut faire **5 caractères** → hex invalide ; et `userData.materialProps` n'est pas mis à jour → panneau désynchronisé.
- **Modificateur "supprimer"** (`updateModifiersUI`) : le bouton ✕ ne fait que `this.closest('.mat-item').remove()` — **supprime la ligne DOM, pas l'entrée** dans `userData.modifiers`.
- **Bouton Ortho** : ne crée pas d'OrthographicCamera, il bascule juste le FOV 50↔15 (l'objet `ortho` créé est jeté) ; `viewInfo` continue d'afficher « Persp ».
- **Manifest en double** : `manifest.json` (racine, minimal) **et** `public/manifest.json` (avec icônes `icon-192.png` / `icon-512.png` **qui n'existent pas** dans `public/`). Vite sert celui de `public/` ; celui de la racine est mort. L'install PWA échouera faute d'icônes.
- **Fuite mémoire à la suppression** : `deleteSelected()` ne fait aucun `geometry.dispose()` / `material.dispose()` (seulement 5 appels à `dispose` dans tout le fichier).
- **Onglets menus morts** : « Fichier / Édition / Objet / Vue » (`data-menu`) n'ont **aucun handler** ; idem pour l'œil 👁 de l'outliner (visibilité) et `#gizmoCorner` (navigation gizmo vide).

---

## 4. Écarts fonctionnels vs annonces du README

Le README promet plus que ce que le code fait :

| Annoncé | Réalité dans le code |
|---|---|
| **Extrude (E)** | Ne crée pas de faces : déplace les vertices sélectionnés de +0.3 en Y (l. 716–733). |
| **Inset, Bevel, Loop Cut, Mesure, Curseur** | Boutons présents dans `index.html` mais **aucune logique** dans `setTool()` — juste un état actif. |
| **Subdivision (modificateur)** | No-op déguisé : clone la géométrie, recalcule les normales, `flatShading=false` (l. 507–522). Les commentaires du code l'admettent (« For demo… »). |
| **Solidify, Bevel (modificateurs)** | Boutons listés, aucun cas dans `applyModifier()`. |
| **Undo (Ctrl+Z)** | Stub : toast « à venir ». |
| **Rendu « Cycles Mobile »** | Simple re-render WebGL de la même scène à 1920×1080 (avec grille et gizmo), pas un path-tracer ni même un mode d'ombrage différent. |
| **Suzanne** | Icosahedron déformé par un scale (1.1, 1.2, 0.9) — hommage, pas Suzanne. |
| **Sculpt « high poly »** | Le commentaire « Ensure high poly for sculpt » n'est suivi d'aucune subdivision automatique → sculpter un cube (24 verts) donne des résultats très grossiers. |
| **Shading Material/Rendered** | Seuls `wireframe` (flag matériau) et le fond plus sombre sont gérés — pas de vraie différence Material vs Solid. |

---

## 5. Performance

- **Bundle** : 575 Ko / 149 Ko gzip (Three.js ≈ tout le poids). Piste : `manualChunks` ou import dynamique des addons ; pour une app mobile c'est acceptable en 4G mais limite en 3G.
- **Mode Édition coûteux** : 1 `Mesh` + 1 `SphereGeometry` + 1 `Material` **par vertex** → une UV Sphere (≈ 1 000 verts) = ~1 000 draw calls. De plus le drag fait `editHelpers.children.find()` par vertex sélectionné → **O(n²)** par événement pointermove.
- **Sculpt** : boucle CPU sur tous les verts à chaque pointermove avec `computeVertexNormals()` complet — OK jusqu'à ~20 k verts, puis ça décroche sur mobile.
- `preserveDrawingBuffer: true` sur le renderer principal : coût perf permanent pour un `toDataURL` qui n'est utilisé que sur le canvas de rendu (qui a son propre renderer).

---

## 6. Qualité / maintenabilité

- Aucun test, aucun ESLint/Prettier, aucune CI. Pour un prototype c'est tolérable, mais le monolithe `main.js` rend chaque correction risquée (état global muté depuis ~15 endroits).
- Le code mélange français/anglais, contient des blocs commentés morts (« Actually use Subdivision? We'll just… ») et des variables créées puis jetées (`ortho`, `prevWidth`).
- `.gitignore` minimal ; `package-lock.json` versionné ✅ ; pas de README d'installation dédié dev (le live preview e2b est codé en dur dedans).

---

## 7. Recommandations (par priorité)

1. **Corriger les 3 bugs critiques** — disposer le renderer de rendu (le créer une fois, ou `rRenderer.dispose()` + `forceContextLoss()` après export) ; copier l'`index` dans `mergeGeometries` ; cloner `userData` proprement (`baseGeometry: geometry.clone()`).
2. **Câbler ou masquer** : bouton 💾 (sauvegarde `.json` de la scène — facile et très utile), menus Fichier/Édition/Objet/Vue, œil de visibilité, Inset/Bevel/LoopCut (soit implémenter, soit retirer les boutons).
3. **Undo minimal viable** : snapshot sérialisé de `State.objects` (positions/transforms/matériaux) à chaque `pushHistory` — le hook existe déjà partout.
4. **Vertex-welding en mode Édition** (Map clé = position arrondie) + `InstancedMesh` pour les points → corrige la déchirure ET la perf.
5. **Scène « clean » pour rendu/export** : rendre/exporter un `Group` contenant uniquement les meshes (exclure grille, axes, curseur, gizmo, outlines).
6. **Supprimer le double zoom tactile** (retirer le handler `touchmove` custom, configurer `OrbitControls` : 1 doigt = sélection en mode objet / orbite via un toggle, 2 doigts = `DOLLY_PAN`).
7. **PWA** : supprimer `manifest.json` racine, générer les icônes 192/512 manquantes.
8. **Découpage** : `state.js`, `scene.js`, `modes/`, `ui/`, `export.js` — prérequis pour tout ce qui précède au-delà du hotfix.
9. **Hygiène** : échapper les noms dans l'outliner, `dispose()` à la suppression, ESLint + `npm run build` en CI.

---

## 8. Verdict

**Prototype réussi comme démo UX** (look & feel Blender crédible, mobile-first soigné, ça build et ça tourne), mais **loin d'un outil utilisable** : undo absent, modificateurs phares factices ou cassés (mirror/array produisent une géométrie corrompue), mode Édition qui déchire les meshes, fuite de contextes WebGL au rendu. Le chemin le plus rentable : d'abord les 3 correctifs critiques + undo + sauvegarde de scène, ensuite le refactor modulaire.
