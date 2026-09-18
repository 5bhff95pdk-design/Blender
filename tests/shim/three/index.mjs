// Shim three : tout est réexporté tel quel, SAUF WebGLRenderer (stub Node).
export * from 'three-real';
export class WebGLRenderer {
  constructor(params = {}) {
    this.domElement = params.canvas ?? {};
    this.shadowMap = { enabled: false, type: null, needsUpdate: false };
    this.toneMapping = 0;
    this.toneMappingExposure = 1;
    this.outputColorSpace = '';
  }
  setPixelRatio() {}
  setSize() {}
  render() {}
  dispose() {}
  forceContextLoss() {}
  getContext() { return { isContextLost: () => false }; }
}
export class PMREMGenerator {
  constructor() {}
  fromScene() { return { texture: { isTexture: true } }; }
  dispose() {}
}
