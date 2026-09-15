import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

import './style.css';

// ---------- App State ----------
const State = {
  mode: 'OBJECT', // OBJECT, EDIT, SCULPT
  tool: 'select', // select, move, rotate, scale, extrude, etc
  shade: 'solid',
  selected: null,
  objects: [],
  history: [],
  clipboard: null,
  sculpt: {
    brush: 'draw',
    radius: 0.3,
    strength: 0.5,
  },
  edit: {
    selectedVertices: new Set(),
    selectionMode: 'vertex' // vertex, edge, face
  }
};

// ---------- Scene Setup ----------
const canvas = document.getElementById('c');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#1a1a1e');
scene.fog = new THREE.Fog('#1a1a1e', 20, 60);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(3, 2.5, 4);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.outputColorSpace = THREE.SRGBColorSpace;

// Controls
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.08;
orbit.minDistance = 0.5;
orbit.maxDistance = 50;
orbit.target.set(0, 0.8, 0);
orbit.update();

const transform = new TransformControls(camera, renderer.domElement);
transform.addEventListener('dragging-changed', (e) => {
  orbit.enabled = !e.value;
  if (!e.value) pushHistory('Transform');
});
scene.add(transform.getHelper());

// Helpers
const grid = new THREE.GridHelper(20, 20, '#3a3a3a', '#2a2a2a');
grid.position.y = 0;
scene.add(grid);

const axes = new THREE.AxesHelper(1.5);
scene.add(axes);

// Lights - Studio setup like Blender
const ambient = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xfff2e0, 1.2);
keyLight.position.set(5, 8, 5);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 0.5;
keyLight.shadow.camera.far = 30;
keyLight.shadow.camera.left = -10;
keyLight.shadow.camera.right = 10;
keyLight.shadow.camera.top = 10;
keyLight.shadow.camera.bottom = -10;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xc2d6ff, 0.5);
fillLight.position.set(-4, 3, -3);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0xffffff, 0.3);
rimLight.position.set(0, 5, -5);
scene.add(rimLight);

// Cursor 3D (Blender style)
const cursorGroup = new THREE.Group();
const cursorRing = new THREE.Mesh(
  new THREE.RingGeometry(0.12, 0.14, 32),
  new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.8 })
);
cursorRing.rotation.x = Math.PI/2;
const cursorCrossX = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.02), new THREE.MeshBasicMaterial({ color: 0xff4444 }));
const cursorCrossY = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.4), new THREE.MeshBasicMaterial({ color: 0x44ff44 }));
const cursorCrossZ = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.4), new THREE.MeshBasicMaterial({ color: 0x4444ff }));
cursorCrossZ.rotation.z = Math.PI/2;
cursorGroup.add(cursorRing, cursorCrossX, cursorCrossY, cursorCrossZ);
cursorGroup.position.set(0, 0.01, 0);
scene.add(cursorGroup);

// ---------- Material System ----------
function createBlenderMaterial(color = '#ff8a2a', metallic = 0.1, roughness = 0.5) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    metalness: metallic,
    roughness: roughness,
    envMapIntensity: 0.8
  });
}

// ---------- Object Factory ----------
let objCounter = 0;

function makeObjectName(type) {
  objCounter++;
  return `${type}_${String(objCounter).padStart(3,'0')}`;
}

function addMesh(geometry, name, color) {
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
    materialProps: { color, metallic: 0.1, roughness: 0.5, emissive: '#000000' }
  };
  // Outline for selection
  const edges = new THREE.EdgesGeometry(geometry, 15);
  const lineMat = new THREE.LineBasicMaterial({ color: 0xeb7700, transparent: true, opacity: 0 });
  const outline = new THREE.LineSegments(edges, lineMat);
  outline.name = 'outline';
  mesh.add(outline);

  mesh.position.set((Math.random()-0.5)*0.5, 0.8 + Math.random()*0.3, (Math.random()-0.5)*0.5);
  
  scene.add(mesh);
  State.objects.push(mesh);
  selectObject(mesh);
  pushHistory(`Add ${name}`);
  updateOutliner();
  updateStats();
  showToast(`Ajouté: ${name}`);
  return mesh;
}

function addPrimitive(type) {
  let geo, name, color;
  const palette = ['#ff8a2a', '#4a90d9', '#6abf4b', '#d94a9a', '#ffd23d', '#8a6bff'];
  color = palette[Math.floor(Math.random()*palette.length)];

  switch(type) {
    case 'cube':
      geo = new THREE.BoxGeometry(1,1,1);
      name = makeObjectName('Cube');
      break;
    case 'sphere':
      geo = new THREE.SphereGeometry(0.6, 32, 32);
      name = makeObjectName('Sphere');
      break;
    case 'ico':
      geo = new THREE.IcosahedronGeometry(0.6, 2);
      name = makeObjectName('IcoSphere');
      break;
    case 'cylinder':
      geo = new THREE.CylinderGeometry(0.5,0.5,1.2,32);
      name = makeObjectName('Cylinder');
      break;
    case 'plane':
      geo = new THREE.PlaneGeometry(2,2,4,4);
      name = makeObjectName('Plane');
      break;
    case 'torus':
      geo = new THREE.TorusGeometry(0.5,0.2,16,48);
      name = makeObjectName('Torus');
      break;
    case 'cone':
      geo = new THREE.ConeGeometry(0.6,1.2,32);
      name = makeObjectName('Cone');
      break;
    case 'monkey':
      // Create Suzanne approximation with low poly monkey-like shape
      geo = new THREE.IcosahedronGeometry(0.6, 1);
      // Deform to look a bit like monkey
      const pos = geo.attributes.position;
      for(let i=0;i<pos.count;i++){
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        // Simple deformation
        pos.setXYZ(i, x*1.1, y*1.2 + (x>0?0.1:0), z*0.9);
      }
      pos.needsUpdate = true;
      name = makeObjectName('Suzanne');
      color = '#ff8a2a';
      break;
    default:
      geo = new THREE.BoxGeometry(1,1,1);
      name = makeObjectName('Cube');
  }
  return addMesh(geo, name, color);
}

