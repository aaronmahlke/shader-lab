import type { GradientStop } from "../types";
import type { LayerInstance, LayerType, RenderPass } from "../types/editor";
import type { ModulationFn } from "../compiler/compile-passes";
import { buildLayerUniforms } from "../compiler/compile-passes";
import { buildUniversalUniforms, layerTimingFactor } from "../compiler/universal-uniforms";
import {
  textCacheKey,
  textSpecFromValues,
  type TextLayerSpec,
} from "./text-raster";
import type { ComponentSource, MediaSource } from "./component-source";
import { stbnFrameIndex } from "../modulation/stbn";
import {
  FRAG_SHADERS,
  GRADIENT_RESOLUTION,
  INT_UNIFORMS,
  RAW_VERT,
  STBN_LAYER_TYPES,
} from "../shaders";
import {
  createFBO,
  createFullscreenQuad,
  createProgram,
  destroyGlContext,
  hexToRGB,
  type GlContext,
} from "./gl-utils";
import { assignThreeDSlots, resolveSceneView } from "./threed-order";

export type GradientDataFactory = (stops: GradientStop[]) => Uint8Array;

/** Rasterized text: a DOM texture source (browser) or raw RGBA pixels (node). */
export type TextImageResult =
  | TexImageSource
  | { width: number; height: number; data: Uint8Array };

export type TextImageFactory = (
  spec: TextLayerSpec,
  width: number,
  height: number,
  contentScale: number,
) => TextImageResult | null;

export type TextTextureEntry = { key: string; texture: WebGLTexture };

export type ComponentTextureEntry = { version: number; texture: WebGLTexture };

export type MediaTextureEntry = { version: number; texture: WebGLTexture };

export type RenderPassContext = {
  gl: GlContext;
  width: number;
  height: number;
  time: number;
  scaleUniform: number;
  gradientTextures: Map<string, WebGLTexture>;
  stbnTexture: WebGLTexture | null;
  createGradientData: GradientDataFactory;
  /** Text rasterization (per-environment); text layers render black without it. */
  textTextures?: Map<string, TextTextureEntry>;
  createTextImage?: TextImageFactory;
  /** Host-pushed component captures; component layers render transparent without one. */
  componentSources?: Map<string, ComponentSource>;
  componentTextures?: Map<string, ComponentTextureEntry>;
  /** Host-pushed media frames; image/video layers render transparent without one. */
  mediaSources?: Map<string, MediaSource>;
  mediaTextures?: Map<string, MediaTextureEntry>;
  /** Buffer px per composition px — keeps text size resolution-independent. */
  contentScale?: number;
  findLayer?: (pass: RenderPass) => LayerInstance | undefined;
  getModulatedValue?: ModulationFn | null;
};

/** Zero out a layer's contribution while the playhead is outside its in/out window. */
function applyTimingGate(
  uniforms: Record<string, unknown>,
  layer: LayerInstance,
  pass: RenderPass,
  time: number,
): void {
  if (layerTimingFactor(layer, time) === 1) return;
  if (pass.layerType === "distortion") {
    uniforms.amplitude = 0;
  } else {
    uniforms.layerOpacity = 0;
  }
}

function resolvePassUniformValues(
  pass: RenderPass,
  ctx: RenderPassContext,
): Record<string, unknown> {
  if (pass.layerType === "resolve" || pass.layerType === "blit") return pass.uniforms;

  const layer = ctx.findLayer?.(pass);
  if (!layer) return { ...pass.uniforms };

  // Pass-graph only — not stored on layer templates.
  const isComposite = pass.layerType === "layerComposite" || pass.layerType === "layerComposite3d";
  const merged: Record<string, unknown> = isComposite
    ? buildUniversalUniforms(layer, ctx.getModulatedValue ?? null)
    : buildLayerUniforms(layer, ctx.getModulatedValue ?? null);

  if (pass.layerType === "layerComposite3d") {
    mergeSceneUniforms(merged, layer, pass, ctx);
  }

  // A camera that drives 3D groups films the plate flat: the view transform
  // is applied per 3D layer instead, the lens chain (DOF/bloom/tonemap) stays.
  if (pass.layerType === "cameraStage" && merged.drive3d === true) {
    merged.tilt = 0;
    merged.yaw = 0;
    merged.roll = 0;
    merged.zoom = 1;
  }

  applyTimingGate(merged, layer, pass, ctx.time);
  return merged;
}

