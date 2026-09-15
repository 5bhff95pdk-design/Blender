# Blender Mobile — Clone Tactile

Blender pour mobile, utilisable au tactile, directement dans ton navigateur.

**Live Preview:** https://5173-iufvn9lli7j8gogk3ej3f.e2b.app (si tu es dans Arena) ou `npm run dev`

## 🎯 Fonctionnalités Blender

### Viewport 3D (comme Blender)
- **Orbit tactile:** 1 doigt = sélection, 2 doigts = orbite / zoom / pan
- **Grille + Axes** comme Blender
- **Curseur 3D** animé
- **Modes d'ombrage:** Solid, Wireframe, Material, Rendered
- **X-Ray (Alt+Z)** et **Focus (Numpad .)** 
- **FPS counter + Stats** (verts, tris, objets)

### Modes (comme Blender)
1. **Mode Objet:** Sélection, transformation, duplication
2. **Mode Édition:** Édition de vertices (sélection, déplacement, extrusion)
3. **Mode Sculpture:** Brushes Draw, Smooth, Inflate, Grab

### Outils Blender
- **Select (W), Move (G), Rotate (R), Scale (S)** avec gizmo TransformControls
- **Extrude (E), Inset (I), Bevel (Ctrl+B), Loop Cut**
- **Sculpt Brushes** avec radius et strength
- **Mesure, Curseur**

### Ajouter (Shift+A)
- **Mesh:** Cube, UV Sphere, Ico Sphere, Cylindre, Plan, Tore, Cône, Suzanne (monkey)
- **Lumière:** Point, Soleil, Spot (avec ombres)
- **Caméra**

### Propriétés (panneau droit)
- **Outliner:** Liste objets, visibilité, historique
- **Objet:** Nom, Position/Rotation/Échelle avec axes colorés (R,G,B), duplication, suppression, centrer origine
- **Matériau:** Couleur base, metallic, roughness, émissive + preview
- **Modificateurs:** Subdivision, Miroir, Réseau (Array), Solidify, Bevel
- **Monde:** Couleur fond, intensité HDRI, grille, axes, ombres

### Rendu
- **Rendu Cycles Mobile:** 1920x1080 haute qualité avec tonemapping ACES
- **Sauvegarder Image** PNG
- **Exporter GLTF** pour usage externe
- Overlay rendu avec infos

### Mobile First
- **Bottom Nav:** Vue, Outils, Ajouter, Props, Rendu
- **Sheets tactiles** qui glissent depuis le bas
- **Add Menu** adaptatif
- **Context Menu** long press (Dupliquer, Supprimer, Focus, Shade Smooth/Flat)
- **Toast notifications** style Blender
- **Responsive:** Desktop = layout Blender classique (left toolbar, right panel, bottom bar), Mobile = bottom nav + sheets
- **PWA Ready:** manifest.json, installable sur écran d'accueil

### Raccourcis Blender
- `G` = Move, `R` = Rotate, `S` = Scale
- `Tab` = Toggle Object/Edit
- `Shift+A` = Add Menu
- `X` / `Delete` = Supprimer
- `Ctrl+Z` = Undo (à venir)
- Clic vide = garde sélection (comme Blender)
- Long press = context menu

## 🚀 Lancer

```bash
npm install
npm run dev
# ouvre http://localhost:5173
```

Build:
```bash
npm run build
npm run preview
```

## 🛠 Stack
- Three.js 0.160 + OrbitControls + TransformControls + GLTFExporter
- Vite 5
- Vanilla JS, CSS pur (thème Blender dark #1e1e1e, accent #eb7700)

## 📱 Utilisation Mobile
1. **1 doigt tap** = sélectionner objet
2. **Drag gizmo** = déplacer/rotater/scaler
3. **2 doigts drag** = orbiter
4. **2 doigts pinch** = zoom
5. **Long press** = menu contextuel
6. **Bottom nav** = accès rapide

C'est Blender dans ta poche. Modélise, sculpte, rends, exporte — tout au tactile.

Fait avec ❤️ pour mobile.