function addLight(type) {
  let light, helper;
  const name = makeObjectName(type);
  if(type==='light-point'){
    light = new THREE.PointLight(0xffffff, 2, 10);
    light.position.set(2,3,2);
    light.castShadow = true;
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.08,16,16), new THREE.MeshBasicMaterial({color:0xffffaa}));
    light.add(sphere);
  } else if(type==='light-sun'){
    light = new THREE.DirectionalLight(0xffffff, 1.5);
    light.position.set(3,5,2);
    light.castShadow = true;
  } else if(type==='light-spot'){
    light = new THREE.SpotLight(0xffffff, 3, 15, Math.PI/6, 0.3);
    light.position.set(2,4,2);
    light.castShadow = true;
  }
  light.name = name;
  light.userData = { id: THREE.MathUtils.generateUUID(), type: 'LIGHT' };
  scene.add(light);
  State.objects.push(light);
  selectObject(light);
  updateOutliner();
  showToast(`Lumière ajoutée: ${name}`);
}

function addCamera() {
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  cam.position.set(4,3,4);
  cam.lookAt(0,0.8,0);
  cam.name = makeObjectName('Camera');
  cam.userData = { id: THREE.MathUtils.generateUUID(), type: 'CAMERA' };
  const helperGeo = new THREE.ConeGeometry(0.15,0.3,4);
  helperGeo.rotateX(Math.PI);
  const helper = new THREE.Mesh(helperGeo, new THREE.MeshBasicMaterial({color:0x222222, wireframe:true}));
  cam.add(helper);
  scene.add(cam);
  State.objects.push(cam);
  selectObject(cam);
  updateOutliner();
}

// ---------- Selection ----------
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let editHelpers = null;
let sculptMesh = null;

function getIntersects(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  const x = ((event.clientX ?? event.touches?.[0]?.clientX) - rect.left) / rect.width * 2 - 1;
  const y = -(((event.clientY ?? event.touches?.[0]?.clientY) - rect.top) / rect.height * 2 - 1);
  mouse.set(x,y);
  raycaster.setFromCamera(mouse, camera);
  const meshes = State.objects.filter(o => o.isMesh || o.isLight);
  return raycaster.intersectObjects(meshes, false);
}

function selectObject(obj) {
  // Deselect previous
  if(State.selected) {
    const prevOutline = State.selected.getObjectByName('outline');
    if(prevOutline) prevOutline.material.opacity = 0;
    if(State.selected.isMesh) State.selected.material.emissive?.setHex(0x000000);
  }
  State.selected = obj;
  if(obj) {
    transform.attach(obj);
    const outline = obj.getObjectByName('outline');
    if(outline) outline.material.opacity = 1;
    // Update UI
    document.getElementById('objName').value = obj.name;
    if(obj.isMesh) {
      document.getElementById('posX').value = obj.position.x.toFixed(2);
      document.getElementById('posY').value = obj.position.y.toFixed(2);
      document.getElementById('posZ').value = obj.position.z.toFixed(2);
      document.getElementById('rotX').value = THREE.MathUtils.radToDeg(obj.rotation.x).toFixed(0);
      document.getElementById('rotY').value = THREE.MathUtils.radToDeg(obj.rotation.y).toFixed(0);
      document.getElementById('rotZ').value = THREE.MathUtils.radToDeg(obj.rotation.z).toFixed(0);
      document.getElementById('scaleX').value = obj.scale.x.toFixed(2);
      document.getElementById('scaleY').value = obj.scale.y.toFixed(2);
      document.getElementById('scaleZ').value = obj.scale.z.toFixed(2);
      if(obj.userData.materialProps){
        document.getElementById('baseColor').value = obj.userData.materialProps.color;
        document.getElementById('metallic').value = obj.userData.materialProps.metallic;
        document.getElementById('roughness').value = obj.userData.materialProps.roughness;
        document.getElementById('emissiveColor').value = obj.userData.materialProps.emissive;
        document.getElementById('metalVal').textContent = obj.userData.materialProps.metallic;
        document.getElementById('roughVal').textContent = obj.userData.materialProps.roughness;
      }
    }
    document.getElementById('viewInfo').textContent = `Persp | ${State.shade} | ${obj.name}`;
  } else {
    transform.detach();
  }
  updateOutlinerSelection();
  updateModifiersUI();
}

function deleteSelected() {
  if(!State.selected) return;
  const idx = State.objects.indexOf(State.selected);
  if(idx>=0) State.objects.splice(idx,1);
  scene.remove(State.selected);
  transform.detach();
  State.selected = null;
  pushHistory('Delete');
  updateOutliner();
  updateStats();
  showToast('Objet supprimé');
}

function duplicateSelected() {
  if(!State.selected || !State.selected.isMesh) return;
  const clone = State.selected.clone();
  clone.geometry = State.selected.geometry.clone();
  clone.material = State.selected.material.clone();
  const outline = clone.getObjectByName('outline');
  if(outline) {
    outline.material = outline.material.clone();
    outline.material.opacity = 0;
  }
  clone.position.x += 0.5;
  clone.name = makeObjectName(State.selected.name.split('_')[0]);
  clone.userData = JSON.parse(JSON.stringify(State.selected.userData));
  clone.userData.id = THREE.MathUtils.generateUUID();
  scene.add(clone);
  State.objects.push(clone);
  selectObject(clone);
  pushHistory('Duplicate');
  updateOutliner();
  updateStats();
}