function getLayerById(ctx: RenderPassContext, id: string): LayerInstance | undefined {
  return ctx.findLayer?.({
    layerId: id,
    layerType: "layerComposite3d",
    uniforms: {},
    inputLayerId: null,
    sourceLayerId: id,
    isOutput: false,
  });
}

function readLayerParam(
  ctx: RenderPassContext,
  layer: LayerInstance,
  name: string,
  fallback: number,
): number {
  const raw = layer.values[name];
  const base = typeof raw === "number" ? raw : fallback;
  return ctx.getModulatedValue ? ctx.getModulatedValue(layer.id, name, base) : base;
}

const MAX_SCENE_LIGHTS = 4;

/** Camera view, object material, and light uniforms for a 3D slot pass. */
function mergeSceneUniforms(
  merged: Record<string, unknown>,
  member: LayerInstance,
  pass: RenderPass,
  ctx: RenderPassContext,
): void {
  // Scene camera (identity unless a drive-3D camera pilots the group).
  const view = resolveSceneView(
    pass.cameraSourceLayerId,
    (id) => getLayerById(ctx, id),
    ctx.getModulatedValue,
  );
  merged.u_sceneFov = view.fov;
  merged.u_camTilt = view.tilt;
  merged.u_camYaw = view.yaw;
  merged.u_camRoll = view.roll;
  merged.u_camZoom = view.zoom;

  // Object members ray-trace in the slot pass (no content FBO).
  if (member.type === "object3d") {
    Object.assign(merged, buildLayerUniforms(member, ctx.getModulatedValue ?? null));
    merged.u_isObject = 1;
  } else {
    merged.u_isObject = 0;
  }

  // Lights of this group (in/out-gated; opacity scales intensity).
  const aspect = ctx.width / Math.max(ctx.height, 1);
  let count = 0;
  let ambient = 0;
  for (const lightId of pass.threeDGroup?.lightIds ?? []) {
    if (count >= MAX_SCENE_LIGHTS) break;
    const light = getLayerById(ctx, lightId);
    if (!light || layerTimingFactor(light, ctx.time) === 0) continue;

    const opacity = readLayerParam(ctx, light, "layerOpacity", 100) / 100;
    const intensity = readLayerParam(ctx, light, "intensity", 1) * opacity;
    const type = typeof light.values.lightType === "number" ? light.values.lightType : 0;
    const color = typeof light.values.lightColor === "string" ? light.values.lightColor : "#ffffff";
    ambient = Math.max(ambient, readLayerParam(ctx, light, "ambient", 0.15) * opacity);

    let vec: [number, number, number];
    if (type === 1) {
      // Point: stack-space position from the universal transform.
      vec = [
        2 * readLayerParam(ctx, light, "layerPositionX", 0) * aspect,
        2 * readLayerParam(ctx, light, "layerPositionY", 0),
        2 * readLayerParam(ctx, light, "layerPositionZ", 0),
      ];
    } else {
      // Directional: unit vector TOWARD the light from azimuth/elevation.
      const az = (readLayerParam(ctx, light, "azimuth", -35) * Math.PI) / 180;
      const el = (readLayerParam(ctx, light, "elevation", 35) * Math.PI) / 180;
      vec = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
    }

    merged[`u_light${count}Type`] = type;
    merged[`u_light${count}Color`] = color;
    merged[`u_light${count}Intensity`] = intensity;
    merged[`u_light${count}Vec`] = vec;
    count++;
  }
  merged.u_lightCount = count;
  merged.u_ambient = ambient;
}

/** Upload (or reuse) the rasterized texture for a text layer pass. */
function ensureTextTexture(
  pass: RenderPass,
  ctx: RenderPassContext,
  uniformValues: Record<string, unknown>,
): WebGLTexture | null {
  const { gl, textTextures, createTextImage } = ctx;
  if (!textTextures || !createTextImage) return null;

  const spec = textSpecFromValues(uniformValues);
  const contentScale = ctx.contentScale ?? 1;
  const key = `${textCacheKey(spec, ctx.width, ctx.height)}:${contentScale}`;
  const cached = textTextures.get(pass.layerId);
  if (cached && cached.key === key) return cached.texture;

  const image = createTextImage(spec, ctx.width, ctx.height, contentScale);
  if (!image) return cached?.texture ?? null;

  const texture = cached?.texture ?? gl.createTexture();
  if (!texture) return null;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if ("data" in image) {
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      image.width,
      image.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      image.data,
    );
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  }
  textTextures.set(pass.layerId, { key, texture });
  return texture;
}

