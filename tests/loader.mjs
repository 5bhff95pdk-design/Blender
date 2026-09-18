// Loader de test : redirige 'three' vers le shim (WebGLRenderer stubbé),
// 'three-real' vers le vrai package, et ignore les imports CSS.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHIM = path.join(ROOT, 'tests/shim/three');
const REAL = path.join(ROOT, 'node_modules/three');

export async function resolve(specifier, context, next) {
  if (specifier.endsWith('.css')) {
    return { url: 'data:text/javascript,export default {}', shortCircuit: true };
  }
  let target = null, rest = '';
  if (specifier === 'three') { target = SHIM; rest = '/index.mjs'; }
  else if (specifier.startsWith('three/')) { target = SHIM; rest = specifier.slice('three'.length); }
  else if (specifier === 'three-real') { target = REAL; rest = '/build/three.module.js'; }
  else if (specifier.startsWith('three-real/addons/')) { target = REAL; rest = '/examples/jsm' + specifier.slice('three-real/addons'.length); }
  else if (specifier.startsWith('three-real/')) { target = REAL; rest = specifier.slice('three-real'.length); }
  if (target) {
    if (!/\.(js|mjs)$/.test(rest)) rest += '.js';
    return { url: pathToFileURL(path.join(target, rest)).href, shortCircuit: true };
  }
  return next(specifier, context);
}