// ---------- Edit Mode ----------
function enterEditMode() {
  if(!State.selected || !State.selected.isMesh) {
    showToast('Sélectionnez un mesh d\'abord');
    document.getElementById('modeSelect').value = 'OBJECT';
    State.mode = 'OBJECT';
    document.body.className = '';
    return;
  }
  transform.detach();
  const mesh = State.selected;
  const geo = mesh.geometry;
  const posAttr = geo.attributes.position;
  
  // Create vertex helpers
  if(editHelpers) scene.remove(editHelpers);
  editHelpers = new THREE.Group();
  editHelpers.name = 'editHelpers';
  
  const vertexCount = posAttr.count;
  const vertices = [];
  for(let i=0;i<vertexCount;i++){
    const v = new THREE.Vector3().fromBufferAttribute(posAttr, i);
    v.applyMatrix4(mesh.matrixWorld);
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    sphere.position.copy(v);
    sphere.userData = { index: i, selected: false, originalPos: v.clone() };
    sphere.name = `v_${i}`;
    vertices.push(sphere);
    editHelpers.add(sphere);
  }
  
  // Edges
  const edgesGeo = new THREE.EdgesGeometry(geo);
  const edgesMat = new THREE.LineBasicMaterial({ color: 0x444444 });
  const edges = new THREE.LineSegments(edgesGeo, edgesMat);
  edges.applyMatrix4(mesh.matrixWorld);
  editHelpers.add(edges);
  
  scene.add(editHelpers);
  showToast(`Mode Édition: ${vertexCount} vertices`);
}

function exitEditMode() {
  if(editHelpers) {
    // Apply edits back to mesh
    if(State.selected && State.selected.isMesh && editHelpers) {
      const mesh = State.selected;
      const worldToLocal = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
      const posAttr = mesh.geometry.attributes.position;
      editHelpers.children.forEach(child => {
        if(child.userData.index !== undefined) {
          const worldPos = child.position.clone();
          const localPos = worldPos.applyMatrix4(worldToLocal);
          posAttr.setXYZ(child.userData.index, localPos.x, localPos.y, localPos.z);
        }
      });
      posAttr.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      // Update outline
      const outline = mesh.getObjectByName('outline');
      if(outline) {
        outline.geometry.dispose();
        outline.geometry = new THREE.EdgesGeometry(mesh.geometry, 15);
      }
    }
    scene.remove(editHelpers);
    editHelpers = null;
  }
  State.edit.selectedVertices.clear();
  if(State.selected) transform.attach(State.selected);
}

function updateEditSelection() {
  if(!editHelpers) return;
  editHelpers.children.forEach(c => {
    if(c.userData.index !== undefined) {
      const isSel = State.edit.selectedVertices.has(c.userData.index);
      c.material.color.set(isSel ? 0xeb7700 : 0xffffff);
      c.scale.setScalar(isSel ? 1.5 : 1);
    }
  });
}

// ---------- Sculpt Mode ----------
let isSculpting = false;
let lastSculptPos = null;

function enterSculptMode() {
  if(!State.selected || !State.selected.isMesh) {
    showToast('Sélectionnez un mesh pour sculpter');
    document.getElementById('modeSelect').value = 'OBJECT';
    State.mode = 'OBJECT';
    document.body.className = '';
    return;
  }
  transform.detach();
  sculptMesh = State.selected;
  // Ensure high poly for sculpt
  showToast(`Mode Sculpt: ${State.sculpt.brush} | Rayon ${State.sculpt.radius}`);
}

function exitSculptMode() {
  sculptMesh = null;
  isSculpting = false;
  if(State.selected) transform.attach(State.selected);
}

