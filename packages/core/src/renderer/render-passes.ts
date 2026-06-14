import type { GradientStop } from "../types";
import type { LayerInstance, LayerType, RenderPass } from "../types/editor";
import type { ModulationFn } from "../compiler/compile-passes";
import { buildLayerUniforms } from "../compiler/compile-passes";
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

export type GradientDataFactory = (stops: GradientStop[]) => Uint8Array;

export type RenderPassContext = {
  gl: GlContext;
  width: number;
  height: number;
  time: number;
  scaleUniform: number;
  gradientTextures: Map<string, WebGLTexture>;
  stbnTexture: WebGLTexture | null;
  createGradientData: GradientDataFactory;
  findLayer?: (pass: RenderPass) => LayerInstance | undefined;
  getModulatedValue?: ModulationFn | null;
};

function resolvePassUniformValues(
  pass: RenderPass,
  ctx: RenderPassContext,
): Record<string, unknown> {
  if (pass.layerType === "resolve") return pass.uniforms;

  const layer = ctx.findLayer?.(pass);
  const merged = layer
    ? buildLayerUniforms(layer, ctx.getModulatedValue ?? null)
    : { ...pass.uniforms };

  // Pass-graph only — not stored on layer templates.
  return merged;
}

function setPassUniforms(
  gl: GlContext,
  program: WebGLProgram,
  pass: RenderPass,
  ctx: RenderPassContext,
  inputTexture: WebGLTexture | null,
  colorTexture: WebGLTexture | null,
) {
  let texUnit = 0;
  const uniformValues = resolvePassUniformValues(pass, ctx);
  const { width, height, time, scaleUniform, gradientTextures, stbnTexture } = ctx;

  const uRes = gl.getUniformLocation(program, "u_resolution");
  if (uRes) gl.uniform2f(uRes, width, height);

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

  const uHasInput = gl.getUniformLocation(program, "u_hasInput");
  if (uHasInput) gl.uniform1i(uHasInput, inputTexture ? 1 : 0);

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
      const [r, g, b] = hexToRGB(value);
      gl.uniform3f(loc, r, g, b);
    } else if (Array.isArray(value)) {
      if (value.length === 2 && typeof value[0] === "number") {
        gl.uniform2f(loc, value[0], value[1] as number);
      } else if (value.length > 0 && typeof value[0] === "object" && "color" in value[0]) {
        const stops = value as GradientStop[];
        const key = `${pass.layerId}_${name}`;
        let tex = gradientTextures.get(key);
        if (!tex) {
          const data = ctx.createGradientData(stops);
          tex = gl.createTexture()!;
          // Must select the target unit before upload — otherwise bindTexture clobbers
          // whatever is already on the active unit (usually u_input on TEXTURE0).
          gl.activeTexture(gl.TEXTURE0 + texUnit);
          gl.bindTexture(gl.TEXTURE_2D, tex);
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
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gradientTextures.set(key, tex);
        }
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

export type RenderPassOptions = {
  /** When true, read pixels after rendering (headless export). Default false for live canvas. */
  readPixels?: boolean;
  /** When true, delete GPU resources after rendering. Default true. */
  disposeResources?: boolean;
};

export function renderPasses(
  passes: RenderPass[],
  ctx: RenderPassContext,
  options: RenderPassOptions = {},
): RenderPassesResult {
  const { readPixels = false, disposeResources = true } = options;
  const { gl, width, height } = ctx;
  if (passes.length === 0) return {};

  gl.viewport(0, 0, width, height);

  const programs = new Map<RenderPass["layerType"], WebGLProgram>();
  for (const pass of passes) {
    if (programs.has(pass.layerType)) continue;
    const fragSrc = FRAG_SHADERS[pass.layerType as LayerType | "resolve" | "blit"];
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

  const fbos = new Map<string, { framebuffer: WebGLFramebuffer; texture: WebGLTexture }>();
  for (const pass of passes) {
    if (!pass.isOutput) {
      fbos.set(pass.layerId, createFBO(gl, width, height, pass.layerType === "distortion"));
    }
  }

  let neutralTexture: WebGLTexture | null = null;
  let blackTexture: WebGLTexture | null = null;

  function getNeutralTexture(): WebGLTexture {
    if (!neutralTexture) {
      neutralTexture = gl.createTexture()!;
      const data = new Uint8Array([128, 128, 255, 255]);
      gl.bindTexture(gl.TEXTURE_2D, neutralTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }
    return neutralTexture;
  }

  function getBlackTexture(): WebGLTexture {
    if (!blackTexture) {
      blackTexture = gl.createTexture()!;
      const data = new Uint8Array([0, 0, 0, 255]);
      gl.bindTexture(gl.TEXTURE_2D, blackTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }
    return blackTexture;
  }

  for (const pass of passes) {
    const program = programs.get(pass.layerType);
    if (!program) continue;

    if (pass.layerType === "resolve") {
      const hasColor = pass.colorSourceLayerId && fbos.has(pass.colorSourceLayerId);
      if (!hasColor) continue;
    }

    gl.useProgram(program);
    const quadBuffer = createFullscreenQuad(gl, program);

    if (pass.isOutput) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
      const fbo = fbos.get(pass.layerId);
      if (fbo) gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.framebuffer);
    }

    let inputTexture: WebGLTexture | null = null;
    if (pass.inputLayerId) {
      inputTexture = fbos.get(pass.inputLayerId)?.texture ?? getBlackTexture();
    } else if (pass.layerType === "distortion") {
      inputTexture = getNeutralTexture();
    }

    const colorTexture = pass.colorSourceLayerId
      ? fbos.get(pass.colorSourceLayerId)?.texture ?? null
      : null;

    setPassUniforms(gl, program, pass, ctx, inputTexture, colorTexture);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    if (pass.layerType === "distortion" && typeof window !== "undefined") {
      const fbo = fbos.get(pass.layerId);
      if (fbo) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.framebuffer);
        const probe = new Float32Array(4);
        gl.readPixels(
          Math.floor(width / 2),
          Math.floor(height / 2),
          1,
          1,
          gl.RGBA,
          gl.FLOAT,
          probe,
        );
        gl.bindFramebuffer(
          gl.FRAMEBUFFER,
          pass.isOutput ? null : fbos.get(pass.layerId)?.framebuffer ?? null,
        );
        (window as unknown as { __distDbg?: unknown }).__distDbg = {
          layerId: pass.layerId,
          fboStatus: gl.checkFramebufferStatus(fbo.framebuffer),
          probe: Array.from(probe),
          amplitude: resolvePassUniformValues(pass, ctx).amplitude,
        };
      }
    }

    gl.deleteBuffer(quadBuffer);
  }

  const pixels = readPixels ? new Uint8Array(width * height * 4) : undefined;
  if (readPixels) {
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels!);
  }

  if (disposeResources) {
    for (const [, program] of programs) gl.deleteProgram(program);
    for (const [, fbo] of fbos) {
      gl.deleteFramebuffer(fbo.framebuffer);
      gl.deleteTexture(fbo.texture);
    }
    for (const [, tex] of ctx.gradientTextures) gl.deleteTexture(tex);
    if (neutralTexture) gl.deleteTexture(neutralTexture);
    if (blackTexture) gl.deleteTexture(blackTexture);
  }

  return { pixels };
}

export { destroyGlContext };