/** Upload (or reuse) the host-pushed capture for a component layer pass. */
function ensureComponentTexture(
  pass: RenderPass,
  ctx: RenderPassContext,
): { texture: WebGLTexture; source: ComponentSource } | null {
  const { gl, componentSources, componentTextures } = ctx;
  if (!componentSources || !componentTextures) return null;

  const source = componentSources.get(pass.layerId);
  if (!source) return null;

  const cached = componentTextures.get(pass.layerId);
  if (cached && cached.version === source.version) {
    return { texture: cached.texture, source };
  }

  const texture = cached?.texture ?? gl.createTexture();
  if (!texture) return null;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const frame = source.frame;
  if ("data" in frame) {
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      frame.width,
      frame.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      frame.data,
    );
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
  }
  // Captures are supersampled and often drawn minified; mipmaps keep thin text
  // stable instead of crawling under bilinear-only sampling. NPOT mipmaps are
  // legal here because the pipeline requires a WebGL2 context everywhere.
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  componentTextures.set(pass.layerId, { version: source.version, texture });
  return { texture, source };
}

/** Upload (or reuse) the host-pushed frame for an image/video layer pass. */
function ensureMediaTexture(
  pass: RenderPass,
  ctx: RenderPassContext,
): { texture: WebGLTexture; source: MediaSource } | null {
  const { gl, mediaSources, mediaTextures } = ctx;
  if (!mediaSources || !mediaTextures) return null;

  const source = mediaSources.get(pass.layerId);
  if (!source) return null;

  const cached = mediaTextures.get(pass.layerId);
  if (cached && cached.version === source.version) {
    return { texture: cached.texture, source };
  }

  const texture = cached?.texture ?? gl.createTexture();
  if (!texture) return null;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const frame = source.source;
  if ("data" in frame) {
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      frame.width,
      frame.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      frame.data,
    );
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
  }
  // Media is usually higher-res than its draw size (photos, video frames);
  // mipmaps keep minified detail stable instead of shimmering under
  // bilinear-only sampling. NPOT mipmaps are legal here because the pipeline
  // requires a WebGL2 context everywhere.
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  mediaTextures.set(pass.layerId, { version: source.version, texture });
  return { texture, source };
}

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

type PassTargetInfo = {
  /** The bound render target's size (differs from the frame for bloom mips). */
  targetWidth: number;
  targetHeight: number;
  /** The input texture's size (bloom taps are spaced in input texels). */
  inputWidth: number;
  inputHeight: number;
  auxTexture: WebGLTexture | null;
};