function sculptAt(point, normal) {
  if(!sculptMesh) return;
  const geo = sculptMesh.geometry;
  const pos = geo.attributes.position;
  const worldMatrix = sculptMesh.matrixWorld;
  const invMatrix = new THREE.Matrix4().copy(worldMatrix).invert();
  const localPoint = point.clone().applyMatrix4(invMatrix);
  const localNormal = normal.clone().transformDirection(invMatrix).normalize();
  
  const radiusSq = State.sculpt.radius * State.sculpt.radius;
  const strength = State.sculpt.strength * 0.02;
  
  for(let i=0;i<pos.count;i++){
    const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
    const vert = new THREE.Vector3(vx,vy,vz);
    const distSq = vert.distanceToSquared(localPoint);
    if(distSq < radiusSq) {
      const falloff = 1 - Math.sqrt(distSq) / State.sculpt.radius;
      const smoothFalloff = falloff * falloff * (3 - 2*falloff); // smoothstep
      if(State.sculpt.brush === 'draw') {
        vert.addScaledVector(localNormal, strength * smoothFalloff * 5);
      } else if(State.sculpt.brush === 'inflate') {
        const dir = vert.clone().normalize();
        vert.addScaledVector(dir, strength * smoothFalloff * 3);
      } else if(State.sculpt.brush === 'smooth') {
        // Simple laplacian smooth approximation
        vert.lerp(localPoint, strength * smoothFalloff * 0.1);
      } else if(State.sculpt.brush === 'grab') {
        if(lastSculptPos) {
          const delta = localPoint.clone().sub(lastSculptPos);
          vert.addScaledVector(delta, smoothFalloff);
        }
      }
      pos.setXYZ(i, vert.x, vert.y, vert.z);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  lastSculptPos = localPoint.clone();
}

// ---------- Modifiers ----------
function applyModifier(type) {
  if(!State.selected || !State.selected.isMesh) {
    showToast('Sélectionnez un mesh');
    return;
  }
  const mesh = State.selected;
  if(!mesh.userData.modifiers) mesh.userData.modifiers = [];
  mesh.userData.modifiers.push({ type, params: {} });
  
  if(type==='subsurf') {
    // Simple subdivision via Loop? Use fake by subdividing geometry
    const geo = mesh.geometry;
    const newGeo = geo.clone();
    // Increase detail by using subdivision modifier approximation
    // For demo, we use simple tessellation via merging
    newGeo.computeVertexNormals();
    mesh.geometry.dispose();
    mesh.geometry = newGeo;
    // Fake smooth
    mesh.geometry = new THREE.BufferGeometry().copy(newGeo);
    // Actually use Subdivision? We'll just add more segments for demo
    // Keep it simple: apply 1 level of Catmull-Clark via custom
    // For now, just smooth
    mesh.material.flatShading = false;
    mesh.geometry.computeVertexNormals();
  } else if(type==='mirror') {
    // Duplicate mirrored
    const mirrorMat = new THREE.Matrix4().makeScale(-1,1,1);
    const geo2 = mesh.geometry.clone();
    geo2.applyMatrix4(mirrorMat);
    const merged = mergeGeometries([mesh.geometry, geo2]);
    mesh.geometry.dispose();
    mesh.geometry = merged;
  } else if(type==='array') {
    const geos = [];
    for(let i=0;i<3;i++){
      const g = mesh.geometry.clone();
      g.translate(i*1.2,0,0);
      geos.push(g);
    }
    const merged = mergeGeometries(geos);
    mesh.geometry.dispose();
    mesh.geometry = merged;
  }
  mesh.geometry.computeVertexNormals();
  const outline = mesh.getObjectByName('outline');
  if(outline) {
    outline.geometry.dispose();
    outline.geometry = new THREE.EdgesGeometry(mesh.geometry, 15);
  }
  updateModifiersUI();
  pushHistory(`Modifier ${type}`);
  showToast(`Modificateur ${type} appliqué`);
  updateStats();
}

function mergeGeometries(geometries) {
  // Simple merge
  let totalVerts = 0;
  geometries.forEach(g => totalVerts += g.attributes.position.count);
  const mergedPos = new Float32Array(totalVerts*3);
  const mergedNorm = new Float32Array(totalVerts*3);
  const mergedUv = new Float32Array(totalVerts*2);
  let offset = 0;
  geometries.forEach(g => {
    const pos = g.attributes.position;
    const norm = g.attributes.normal;
    const uv = g.attributes.uv;
    for(let i=0;i<pos.count;i++){
      mergedPos[(offset+i)*3] = pos.getX(i);
      mergedPos[(offset+i)*3+1] = pos.getY(i);
      mergedPos[(offset+i)*3+2] = pos.getZ(i);
      if(norm) {
        mergedNorm[(offset+i)*3] = norm.getX(i);
        mergedNorm[(offset+i)*3+1] = norm.getY(i);
        mergedNorm[(offset+i)*3+2] = norm.getZ(i);
      }
      if(uv) {
        mergedUv[(offset+i)*2] = uv.getX(i);
        mergedUv[(offset+i)*2+1] = uv.getY(i);
      }
    }
    offset += pos.count;
  });
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(mergedPos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(mergedNorm, 3));
  if(mergedUv[0]!==undefined) merged.setAttribute('uv', new THREE.BufferAttribute(mergedUv, 2));
  return merged;
}

// ---------- History ----------
function pushHistory(action) {
  State.history.unshift({ action, time: new Date().toLocaleTimeString() });
  if(State.history.length>30) State.history.pop();
  updateHistoryUI();
}

function updateHistoryUI() {
  const el = document.getElementById('historyList');
  el.innerHTML = State.history.map(h => `<div class="history-item">${h.time} — ${h.action}</div>`).join('');
}

// ---------- Outliner ----------
function updateOutliner() {
  const list = document.getElementById('outlinerList');
  list.innerHTML = State.objects.map(obj => {
    const icon = obj.isMesh ? '◫' : obj.isLight ? '☀' : '◎';
    const sel = State.selected===obj ? 'selected' : '';
    return `<div class="outliner-item ${sel}" data-id="${obj.userData.id}">
      <span class="oi-icon">${icon}</span>
      <span class="oi-name">${obj.name}</span>
      <span class="oi-vis">👁</span>
    </div>`;
  }).join('');
  // Add events
  list.querySelectorAll('.outliner-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      const obj = State.objects.find(o => o.userData.id===id);
      if(obj) selectObject(obj);
    });
  });
}

function updateOutlinerSelection() {
  document.querySelectorAll('.outliner-item').forEach(el => {
    const isSel = State.objects.find(o => o.userData.id===el.dataset.id) === State.selected;
    el.classList.toggle('selected', isSel);
  });
}

function updateStats() {
  let verts = 0, faces = 0, tris = 0;
  State.objects.forEach(o => {
    if(o.isMesh && o.geometry) {
      const pos = o.geometry.attributes.position;
      if(pos) verts += pos.count;
      if(o.geometry.index) tris += o.geometry.index.count/3;
      else tris += pos.count/3;
      faces += Math.floor(tris); // approx
    }
  });
  document.getElementById('stats').textContent = `Verts: ${verts} | Tris: ${Math.floor(tris)} | Objets: ${State.objects.length}`;
}

