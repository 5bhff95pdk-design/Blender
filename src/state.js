// ---------- App State ----------
// État global de l'application. Pur : aucune dépendance DOM ou scène.

export const State = {
  mode: 'OBJECT',            // OBJECT | EDIT | SCULPT
  tool: 'select',            // select, move, rotate, scale, extrude, inset, bevel, sculpt-*, cursor, measure
  shade: 'solid',            // solid | wireframe | material | rendered
  selected: null,            // sélection primaire (Object3D)
  selection: new Set(),      // sélection multiple (contient aussi State.selected)
  objects: [],               // tous les objets ajoutés par l'utilisateur
  history: [],               // journal d'affichage
  sculpt: {
    brush: 'draw',
    radius: 0.3,
    strength: 0.5,
  },
  edit: {
    selectionMode: 'vertex', // vertex | face
    selectedGroups: new Set(),  // groupes de positions soudés (mode Édition)
    selectedFaces: new Set(),   // indices de triangles (mode Édition, mode face)
  },
  xray: false,
  ortho: false,
  snap: false,
};

export function clearSelection() {
  State.selection.clear();
  State.selected = null;
}

export function select(obj, { additive = false } = {}) {
  if (!additive) {
    State.selection.clear();
  }
  if (obj) {
    State.selection.add(obj);
    State.selected = obj;
  } else {
    State.selected = null;
  }
}

export function isSelected(obj) {
  return State.selection.has(obj);
}

export function selectedMeshes() {
  return [...State.selection].filter((o) => o.isMesh);
}