function setPassUniforms(
  gl: GlContext,
  program: WebGLProgram,
  pass: RenderPass,
  ctx: RenderPassContext,
  inputTexture: WebGLTexture | null,
  colorTexture: WebGLTexture | null,
  target: PassTargetInfo,
) {
  let texUnit = 0;
  const uniformValues = resolvePassUniformValues(pass, ctx);
  const { width, height, time, scaleUniform, gradientTextures, stbnTexture } = ctx;

  // u_resolution is the render target being written; full-size passes see the
  // frame size, bloom mips see their own. u_frameSize is always the frame.
  const uRes = gl.getUniformLocation(program, "u_resolution");
  if (uRes) gl.uniform2f(uRes, target.targetWidth, target.targetHeight);

  const uFrameSize = gl.getUniformLocation(program, "u_frameSize");
  if (uFrameSize) gl.uniform2f(uFrameSize, width, height);

  const uInputSize = gl.getUniformLocation(program, "u_inputSize");
  if (uInputSize) gl.uniform2f(uInputSize, target.inputWidth, target.inputHeight);

  const uTime = gl.getUniformLocation(program, "u_time");
  if (uTime) gl.uniform1f(uTime, time);

  const uScale = gl.getUniformLocation(program, "u_scale");
  if (uScale) gl.uniform1f(uScale, scaleUniform);

  if (pass.layerType === "resolve") {
    if (inputTexture) {
      const uDisp = gl.getUniformLocation(program, "u_displacement");
      if (uDisp) {
        gl.activeTexture(gl.TEXTURE0 + texUnit);
        gl.bindTexture(gl.TEXTURE_2D, inputTexture);
        gl.uniform1i(uDisp, texUnit);
        texUnit++;
      }
    }
  } else if (inputTexture) {
    const uInput = gl.getUniformLocation(program, "u_input");
    if (uInput) {
      gl.activeTexture(gl.TEXTURE0 + texUnit);
      gl.bindTexture(gl.TEXTURE_2D, inputTexture);
      gl.uniform1i(uInput, texUnit);
      texUnit++;
    }
  }

  if (colorTexture) {
    const uColor = gl.getUniformLocation(program, "u_color");
    if (uColor) {
      gl.activeTexture(gl.TEXTURE0 + texUnit);
      gl.bindTexture(gl.TEXTURE_2D, colorTexture);
      gl.uniform1i(uColor, texUnit);
      texUnit++;
    }
  }

  if (target.auxTexture) {
    const uAux = gl.getUniformLocation(program, "u_aux");
    if (uAux) {
      gl.activeTexture(gl.TEXTURE0 + texUnit);
      gl.bindTexture(gl.TEXTURE_2D, target.auxTexture);
      gl.uniform1i(uAux, texUnit);
      texUnit++;
    }
  }

  const uHasInput = gl.getUniformLocation(program, "u_hasInput");
  if (uHasInput) gl.uniform1i(uHasInput, inputTexture ? 1 : 0);

  if (pass.layerType === "text") {
    const textTexture = ensureTextTexture(pass, ctx, uniformValues);
    const uLayerTexture = gl.getUniformLocation(program, "u_layerTexture");
    if (textTexture && uLayerTexture) {
      gl.activeTexture(gl.TEXTURE0 + texUnit);
      gl.bindTexture(gl.TEXTURE_2D, textTexture);
      gl.uniform1i(uLayerTexture, texUnit);
      texUnit++;
    }
  }

  if (pass.layerType === "component") {
    const entry = ensureComponentTexture(pass, ctx);
    if (entry) {
      const uLayerTexture = gl.getUniformLocation(program, "u_layerTexture");
      if (uLayerTexture) {
        gl.activeTexture(gl.TEXTURE0 + texUnit);
        gl.bindTexture(gl.TEXTURE_2D, entry.texture);
        gl.uniform1i(uLayerTexture, texUnit);
        texUnit++;
      }
      const contentScale = ctx.contentScale ?? 1;
      const uContentSize = gl.getUniformLocation(program, "u_contentSize");
      if (uContentSize) {
        gl.uniform2f(
          uContentSize,
          Math.max(1, entry.source.cssWidth * contentScale),
          Math.max(1, entry.source.cssHeight * contentScale),
        );
      }
    }
    const uHasTexture = gl.getUniformLocation(program, "u_hasTexture");
    if (uHasTexture) gl.uniform1i(uHasTexture, entry ? 1 : 0);
  }

  if (pass.layerType === "image" || pass.layerType === "video") {
    const entry = ensureMediaTexture(pass, ctx);
    if (entry) {
      const uLayerTexture = gl.getUniformLocation(program, "u_layerTexture");
      if (uLayerTexture) {
        gl.activeTexture(gl.TEXTURE0 + texUnit);
        gl.bindTexture(gl.TEXTURE_2D, entry.texture);
        gl.uniform1i(uLayerTexture, texUnit);
        texUnit++;
      }
      // Uncropped display size in buffer px; the shader shrinks it by the crop
      // fractions and remaps sampling into the kept window.
      const contentScale = ctx.contentScale ?? 1;
      const uContentSize = gl.getUniformLocation(program, "u_contentSize");
      if (uContentSize) {
        gl.uniform2f(
          uContentSize,
          Math.max(1, entry.source.width * contentScale),
          Math.max(1, entry.source.height * contentScale),
        );
      }
    }
    const uHasTexture = gl.getUniformLocation(program, "u_hasTexture");
    if (uHasTexture) gl.uniform1i(uHasTexture, entry ? 1 : 0);
  }

  if (stbnTexture && STBN_LAYER_TYPES.has(pass.layerType as LayerType)) {
    const uStbn = gl.getUniformLocation(program, "u_stbn");
    if (uStbn) {
      gl.activeTexture(gl.TEXTURE0 + texUnit);
      gl.bindTexture(gl.TEXTURE_2D, stbnTexture);
      gl.uniform1i(uStbn, texUnit);
      texUnit++;
    }
    const uStbnFrame = gl.getUniformLocation(program, "u_stbnFrame");
    if (uStbnFrame) {
      const speed = (uniformValues.speed as number) ?? 0.35;
      gl.uniform1f(uStbnFrame, stbnFrameIndex(time, speed));
    }
  }

  for (const [name, value] of Object.entries(uniformValues)) {
    const loc = gl.getUniformLocation(program, name);
    if (!loc) continue;

    if (typeof value === "number") {
      if (INT_UNIFORMS.has(name)) {
        gl.uniform1i(loc, Math.round(value));
      } else {
        gl.uniform1f(loc, value);
      }
    } else if (typeof value === "boolean") {
      gl.uniform1i(loc, value ? 1 : 0);
    } else if (typeof value === "string") {
      if (!HEX_COLOR_RE.test(value)) continue; // text content, font names, …
      const [r, g, b] = hexToRGB(value);
      gl.uniform3f(loc, r, g, b);
    } else if (Array.isArray(value)) {
      if (value.length === 2 && typeof value[0] === "number") {
        gl.uniform2f(loc, value[0], value[1] as number);
      } else if (value.length === 3 && typeof value[0] === "number") {
        gl.uniform3f(loc, value[0], value[1] as number, value[2] as number);
      } else if (value.length > 0 && typeof value[0] === "object" && "color" in value[0]) {
        const stops = value as GradientStop[];
        const key = `${pass.layerId}_${name}`;
        const data = ctx.createGradientData(stops);
        let tex = gradientTextures.get(key);
        if (!tex) {
          tex = gl.createTexture()!;
          gradientTextures.set(key, tex);
          gl.activeTexture(gl.TEXTURE0 + texUnit);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        } else {
          gl.activeTexture(gl.TEXTURE0 + texUnit);
          gl.bindTexture(gl.TEXTURE_2D, tex);
        }
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          GRADIENT_RESOLUTION,
          1,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          data,
        );
        gl.activeTexture(gl.TEXTURE0 + texUnit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(loc, texUnit);
        texUnit++;
      }
    }
  }
}