// ---------- Modifiers UI ----------
function updateModifiersUI() {
  const list = document.getElementById('modifierList');
  if(!State.selected || !State.selected.userData.modifiers) {
    list.innerHTML = '<div style="color:var(--text-dim);font-size:11px;padding:8px;">Aucun modificateur</div>';
    return;
  }
  list.innerHTML = State.selected.userData.modifiers.map((m,i) => `
    <div class="mat-item">
      <span class="oi-icon">🔧</span>
      <span style="flex:1;font-size:12px;">${m.type}</span>
      <button class="small-btn" onclick="this.closest('.mat-item').remove()">✕</button>
    </div>
  `).join('');
}

// ---------- UI Events ----------
function setupUI() {
  // Mode
  document.getElementById('modeSelect').addEventListener('change', (e) => {
    const prevMode = State.mode;
    if(prevMode==='EDIT') exitEditMode();
    if(prevMode==='SCULPT') exitSculptMode();
    State.mode = e.target.value;
    document.body.className = `mode-${State.mode.toLowerCase()}`;
    if(State.mode==='EDIT') enterEditMode();
    if(State.mode==='SCULPT') enterSculptMode();
    showToast(`Mode: ${State.mode}`);
  });

  // Shading
  document.querySelectorAll('.shade-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.shade-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      State.shade = btn.dataset.shade;
      if(State.shade==='wireframe') {
        State.objects.forEach(o => { if(o.isMesh) o.material.wireframe = true; });
      } else {
        State.objects.forEach(o => { if(o.isMesh) o.material.wireframe = false; });
      }
      if(State.shade==='rendered') {
        scene.background = new THREE.Color('#0a0a0a');
      } else {
        scene.background = new THREE.Color('#1a1a1e');
      }
    });
  });

  // Tools
  function setTool(tool) {
    State.tool = tool;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool===tool));
    // Update transform controls
    if(['move','rotate','scale'].includes(tool)) {
      transform.setMode(tool==='move'?'translate':tool);
      transform.enabled = true;
      if(State.selected) transform.attach(State.selected);
    } else if(tool==='select') {
      transform.enabled = false;
      transform.detach();
      if(State.selected) transform.attach(State.selected); // keep but disabled? Actually detach for select
      transform.detach();
    } else if(tool.startsWith('sculpt-')) {
      State.sculpt.brush = tool.replace('sculpt-','');
      showToast(`Pinceau: ${State.sculpt.brush}`);
    }
    // Handle other tools
    if(tool==='extrude' && State.mode==='EDIT') {
      showToast('Extrusion: déplacez les vertices sélectionnés');
      // Simple extrude: duplicate selected verts
      if(State.edit.selectedVertices.size>0 && State.selected) {
        const mesh = State.selected;
        const geo = mesh.geometry;
        const pos = geo.attributes.position;
        const newIndices = [];
        // For simplicity, just move selected verts up
        State.edit.selectedVertices.forEach(idx => {
          const v = new THREE.Vector3().fromBufferAttribute(pos, idx);
          v.y += 0.3;
          pos.setXYZ(idx, v.x, v.y, v.z);
        });
        pos.needsUpdate = true;
        geo.computeVertexNormals();
      }
    }
    if(tool==='transform') {
      transform.enabled = true;
      transform.setMode('translate');
    }
  }

  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  });

  // Add popup
  const addBtn = document.getElementById('addBtn');
  const addPopup = document.getElementById('addPopup');
  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    addPopup.classList.toggle('visible');
  });
  document.addEventListener('click', () => addPopup.classList.remove('visible'));
  addPopup.addEventListener('click', e => e.stopPropagation());
  
  addPopup.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      const type = b.dataset.add;
      if(type.startsWith('light-')) addLight(type);
      else if(type==='camera') addCamera();
      else addPrimitive(type);
      addPopup.classList.remove('visible');
    });
  });

  // Properties
  document.getElementById('objName').addEventListener('change', (e) => {
    if(State.selected) { State.selected.name = e.target.value; updateOutliner(); }
  });
  ['posX','posY','posZ'].forEach((id,i) => {
    document.getElementById(id).addEventListener('input', (e) => {
      if(State.selected) {
        State.selected.position[['x','y','z'][i]] = parseFloat(e.target.value);
      }
    });
  });
  ['rotX','rotY','rotZ'].forEach((id,i) => {
    document.getElementById(id).addEventListener('input', (e) => {
      if(State.selected) {
        State.selected.rotation[['x','y','z'][i]] = THREE.MathUtils.degToRad(parseFloat(e.target.value));
      }
    });
  });
  ['scaleX','scaleY','scaleZ'].forEach((id,i) => {
    document.getElementById(id).addEventListener('input', (e) => {
      if(State.selected) {
        State.selected.scale[['x','y','z'][i]] = parseFloat(e.target.value);
      }
    });
  });

  document.getElementById('baseColor').addEventListener('input', (e) => {
    if(State.selected && State.selected.isMesh) {
      State.selected.material.color.set(e.target.value);
      State.selected.userData.materialProps.color = e.target.value;
      updateMaterialList();
    }
  });
  document.getElementById('metallic').addEventListener('input', (e) => {
    if(State.selected && State.selected.isMesh) {
      State.selected.material.metalness = parseFloat(e.target.value);
      State.selected.userData.materialProps.metallic = parseFloat(e.target.value);
      document.getElementById('metalVal').textContent = e.target.value;
    }
  });
  document.getElementById('roughness').addEventListener('input', (e) => {
    if(State.selected && State.selected.isMesh) {
      State.selected.material.roughness = parseFloat(e.target.value);
      State.selected.userData.materialProps.roughness = parseFloat(e.target.value);
      document.getElementById('roughVal').textContent = e.target.value;
    }
  });
  document.getElementById('emissiveColor').addEventListener('input', (e) => {
    if(State.selected && State.selected.isMesh) {
      State.selected.material.emissive.set(e.target.value);
      State.selected.userData.materialProps.emissive = e.target.value;
    }
  });

  document.getElementById('worldColor').addEventListener('input', (e) => {
    scene.background = new THREE.Color(e.target.value);
  });
  document.getElementById('showGrid').addEventListener('change', (e) => grid.visible = e.target.checked);
  document.getElementById('showAxes').addEventListener('change', (e) => axes.visible = e.target.checked);
  document.getElementById('showShadows').addEventListener('change', (e) => {
    renderer.shadowMap.enabled = e.target.checked;
  });

  // Actions
  document.getElementById('deleteBtn').addEventListener('click', deleteSelected);
  document.getElementById('duplicateBtn').addEventListener('click', duplicateSelected);
  document.getElementById('centerBtn').addEventListener('click', () => {
    if(State.selected) {
      State.selected.geometry.center();
      showToast('Origine centrée');
    }
  });

  document.querySelectorAll('.mod-btn').forEach(btn => {
    btn.addEventListener('click', () => applyModifier(btn.dataset.mod));
  });

  document.getElementById('newMatBtn').addEventListener('click', () => {
    if(State.selected && State.selected.isMesh) {
      const newMat = createBlenderMaterial('#'+Math.floor(Math.random()*16777215).toString(16));
      State.selected.material = newMat;
      showToast('Nouveau matériau');
    }
  });

  // Render
  document.getElementById('renderBtn').addEventListener('click', openRender);
  document.getElementById('closeRenderBtn').addEventListener('click', closeRender);
  document.getElementById('saveRenderBtn').addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = 'blender-mobile-render.png';
    link.href = document.getElementById('renderCanvas').toDataURL();
    link.click();
  });
  document.getElementById('exportGltfBtn').addEventListener('click', exportGltf);

  // View controls
  document.getElementById('focusBtn').addEventListener('click', () => {
    if(State.selected) {
      orbit.target.copy(State.selected.position);
      orbit.target.y += 0.5;
      orbit.update();
    }
  });
  document.getElementById('orthoBtn').addEventListener('click', () => {
    if(camera.isPerspectiveCamera) {
      // Switch to ortho
      const aspect = window.innerWidth/window.innerHeight;
      const ortho = new THREE.OrthographicCamera(-5*aspect, 5*aspect, 5, -5, 0.1, 100);
      ortho.position.copy(camera.position);
      ortho.quaternion.copy(camera.quaternion);
      // Replace camera? For simplicity toggle fov
      camera.fov = camera.fov===50?15:50;
      camera.updateProjectionMatrix();
      showToast(`FOV: ${camera.fov}°`);
    }
  });
  document.getElementById('xrayBtn').addEventListener('click', (e) => {
    e.target.classList.toggle('active');
    const xray = e.target.classList.contains('active');
    State.objects.forEach(o => {
      if(o.isMesh) {
        o.material.transparent = xray;
        o.material.opacity = xray?0.5:1;
        o.material.depthTest = !xray;
      }
    });
  });

  // Right panel tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
      document.querySelectorAll('.panel-section').forEach(s=>s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  document.getElementById('toggleRightBtn').addEventListener('click', () => {
    document.getElementById('rightPanel').classList.toggle('visible');
  });

  // Mobile nav
  document.querySelectorAll('.mnav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mnav-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.mtab;
      const sheet = document.getElementById('mobileSheetTools');
      if(tab==='tools') {
        sheet.classList.toggle('visible');
        // Populate mobile tools
        const grid = document.getElementById('mobileToolsGrid');
        grid.innerHTML = document.getElementById('leftToolbar').innerHTML;
        grid.querySelectorAll('.tool-btn').forEach(b => {
          b.addEventListener('click', () => {
            setTool(b.dataset.tool);
            sheet.classList.remove('visible');
          });
        });
      } else if(tab==='add') {
        addPopup.classList.add('visible');
      } else if(tab==='props') {
        document.getElementById('rightPanel').classList.add('visible');
      } else if(tab==='render') {
        openRender();
      } else {
        sheet.classList.remove('visible');
        document.getElementById('rightPanel').classList.remove('visible');
      }
    });
  });

  // Context menu
  const ctxMenu = document.getElementById('contextMenu');
  renderer.domElement.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const hits = getIntersects(e);
    if(hits.length>0) {
      selectObject(hits[0].object);
      ctxMenu.style.left = e.clientX+'px';
      ctxMenu.style.top = e.clientY+'px';
      ctxMenu.classList.add('visible');
    }
  });
  document.addEventListener('click', () => ctxMenu.classList.remove('visible'));
  ctxMenu.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      const action = b.dataset.action;
      if(action==='delete') deleteSelected();
      if(action==='duplicate') duplicateSelected();
      if(action==='focus') document.getElementById('focusBtn').click();
      if(action==='shade-smooth' && State.selected?.isMesh) {
        State.selected.geometry.computeVertexNormals();
        showToast('Ombrage lissé');
      }
      if(action==='shade-flat' && State.selected?.isMesh) {
        State.selected.material.flatShading = true;
        State.selected.material.needsUpdate = true;
        showToast('Ombrage plat');
      }
      ctxMenu.classList.remove('visible');
    });
  });

  // Keyboard shortcuts like Blender
  window.addEventListener('keydown', (e) => {
    if(e.target.tagName==='INPUT') return;
    if(e.key==='x' || e.key==='X' || e.key==='Delete') { if(State.mode==='OBJECT') deleteSelected(); }
    if(e.key==='g' || e.key==='G') setTool('move');
    if(e.key==='r' || e.key==='R') setTool('rotate');
    if(e.key==='s' || e.key==='S') setTool('scale');
    if(e.key==='Tab') {
      e.preventDefault();
      const sel = document.getElementById('modeSelect');
      sel.value = sel.value==='OBJECT'?'EDIT':'OBJECT';
      sel.dispatchEvent(new Event('change'));
    }
    if((e.shiftKey && e.key==='A') || (e.shiftKey && e.key==='a')) {
      addPopup.classList.add('visible');
    }
    if(e.ctrlKey && e.key==='z') {
      showToast('Undo (à venir)');
    }
  });
}

