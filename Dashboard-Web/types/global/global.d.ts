interface ANGLE_instanced_arrays {
  drawArraysInstanced(mode: number, first: number, count: number, instanceCount: number): void;
  drawElementsInstanced(mode: number, count: number, type: number, offset: number, instanceCount: number): void;
  vertexAttribDivisor(index: number, divisor: number): void;
}

interface EXT_blend_minmax {
  MIN_EXT: number;
  MAX_EXT: number;
}

interface EXT_texture_filter_anisotropic {
  TEXTURE_MAX_ANISOTROPY_EXT: number;
  MAX_TEXTURE_MAX_ANISOTROPY_EXT: number;
}

interface OES_element_index_uint {}
interface OES_texture_float {}

interface OES_standard_derivatives {
  FRAGMENT_SHADER_DERIVATIVE_HINT_OES: number;
}

interface OES_texture_half_float {
  HALF_FLOAT_OES: number;
}

interface OES_vertex_array_object {
  VERTEX_ARRAY_BINDING_OES: number;
  createVertexArrayOES(): WebGLVertexArrayObject | null;
  deleteVertexArrayOES(vertexArray: WebGLVertexArrayObject): void;
  isVertexArrayOES(vertexArray: WebGLVertexArrayObject): boolean;
  bindVertexArrayOES(vertexArray: WebGLVertexArrayObject | null): void;
}

interface WEBGL_compressed_texture_s3tc {
  COMPRESSED_RGB_S3TC_DXT1_EXT: number;
  COMPRESSED_RGBA_S3TC_DXT1_EXT: number;
  COMPRESSED_RGBA_S3TC_DXT3_EXT: number;
  COMPRESSED_RGBA_S3TC_DXT5_EXT: number;
}

interface WEBGL_depth_texture {
  UNSIGNED_INT_24_8_WEBGL: number;
}

interface WEBGL_draw_buffers {
  COLOR_ATTACHMENT0_WEBGL: number;
  COLOR_ATTACHMENT1_WEBGL: number;
  COLOR_ATTACHMENT2_WEBGL: number;
  COLOR_ATTACHMENT3_WEBGL: number;
  COLOR_ATTACHMENT4_WEBGL: number;
  COLOR_ATTACHMENT5_WEBGL: number;
  COLOR_ATTACHMENT6_WEBGL: number;
  COLOR_ATTACHMENT7_WEBGL: number;
  COLOR_ATTACHMENT8_WEBGL: number;
  COLOR_ATTACHMENT9_WEBGL: number;
  COLOR_ATTACHMENT10_WEBGL: number;
  COLOR_ATTACHMENT11_WEBGL: number;
  COLOR_ATTACHMENT12_WEBGL: number;
  COLOR_ATTACHMENT13_WEBGL: number;
  COLOR_ATTACHMENT14_WEBGL: number;
  COLOR_ATTACHMENT15_WEBGL: number;
  drawBuffersWEBGL(buffers: number[]): void;
}

interface WEBGL_lose_context {
  loseContext(): void;
  restoreContext(): void;
}

type WebGLExtensionMap = {
  'ANGLE_instanced_arrays': ANGLE_instanced_arrays;
  'EXT_blend_minmax': EXT_blend_minmax;
  'EXT_texture_filter_anisotropic': EXT_texture_filter_anisotropic;
  'OES_element_index_uint': OES_element_index_uint;
  'OES_standard_derivatives': OES_standard_derivatives;
  'OES_texture_float': OES_texture_float;
  'OES_texture_half_float': OES_texture_half_float;
  'OES_vertex_array_object': OES_vertex_array_object;
  'WEBGL_compressed_texture_s3tc': WEBGL_compressed_texture_s3tc;
  'WEBGL_depth_texture': WEBGL_depth_texture;
  'WEBGL_draw_buffers': WEBGL_draw_buffers;
  'WEBGL_lose_context': WEBGL_lose_context;
};

declare global {
  interface WebGLRenderingContext {
    getExtension<K extends keyof WebGLExtensionMap>(name: K): WebGLExtensionMap[K] | null;
  }
  interface WebGL2RenderingContext {
    getExtension<K extends keyof WebGLExtensionMap>(name: K): WebGLExtensionMap[K] | null;
  }

  /** pywebview injects this object on window at runtime when the page is hosted inside a pywebview window. */
  interface PyWebViewAPI {
    close_app_window?: () => void
    maximize_app_window?: () => void
    minimize_app_window?: () => void
  }

  interface Window {
    pywebview?: {
      api?: PyWebViewAPI
    }
  }
}

export {};