export type RenderPassesResult = {
  pixels?: Uint8Array;
};

export type FboEntry = {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
};

export type RenderPipelineCache = {
  passSignature: string;
  sizeKey: string;
  programs: Map<RenderPass["layerType"], WebGLProgram>;
  fbos: Map<string, FboEntry>;
  quadBuffers: Map<WebGLProgram, WebGLBuffer>;
  neutralTexture: WebGLTexture | null;
  blackTexture: WebGLTexture | null;
};

export function createRenderPipelineCache(): RenderPipelineCache {
  return {
    passSignature: "",
    sizeKey: "",
    programs: new Map(),
    fbos: new Map(),
    quadBuffers: new Map(),
    neutralTexture: null,
    blackTexture: null,
  };
}

export function disposeRenderPipelineCache(gl: GlContext, cache: RenderPipelineCache): void {
  for (const program of cache.programs.values()) gl.deleteProgram(program);
  for (const fbo of cache.fbos.values()) {
    gl.deleteFramebuffer(fbo.framebuffer);
    gl.deleteTexture(fbo.texture);
  }
  for (const buffer of cache.quadBuffers.values()) gl.deleteBuffer(buffer);
  if (cache.neutralTexture) gl.deleteTexture(cache.neutralTexture);
  if (cache.blackTexture) gl.deleteTexture(cache.blackTexture);
  cache.programs.clear();
  cache.fbos.clear();
  cache.quadBuffers.clear();
  cache.neutralTexture = null;
  cache.blackTexture = null;
  cache.passSignature = "";
  cache.sizeKey = "";
}

function passGraphSignature(passes: RenderPass[]): string {
  return passes.map((p) =>
    `${p.layerId}:${p.layerType}:${p.isOutput ? 1 : 0}:${p.inputLayerId ?? ""}:${p.colorSourceLayerId ?? ""}:${p.auxSourceLayerId ?? ""}:${p.targetScale ?? 1}:${p.floatTarget ? 1 : 0}`,
  ).join("|");
}