function updateMaterialList() {
  const list = document.getElementById('materialList');
  if(!State.selected || !State.selected.isMesh) {
    list.innerHTML = '';
    return;
  }
  const mat = State.selected.material;
  const color = '#'+mat.color.getHexString();
  list.innerHTML = `<div class="mat-item active"><div class="mat-preview" style="background:${color}"></div><span style="flex:1;font-size:12px;">${State.selected.name}_Mat</span></div>`;
}

// ---------- Render System ----------
function openRender() {
  const overlay = document.getElementById('renderOverlay');
  const renderCanvas = document.getElementById('renderCanvas');
  overlay.classList.add('visible');
  
  // High quality render
  const prevWidth = renderer.domElement.width;
  const prevHeight = renderer.domElement.height;
  
  // Create offscreen renderer for final image
  const rCanvas = renderCanvas;
  rCanvas.width = 1920;
  rCanvas.height = 1080;
  const rRenderer = new THREE.WebGLRenderer({ canvas: rCanvas, antialias: true, preserveDrawingBuffer: true });
  rRenderer.setSize(1920,1080,false);
  rRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  rRenderer.toneMappingExposure = 1.2;
  rRenderer.shadowMap.enabled = true;
  rRenderer.outputColorSpace = THREE.SRGBColorSpace;
  
  const rCamera = camera.clone();
  rCamera.aspect = 1920/1080;
  rCamera.updateProjectionMatrix();
  
  // Boost lights for render
  const originalBg = scene.background.clone();
  scene.background = new THREE.Color('#0a0a0e');
  
  rRenderer.render(scene, rCamera);
  
  document.getElementById('renderInfo').textContent = `1920x1080 | ${State.objects.length} objets | Cycles Mobile`;
  
  scene.background = originalBg;
  showToast('Rendu terminé');
}

