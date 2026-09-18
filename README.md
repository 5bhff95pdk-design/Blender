# Blender Mobile — Clone Tactile

Blender pour mobile, utilisable au tactile, directement dans ton navigateur.

**Live Preview:** `npm run dev` (le serveur démarre sur `0.0.0.0:5173`)

## 🎯 Fonctionnalités Blender

### Viewport 3D (comme Blender)
- **Orbite tactile :** tap = sélection, 1 doigt = orbite, 2 doigts = zoom/pan (OrbitControls)
- **Gizmo de navigation** dans le coin (clic sur un axe = vue de face/droite/dessus…)
- **Grille + Axes** comme Blender, **curseur 3D** animé et positionnable (outil Curseur)
- **Modes d'ombrage :** Solid, Wireframe (Z), Material Preview et Rendered (environnement studio)
- **X-Ray (Alt+Z)**, **Focus (F)**, **Persp/Ortho (5)**, vues Face/Droite/Dessus (1/3/7)
- **FPS counter + Stats** exactes (verts, tris, objets)

### Modes (comme Blender)
1. **Mode Objet :** sélection **multiple** (Shift+clic), transformation via gizmo pivot partagé, duplication, suppression
2. **Mode Édition :** sommets **soudés par position** (pas de déchirure aux coutures), sélection **vertex ou face**, drag sur plan face caméra, **Extrude (E), Inset (I), Bevel (B) réels** (nouvelles faces + parois latérales)
3. **Mode Sculpture :** brushes Draw, Smooth (laplacien), Inflate, Grab — par groupes de positions soudées

### Outils
- **Select (W), Move (G), Rotate (R), Scale (S)** avec gizmo TransformControls
- **Extrude (E), Inset (I), Bevel (B)** en mode Édition — topologie réelle
- **Curseur 3D** et **Mesure** (distance entre 2 points)
- Loop Cut : non implémenté (désactivé dans l'UI)

### Ajouter (Shift+A)
- **Mesh :** Cube, UV Sphere, Ico Sphere, Cylindre, Plan, Tore, Cône, Suzanne (approximation)
- **Lumière :** Point, Soleil, Spot (avec ombres)
- **Caméra**

### Modificateurs (empilables, réels, retirables)
- **Subdivision** (midpoint + lissage laplacien), **Miroir** (winding corrigé), **Réseau/Array**, **Solidify** (coque + parois sur arêtes de bord), **Bevel** (approximation : subdivision + lissage)
- La pile se reconstruit depuis la géométrie de base : ajouter/retirer un modificateur est non destructif
- Édition/sculpture « cuisent » la géométrie et réinitialisent la pile

### Historique & Fichiers
- **Undo/Redo complet (Ctrl+Z / Ctrl+Shift+Z)** : snapshots de scène (géométries incluses), un pas par opération (ajout, transformation, drag, coup de pinceau, modificateur…)
- **Sauvegarde/Chargement** de scène en JSON (`💾` ou Ctrl+S, Fichier → Ouvrir…)
- **Nouvelle scène** (Fichier)

### Propriétés (panneau droit)
- **Outliner :** liste, sélection multiple, visibilité (œil 👁), historique
- **Objet :** nom, position/rotation/échelle, duplication, suppression, centrage d'origine
- **Matériau :** couleur base, metallic, roughness, émissive (préservée à la désélection !)
- **Monde :** couleur de fond, intensité HDRI, grille, axes, ombres

### Rendu & Export
- **Rendu 1920×1080** avec tonemapping ACES — renderer unique réutilisé (pas de fuite de contextes WebGL), scène nettoyée (grille/axes/gizmo masqués)
- **Sauvegarder Image** PNG
- **Exporter GLTF** : uniquement les meshes et lumières (les helpers sont exclus)

### Menus & clavier
- Menus **Fichier / Édition / Objet / Vue** (comme la barre Blender)
- Raccourcis : W/G/R/S, E/I/B, X, Shift+D, Shift+A, Ctrl+Z/Y/S, Tab, F, Z, Alt+Z, 1/3/5/7, Ctrl+A

### Mobile First
- **Bottom Nav :** Vue, Outils, Ajouter, Props, Rendu
- **Sheets tactiles** qui glissent depuis le bas
- **Context Menu** long press ou clic droit (Dupliquer, Supprimer, Masquer, Focus, Shade Smooth/Flat)

## 🧱 Architecture

```
src/
  state.js         État global pur (sélection, modes)
  ctx.js           Singletons : scène, caméras (persp/ortho), renderer, contrôles, lumières
  geometry.js      Opérations topologiques pures (groupes de positions, subdivision,
                   lissage laplacien, solidify, extrudeFaces, insetFaces)
  objects.js       Factories, sélection multiple, modificateurs (pile non destructive)
  persistence.js   Sérialisation JSON, undo/redo par snapshots, save/load
  editMode.js      Mode Édition : points soudés instanciés (1 draw call), extrusion/inset
  sculpt.js        Mode Sculpture par groupes de positions
  ui.js            Menus, outliner, panneaux, shading, gizmo de navigation, vues
  renderExport.js  Rendu final (renderer persistant) + export GLTF propre
  interact.js      Pointer/tactile/clavier, outils, pivot multi-sélection
  main.js          Assemblage + boucle d'animation
tests/
  geometry.test.mjs       32 assertions topologiques (Node, sans DOM)
  integration.test.mjs    48 assertions end-to-end (jsdom + WebGL stubbé)
  shim/, loader.mjs       Shim de three (WebGLRenderer stubbé) pour les tests Node
```

## 🧪 Tests

```bash
npm install
npm test        # 32 + 48 assertions (géométrie + intégration)
npm run build   # bundle production
```

Le test d'intégration charge la vraie app dans jsdom (seul `WebGLRenderer`
est stubbé) et vérifie : undo/redo, les 5 modificateurs (topologie exacte),
le mode Édition soudé, l'extrusion/inset réelles, la duplication multi,
la sérialisation, les menus, le shading, l'ortho…

## ⚠️ Limites connues (honnêteté)

- **Bevel** est une approximation (subdivision + lissage), pas un chanfrein exact
- **Loop Cut** n'est pas implémenté (bouton désactivé)
- **Suzanne** est un icosaèdre déformé, pas la vraie Suzanne
- Le **Smooth** de sculpture et l'inset multi-faces restent des approximations
- Snapping, édition proportionnelle et mode Edge : à venir