function ensurePrograms(
  gl: GlContext,
  passes: RenderPass[],
  programs: Map<RenderPass["layerType"], WebGLProgram>,
): void {
  for (const pass of passes) {
    if (programs.has(pass.layerType)) continue;
    const fragSrc = FRAG_SHADERS[pass.layerType];
    if (!fragSrc) continue;
    if (!fragSrc.includes("uniform") && fragSrc.endsWith(".frag")) {
      console.error(
        `Shader source for ${pass.layerType} looks like a file path — rebuild @shader-lab/core`,
        fragSrc,
      );
      continue;
    }
    const program = createProgram(gl, RAW_VERT, fragSrc);
    if (program) programs.set(pass.layerType, program);
  }
}

function ensureFbos(
  gl: GlContext,
  passes: RenderPass[],
  width: number,
  height: number,
  fbos: Map<string, FboEntry>,
): void {
  for (const pass of passes) {
    if (pass.isOutput || fbos.has(pass.layerId)) continue;
    // Bloom mips render into scaled-down targets; everything else is full size.
    const scale = pass.targetScale ?? 1;
    const w = Math.max(8, Math.round(width * scale));
    const h = Math.max(8, Math.round(height * scale));
    const fbo = pass.floatTarget
      ? createFBO(gl, w, h, true, true)
      : createFBO(gl, w, h, pass.layerType === "distortion");
    fbos.set(pass.layerId, { ...fbo, width: w, height: h });
  }
}

function disposeFbos(gl: GlContext, fbos: Map<string, FboEntry>): void {
  for (const fbo of fbos.values()) {
    gl.deleteFramebuffer(fbo.framebuffer);
    gl.deleteTexture(fbo.texture);
  }
  fbos.clear();
}

function getQuadBuffer(
  gl: GlContext,
  program: WebGLProgram,
  quadBuffers: Map<WebGLProgram, WebGLBuffer> | null,
): WebGLBuffer {
  if (quadBuffers) {
    let buffer = quadBuffers.get(program);
    if (!buffer) {
      buffer = createFullscreenQuad(gl, program);
      quadBuffers.set(program, buffer);
    }
    return buffer;
  }
  return createFullscreenQuad(gl, program);
}

function createFallbackTextures(gl: GlContext): {
  neutralTexture: WebGLTexture;
  blackTexture: WebGLTexture;
} {
  const neutralTexture = gl.createTexture()!;
  const neutralData = new Uint8Array([128, 128, 255, 255]);
  gl.bindTexture(gl.TEXTURE_2D, neutralTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, neutralData);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const blackTexture = gl.createTexture()!;
  const blackData = new Uint8Array([0, 0, 0, 255]);
  gl.bindTexture(gl.TEXTURE_2D, blackTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, blackData);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  return { neutralTexture, blackTexture };
}

export type RenderPassOptions = {
  /** When true, read pixels after rendering (headless export). Default false for live canvas. */
  readPixels?: boolean;
  /** When true, delete GPU resources after rendering. Default true unless pipelineCache is set. */
  disposeResources?: boolean;
  /** Reuse GPU programs, FBOs, and quad buffers across frames (live canvas). */
  pipelineCache?: RenderPipelineCache;
};