function closeRender() {
  document.getElementById('renderOverlay').classList.remove('visible');
}

function exportGltf() {
  const exporter = new GLTFExporter();
  exporter.parse(scene, (gltf) => {
    const blob = new Blob([JSON.stringify(gltf)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'blender-mobile-export.gltf';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Export GLTF');
  }, undefined, { binary: false });
}

// ---------- Toast ----------
function showToast(msg, duration=2500) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('visible');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.remove('visible'), duration);
}

// ---------- Interaction Handlers ----------
function setupInteraction() {
  let isDragging = false;
  let longPressTimer = null;
  let startPos = null;

  renderer.domElement.addEventListener('pointerdown', (e) => {
    isDragging = false;
    startPos = { x: e.clientX, y: e.clientY };
    
    // Sculpt mode handling
    if(State.mode==='SCULPT' && State.selected?.isMesh) {
      isSculpting = true;
      lastSculptPos = null;
      const hits = getIntersects(e);
      if(hits.length>0 && hits[0].object===sculptMesh) {
        sculptAt(hits[0].point, hits[0].face.normal);
      }
      orbit.enabled = false;
      return;
    }

    // Edit mode vertex selection
    if(State.mode==='EDIT' && editHelpers) {
      const rect = renderer.domElement.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height * 2 - 1);
      mouse.set(x,y);
      raycaster.setFromCamera(mouse, camera);
      const verts = editHelpers.children.filter(c => c.userData.index!==undefined);
      const hits = raycaster.intersectObjects(verts);
      if(hits.length>0) {
        const idx = hits[0].object.userData.index;
        if(e.shiftKey) {
          if(State.edit.selectedVertices.has(idx)) State.edit.selectedVertices.delete(idx);
          else State.edit.selectedVertices.add(idx);
        } else {
          State.edit.selectedVertices.clear();
          State.edit.selectedVertices.add(idx);
        }
        updateEditSelection();
        orbit.enabled = false;
        // Start drag for vertex
        const plane = new THREE.Plane(new THREE.Vector3(0,1,0), 0);
        // Simple drag logic
        const onMove = (ev) => {
          const rect = renderer.domElement.getBoundingClientRect();
          const mx = (ev.clientX - rect.left) / rect.width * 2 - 1;
          const my = -((ev.clientY - rect.top) / rect.height * 2 - 1);
          mouse.set(mx,my);
          raycaster.setFromCamera(mouse, camera);
          // Project onto plane through selected verts average
          const avg = new THREE.Vector3();
          let count=0;
          State.edit.selectedVertices.forEach(i => {
            const v = editHelpers.children.find(c => c.userData.index===i);
            if(v) { avg.add(v.position); count++; }
          });
          if(count>0) avg.divideScalar(count);
          const plane = new THREE.Plane(new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion).normalize(), -avg.dot(new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion).normalize()));
          // Actually use camera-facing plane
          const camDir = new THREE.Vector3();
          camera.getWorldDirection(camDir);
          const dragPlane = new THREE.Plane(camDir.clone().negate(), -avg.dot(camDir.clone().negate()));
          const intersect = new THREE.Vector3();
          raycaster.ray.intersectPlane(dragPlane, intersect);
          // Move selected verts
          const delta = intersect.clone().sub(avg);
          State.edit.selectedVertices.forEach(i => {
            const v = editHelpers.children.find(c => c.userData.index===i);
            if(v) {
              v.position.add(delta);
            }
          });
          // Update avg for next frame
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          orbit.enabled = true;
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        return;
      }
    }

    // Object mode selection
    if(State.mode==='OBJECT' && State.tool==='select') {
      // Long press detection for context menu on mobile
      longPressTimer = setTimeout(() => {
        const hits = getIntersects(e);
        if(hits.length>0) {
          selectObject(hits[0].object);
          const ctxMenu = document.getElementById('contextMenu');
          ctxMenu.style.left = e.clientX+'px';
          ctxMenu.style.top = e.clientY+'px';
          ctxMenu.classList.add('visible');
        }
      }, 600);
    }
  });

  renderer.domElement.addEventListener('pointermove', (e) => {
    if(startPos) {
      const dist = Math.hypot(e.clientX-startPos.x, e.clientY-startPos.y);
      if(dist>5) isDragging = true;
      if(dist>10 && longPressTimer) { clearTimeout(longPressTimer); longPressTimer=null; }
    }
    
    if(isSculpting && State.mode==='SCULPT') {
      const hits = getIntersects(e);
      if(hits.length>0 && hits[0].object===sculptMesh) {
        sculptAt(hits[0].point, hits[0].face.normal);
      }
    }
  });

  renderer.domElement.addEventListener('pointerup', (e) => {
    if(longPressTimer) { clearTimeout(longPressTimer); longPressTimer=null; }
    
    if(isSculpting) {
      isSculpting = false;
      orbit.enabled = true;
      pushHistory('Sculpt');
      return;
    }

    if(!isDragging && State.mode==='OBJECT' && State.tool==='select') {
      const hits = getIntersects(e);
      if(hits.length>0) {
        // Ignore if transform control hit
        if(!transform.dragging) selectObject(hits[0].object);
      } else {
        // Click empty -> deselect? Keep selection for Blender feel
        // transform.detach();
      }
    }
    isDragging = false;
    startPos = null;
  });

  // Touch gestures for mobile
  let lastTouchDist = 0;
  renderer.domElement.addEventListener('touchstart', (e) => {
    if(e.touches.length===2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastTouchDist = Math.hypot(dx,dy);
    }
  }, { passive: false });

  renderer.domElement.addEventListener('touchmove', (e) => {
    if(e.touches.length===2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx,dy);
      const delta = dist - lastTouchDist;
      camera.position.addScaledVector(camera.getWorldDirection(new THREE.Vector3()), delta*0.01);
      lastTouchDist = dist;
    }
  }, { passive: false });
}

