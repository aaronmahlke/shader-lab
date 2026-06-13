import { createCanvas } from "@napi-rs/canvas";
import type { LayerInstance, LFOSource, ModulationAssignment, RenderPass, LayerType } from "#shared/types/editor";
import type { GradientStop } from "#shared/types";
import { compilePasses } from "#shared/editor/compile-passes";
import { applyModulation } from "#shared/editor/modulation";
import { evaluateLfoWave, getLfoWaveShape } from "#shared/editor/lfo-wave";
import { stbnFrameIndex } from "#shared/editor/stbn";
import { createStbnGlTexture } from "./stbn-texture";

const STBN_LAYER_TYPES = new Set<LayerType | "hybridDissolve">([
  "waveFill",
  "bandFill",
  "hybridDissolve",
]);

// Import shader sources as strings — these are bundled by vite-plugin-glsl on the server via rollup
import gradientFrag from "#shared/shaders/layers/gradient.frag";
import meshFrag from "#shared/shaders/layers/mesh.frag";
import solidFrag from "#shared/shaders/layers/solid.frag";
import noiseFrag from "#shared/shaders/layers/noise.frag";
import distortionFrag from "#shared/shaders/layers/distortion.frag";
import ditherFrag from "#shared/shaders/layers/dither.frag";
import grainFrag from "#shared/shaders/layers/grain.frag";
import seamFrag from "#shared/shaders/layers/seam.frag";
import vignetteFrag from "#shared/shaders/layers/vignette.frag";
import chromaticAberrationFrag from "#shared/shaders/layers/chromatic-aberration.frag";
import compositeFillFrag from "#shared/shaders/layers/composite-fill.frag";
import hybridDissolveFrag from "#shared/shaders/layers/hybrid-dissolve.frag";
import resolveFrag from "#shared/shaders/layers/resolve.frag";
import outputFrag from "#shared/shaders/layers/output.frag";

const FRAG_SHADERS: Record<LayerType | "resolve" | "blit", string> = {
  gradient: gradientFrag,
  mesh: meshFrag,
  solid: solidFrag,
  noise: noiseFrag,
  waveFill: compositeFillFrag,
  bandFill: compositeFillFrag,
  distortion: distortionFrag,
  dither: ditherFrag,
  grain: grainFrag,
  seam: seamFrag,
  hybridDissolve: hybridDissolveFrag,
  vignette: vignetteFrag,
  chromaticAberration: chromaticAberrationFrag,
  resolve: resolveFrag,
  blit: outputFrag,
};

