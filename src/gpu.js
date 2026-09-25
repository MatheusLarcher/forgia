import * as THREE from 'three';

// Criação centralizada dos renderizadores WebGL: pede a GPU mais forte e cai
// para renderização por software (SwiftShader/driver fraco) quando preciso.

export class GpuUnavailableError extends Error {
  constructor(cause) {
    super('WebGL indisponível neste computador');
    this.name = 'GpuUnavailableError';
    this.cause = cause;
  }
}

// mode: null (ainda não criado) | 'gpu' | 'software' | 'none'
export const gpuInfo = { mode: null, renderer: null };

function rendererName(gl) {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return (ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || 'desconhecida';
}

function register(renderer, mode) {
  if (gpuInfo.mode) return;
  gpuInfo.mode = mode;
  try {
    gpuInfo.renderer = rendererName(renderer.getContext());
  } catch {
    gpuInfo.renderer = 'desconhecida';
  }
}

export function createRenderer(params = {}) {
  const base = { ...params, powerPreference: 'high-performance' };
  // já caiu para software antes: não repete a tentativa que falha
  if (gpuInfo.mode !== 'software') {
    try {
      const r = new THREE.WebGLRenderer({ ...base, failIfMajorPerformanceCaveat: true });
      register(r, 'gpu');
      return r;
    } catch {
      // sem aceleração de hardware: tenta por software abaixo
    }
  }
  try {
    const r = new THREE.WebGLRenderer(base);
    register(r, 'software');
    return r;
  } catch (err) {
    if (!gpuInfo.mode) gpuInfo.mode = 'none';
    throw new GpuUnavailableError(err);
  }
}