// ---------- Animation Loop ----------
let lastTime = 0;
let frameCount = 0;
let lastFpsTime = 0;

function animate(time) {
  requestAnimationFrame(animate);
  
  const dt = time - lastTime;
  lastTime = time;
  
  // FPS counter
  frameCount++;
  if(time - lastFpsTime > 1000) {
    document.getElementById('fpsCounter').textContent = `${frameCount} fps`;
    frameCount = 0;
    lastFpsTime = time;
  }
  
  orbit.update();
  
  // Animate cursor
  cursorGroup.rotation.y += 0.005;
  
  // Update HUD if transforming
  if(transform.dragging && State.selected) {
    document.getElementById('transformHud').classList.add('visible');
    document.getElementById('hudX').value = State.selected.position.x.toFixed(2);
    document.getElementById('hudY').value = State.selected.position.y.toFixed(2);
    document.getElementById('hudZ').value = State.selected.position.z.toFixed(2);
  } else {
    document.getElementById('transformHud').classList.remove('visible');
  }
  
  renderer.render(scene, camera);
}

// ---------- Resize ----------
function onResize() {
  const wrap = document.getElementById('viewportWrap');
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  camera.aspect = w/h;
  camera.updateProjectionMatrix();
  renderer.setSize(w,h);
}
window.addEventListener('resize', onResize);

// ---------- Init ----------
function init() {
  setupUI();
  setupInteraction();
  
  // Add default scene like Blender
  addPrimitive('cube');
  // Add subtle floor shadow catcher
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(20,20),
    new THREE.ShadowMaterial({ opacity: 0.15 })
  );
  floor.rotation.x = -Math.PI/2;
  floor.receiveShadow = true;
  floor.position.y = 0;
  scene.add(floor);
  
  // Add default light already in scene
  
  onResize();
  animate(0);
  
  updateOutliner();
  updateStats();
  pushHistory('Démarrage');
  
  // Hide touch hints after 5s
  setTimeout(() => {
    const hints = document.getElementById('touchHints');
    if(hints) hints.style.opacity = '0';
  }, 5000);
  
  showToast('Blender Mobile prêt — Touchez un objet pour le sélectionner', 3500);
  
  // PWA install prompt handling
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showToast('Installez Blender Mobile sur votre écran d\'accueil 📲');
  });
}

init();

// Expose for debugging
window.BlenderMobile = { scene, camera, renderer, State, addPrimitive, selectObject };