const RAW_VERT = `
attribute vec2 aPosition;
attribute vec2 aUV;
varying vec2 vUv;
void main() {
  vUv = aUV;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const GRADIENT_RESOLUTION = 256;

// --- Gradient texture creation ---

function createGradientData(stops: GradientStop[]): Uint8Array {
  const canvas = createCanvas(GRADIENT_RESOLUTION, 1);
  const ctx = canvas.getContext("2d");
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  const gradient = ctx.createLinearGradient(0, 0, GRADIENT_RESOLUTION, 0);
  for (const stop of sorted) {
    gradient.addColorStop(Math.max(0, Math.min(1, stop.position)), stop.color);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, GRADIENT_RESOLUTION, 1);
  const imageData = ctx.getImageData(0, 0, GRADIENT_RESOLUTION, 1);
  return new Uint8Array(imageData.data);
}

function hexToRGB(hex: string): [number, number, number] {
  hex = hex.replace("#", "");
  return [
    parseInt(hex.substring(0, 2), 16) / 255,
    parseInt(hex.substring(2, 4), 16) / 255,
    parseInt(hex.substring(4, 6), 16) / 255,
  ];
}

// --- Raw WebGL helpers ---

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("Shader compile error:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext, vertSrc: string, fragSrc: string): WebGLProgram | null {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  if (!vert || !frag) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("Program link error:", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

function createFullscreenQuad(gl: WebGLRenderingContext, program: WebGLProgram) {
  // Two triangles covering [-1, 1] with UVs [0, 1]
  const vertices = new Float32Array([
    -1, -1, 0, 0,
     1, -1, 1, 0,
    -1,  1, 0, 1,
    -1,  1, 0, 1,
     1, -1, 1, 0,
     1,  1, 1, 1,
  ]);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

  const posLoc = gl.getAttribLocation(program, "aPosition");
  const uvLoc = gl.getAttribLocation(program, "aUV");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
  if (uvLoc >= 0) {
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 16, 8);
  }

  return buffer;
}

function createFBO(gl: WebGLRenderingContext, width: number, height: number, useFloat = false) {
  const framebuffer = gl.createFramebuffer()!;
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);

  if (useFloat) {
    const halfFloatExt = gl.getExtension("OES_texture_half_float");
    const floatExt = gl.getExtension("OES_texture_float");
    if (halfFloatExt) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        width,
        height,
        0,
        gl.RGBA,
        halfFloatExt.HALF_FLOAT_OES,
        null,
      );
    } else if (floatExt) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.FLOAT, null);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }

  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return { framebuffer, texture };
}

// --- Set uniforms for a render pass ---

const INT_UNIFORMS = new Set([
  "waveType",
  "shape",
  "coordMode",
  "u_pointCount",
  "shapeType",
  "passMode",
  "mode",
  "steps",
]);

function setPassUniforms(
  gl: WebGLRenderingContext,
  program: WebGLProgram,
  pass: RenderPass,
  width: number,
  height: number,
  time: number,
  inputTexture: WebGLTexture | null,
  stippleTexture: WebGLTexture | null,
  colorTexture: WebGLTexture | null,
  gradientTextures: Map<string, WebGLTexture>,
  stbnTexture: WebGLTexture | null,
) {
  let texUnit = 0;

  // Global uniforms
  const uRes = gl.getUniformLocation(program, "u_resolution");
  if (uRes) gl.uniform2f(uRes, width, height);

  const uTime = gl.getUniformLocation(program, "u_time");
  if (uTime) gl.uniform1f(uTime, time);

  const uScale = gl.getUniformLocation(program, "u_scale");
  if (uScale) gl.uniform1f(uScale, 1.0);

  // Input texture from previous pass
  if (inputTexture) {
    const uInput = gl.getUniformLocation(program, "u_input");
    if (uInput) {
      gl.activeTexture(gl.TEXTURE0 + texUnit);
      gl.bindTexture(gl.TEXTURE_2D, inputTexture);
      gl.uniform1i(uInput, texUnit);
      texUnit++;
    }
    if (pass.layerType === "resolve") {
      const uDisp = gl.getUniformLocation(program, "u_displacement");
      if (uDisp) {
        gl.activeTexture(gl.TEXTURE0 + texUnit);
        gl.bindTexture(gl.TEXTURE_2D, inputTexture);
        gl.uniform1i(uDisp, texUnit);
        texUnit++;
      }
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

  const uHasStippleInput = gl.getUniformLocation(program, "u_hasStippleInput");
  if (uHasStippleInput) gl.uniform1i(uHasStippleInput, stippleTexture ? 1 : 0);

  if (stippleTexture) {
    const uStipple = gl.getUniformLocation(program, "u_stipple");
    if (uStipple) {
      gl.activeTexture(gl.TEXTURE0 + texUnit);
      gl.bindTexture(gl.TEXTURE_2D, stippleTexture);
      gl.uniform1i(uStipple, texUnit);
      texUnit++;
    }
  }

  if (stbnTexture && STBN_LAYER_TYPES.has(pass.layerType)) {
    const uStbn = gl.getUniformLocation(program, "u_stbn");
    if (uStbn) {
      gl.activeTexture(gl.TEXTURE0 + texUnit);
      gl.bindTexture(gl.TEXTURE_2D, stbnTexture);
      gl.uniform1i(uStbn, texUnit);
      texUnit++;
    }
    const uStbnFrame = gl.getUniformLocation(program, "u_stbnFrame");
    if (uStbnFrame) {
      const speed = (pass.uniforms.dissolveSpeed as number) ?? 0.35;
      gl.uniform1f(uStbnFrame, stbnFrameIndex(time, speed));
    }
  }

  // Pass-specific uniforms
  for (const [name, value] of Object.entries(pass.uniforms)) {
    const loc = gl.getUniformLocation(program, name);
    if (!loc) continue;

    if (typeof value === "number") {
      // Check if it's an int uniform (waveType, shape, etc.)
      if (INT_UNIFORMS.has(name)) {
        gl.uniform1i(loc, value);
      } else {
        gl.uniform1f(loc, value);
      }
    } else if (typeof value === "boolean") {
      gl.uniform1i(loc, value ? 1 : 0);
    } else if (typeof value === "string") {
      // Color hex
      const [r, g, b] = hexToRGB(value);
      gl.uniform3f(loc, r, g, b);
    } else if (Array.isArray(value)) {
      if (value.length === 2 && typeof value[0] === "number") {
        // vec2
        gl.uniform2f(loc, value[0], value[1] as number);
      } else if (value.length > 0 && typeof value[0] === "object" && "color" in value[0]) {
        // Gradient stops
        const stops = value as GradientStop[];
        const key = `${pass.layerId}_${name}`;
        let tex = gradientTextures.get(key);
        if (!tex) {
          const data = createGradientData(stops);
          tex = gl.createTexture()!;
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, GRADIENT_RESOLUTION, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
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

// --- Main render function ---

type CompositionConfig = {
  layers: LayerInstance[];
  lfos: LFOSource[];
  assignments: ModulationAssignment[];
};

export async function renderComposition(
  config: CompositionConfig,
  options: { width?: number; height?: number; time?: number } = {},
): Promise<Buffer | null> {
  const width = options.width ?? 400;
  const height = options.height ?? 300;
  const time = options.time ?? 2.0;

  // Lazy-import gl (native module)
  let createGL: any;
  try {
    // Try direct import first (works in dev)
    createGL = (await import("gl")).default;
  } catch {
    try {
      // Fallback for production build
      const { createRequire } = await import("module");
      const { join } = await import("path");
      const serverPkg = join(process.cwd(), ".output", "server", "package.json");
      const require = createRequire(serverPkg);
      createGL = require("gl");
    } catch (e) {
      console.error("Failed to import gl:", e);
      return null;
    }
  }

  // Evaluate LFOs at the given time to get modulated values
  function getModulatedValue(layerId: string, paramName: string, baseValue: number): number {
    const assignment = config.assignments.find(
      (a) => a.layerId === layerId && a.paramName === paramName,
    );
    if (!assignment) return baseValue;
    const lfo = config.lfos.find((l) => l.id === assignment.sourceId);
    if (!lfo) return baseValue;
    const phaseOffset = lfo.phase / 360;
    const rawT = lfo.mode === "pingpong"
      ? (time * lfo.rate + phaseOffset) % 2
      : (time * lfo.rate + phaseOffset) % 1;
    const t = lfo.mode === "pingpong" && rawT > 1 ? 2 - rawT : rawT;
    const lfoValue = evaluateLfoWave(getLfoWaveShape(lfo), lfo.points, Math.max(0, Math.min(1, t)));
    return applyModulation(baseValue, paramName, lfoValue, assignment.depth);
  }

  // Compile render passes
  const passes = compilePasses(config.layers, getModulatedValue);
  if (passes.length === 0) return null;

  // Create headless GL context
  const gl = createGL(width, height, { preserveDrawingBuffer: true });
  if (!gl) return null;

  try {
    gl.viewport(0, 0, width, height);

    // Compile shader programs for each unique layer type
    const programs = new Map<RenderPass["layerType"], WebGLProgram>();
    for (const pass of passes) {
      if (programs.has(pass.layerType)) continue;
      const fragSrc = FRAG_SHADERS[pass.layerType as LayerType | "resolve" | "blit"];
      if (!fragSrc) continue;
      const program = createProgram(gl, RAW_VERT, fragSrc);
      if (program) programs.set(pass.layerType, program);
    }

    // Create FBOs for each pass (except the last which renders to screen)
    const fbos = new Map<string, { framebuffer: WebGLFramebuffer; texture: WebGLTexture }>();
    for (const pass of passes) {
      if (!pass.isOutput) {
        fbos.set(pass.layerId, createFBO(gl, width, height, pass.layerType === "distortion"));
      }
    }

    const gradientTextures = new Map<string, WebGLTexture>();
    const stbnTexture = await createStbnGlTexture(gl);

    // Render each pass
    for (const pass of passes) {
      const program = programs.get(pass.layerType);
      if (!program) continue;

      gl.useProgram(program);

      // Set up quad geometry for this program
      const quadBuffer = createFullscreenQuad(gl, program);

      // Bind output FBO (or null for screen)
      if (pass.isOutput) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      } else {
        const fbo = fbos.get(pass.layerId);
        if (fbo) gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.framebuffer);
      }

      let inputTexture: WebGLTexture | null = null;
      if (pass.inputLayerId) {
        const inputFbo = fbos.get(pass.inputLayerId);
        if (inputFbo) inputTexture = inputFbo.texture;
      }

      let stippleTexture: WebGLTexture | null = null;
      if (pass.stippleInputLayerId) {
        const stippleFbo = fbos.get(pass.stippleInputLayerId);
        if (stippleFbo) stippleTexture = stippleFbo.texture;
      }

      let colorTexture: WebGLTexture | null = null;
      if (pass.colorSourceLayerId) {
        const colorFbo = fbos.get(pass.colorSourceLayerId);
        if (colorFbo) colorTexture = colorFbo.texture;
      }

      setPassUniforms(
        gl,
        program,
        pass,
        width,
        height,
        time,
        inputTexture,
        stippleTexture,
        colorTexture,
        gradientTextures,
        stbnTexture,
      );
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // Clean up quad buffer
      gl.deleteBuffer(quadBuffer);
    }

    // Read pixels
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    // Clean up GL resources
    for (const [, program] of programs) gl.deleteProgram(program);
    for (const [, fbo] of fbos) {
      gl.deleteFramebuffer(fbo.framebuffer);
      gl.deleteTexture(fbo.texture);
    }
    for (const [, tex] of gradientTextures) gl.deleteTexture(tex);
    gl.deleteTexture(stbnTexture);
    try { gl.getExtension("STACKGL_destroy_context")?.destroy(); } catch {}

    // Convert pixels to PNG using @napi-rs/canvas
    // Note: WebGL readPixels gives bottom-up rows, need to flip vertically
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    const imageData = ctx.createImageData(width, height);

    for (let y = 0; y < height; y++) {
      const srcRow = (height - 1 - y) * width * 4; // flip Y
      const dstRow = y * width * 4;
      for (let x = 0; x < width * 4; x++) {
        imageData.data[dstRow + x] = pixels[srcRow + x]!;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas.toBuffer("image/png");
  } catch (e) {
    console.error("Composition render failed:", e);
    try { gl.getExtension("STACKGL_destroy_context")?.destroy(); } catch {}
    return null;
  }
}