export function renderPasses(
  passes: RenderPass[],
  ctx: RenderPassContext,
  options: RenderPassOptions = {},
): RenderPassesResult {
  const pipelineCache = options.pipelineCache;
  const readPixels = options.readPixels ?? false;
  const disposeResources = options.disposeResources ?? !pipelineCache;
  const { gl, width, height } = ctx;
  if (passes.length === 0) return {};

  gl.viewport(0, 0, width, height);

  const sizeKey = `${width}x${height}`;
  const passSignature = passGraphSignature(passes);

  let programs: Map<RenderPass["layerType"], WebGLProgram>;
  let fbos: Map<string, FboEntry>;
  let quadBuffers: Map<WebGLProgram, WebGLBuffer> | null = null;
  let neutralTexture: WebGLTexture | null;
  let blackTexture: WebGLTexture | null;

  if (pipelineCache) {
    if (pipelineCache.sizeKey !== sizeKey || pipelineCache.passSignature !== passSignature) {
      disposeFbos(gl, pipelineCache.fbos);
      pipelineCache.sizeKey = sizeKey;
      pipelineCache.passSignature = passSignature;
    }
    ensurePrograms(gl, passes, pipelineCache.programs);
    ensureFbos(gl, passes, width, height, pipelineCache.fbos);
    programs = pipelineCache.programs;
    fbos = pipelineCache.fbos;
    quadBuffers = pipelineCache.quadBuffers;
    neutralTexture = pipelineCache.neutralTexture;
    blackTexture = pipelineCache.blackTexture;
    if (!neutralTexture || !blackTexture) {
      const fallback = createFallbackTextures(gl);
      neutralTexture = pipelineCache.neutralTexture = fallback.neutralTexture;
      blackTexture = pipelineCache.blackTexture = fallback.blackTexture;
    }
  } else {
    programs = new Map();
    ensurePrograms(gl, passes, programs);
    fbos = new Map();
    ensureFbos(gl, passes, width, height, fbos);
    const fallback = createFallbackTextures(gl);
    neutralTexture = fallback.neutralTexture;
    blackTexture = fallback.blackTexture;
  }

  function getNeutralTexture(): WebGLTexture {
    return neutralTexture!;
  }

  function getBlackTexture(): WebGLTexture {
    return blackTexture!;
  }

  // Depth-sort 3D group slots for this frame (keyframed/LFO Z flows through modFn).
  const execPasses = assignThreeDSlots(passes, ctx.findLayer, ctx.getModulatedValue, width / Math.max(height, 1));

  for (const pass of execPasses) {
    const program = programs.get(pass.layerType);
    if (!program) continue;

    if (pass.layerType === "resolve" || pass.layerType === "layerComposite") {
      const hasColor = pass.colorSourceLayerId && fbos.has(pass.colorSourceLayerId);
      if (!hasColor) continue;
    } else if (pass.layerType === "layerComposite3d") {
      // Object slots ray-trace without a content FBO (colorSourceLayerId null);
      // quad slots need their member's content texture.
      if (pass.colorSourceLayerId && !fbos.has(pass.colorSourceLayerId)) continue;
    }

    gl.useProgram(program);
    getQuadBuffer(gl, program, quadBuffers);

    // Bind the pass's own target and size the viewport to it — bloom mips
    // render into scaled-down FBOs, everything else at frame size.
    let targetWidth = width;
    let targetHeight = height;
    if (pass.isOutput) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
      const fbo = fbos.get(pass.layerId);
      if (fbo) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.framebuffer);
        targetWidth = fbo.width;
        targetHeight = fbo.height;
      }
    }
    gl.viewport(0, 0, targetWidth, targetHeight);

    let inputTexture: WebGLTexture | null = null;
    let inputWidth = width;
    let inputHeight = height;
    if (pass.inputLayerId) {
      const inputFbo = fbos.get(pass.inputLayerId);
      inputTexture = inputFbo?.texture ?? getBlackTexture();
      if (inputFbo) {
        inputWidth = inputFbo.width;
        inputHeight = inputFbo.height;
      }
    } else if (pass.layerType === "distortion") {
      inputTexture = getNeutralTexture();
    } else if (pass.layerType === "layerComposite" || pass.layerType === "layerComposite3d") {
      // Bottom layer: composite onto black.
      inputTexture = getBlackTexture();
    }

    const colorTexture = pass.colorSourceLayerId
      ? fbos.get(pass.colorSourceLayerId)?.texture ?? null
      : null;

    const auxTexture = pass.auxSourceLayerId
      ? fbos.get(pass.auxSourceLayerId)?.texture ?? getBlackTexture()
      : null;

    setPassUniforms(gl, program, pass, ctx, inputTexture, colorTexture, {
      targetWidth,
      targetHeight,
      inputWidth,
      inputHeight,
      auxTexture,
    });
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  const pixels = readPixels ? new Uint8Array(width * height * 4) : undefined;
  if (readPixels) {
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels!);
  }

  if (disposeResources) {
    for (const program of programs.values()) gl.deleteProgram(program);
    disposeFbos(gl, fbos);
    for (const tex of ctx.gradientTextures.values()) gl.deleteTexture(tex);
    if (ctx.textTextures) {
      for (const entry of ctx.textTextures.values()) gl.deleteTexture(entry.texture);
      ctx.textTextures.clear();
    }
    if (neutralTexture) gl.deleteTexture(neutralTexture);
    if (blackTexture) gl.deleteTexture(blackTexture);
  }

  return { pixels };
}

export { destroyGlContext };
