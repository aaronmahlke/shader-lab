export type GlContext = WebGL2RenderingContext;

export function createGlContext(canvas: HTMLCanvasElement): WebGL2RenderingContext | null {
  return canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false });
}

export function compileShader(
  gl: GlContext,
  type: number,
  source: string,
): WebGLShader | null {
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

export function createProgram(
  gl: GlContext,
  vertSrc: string,
  fragSrc: string,
): WebGLProgram | null {
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

export function createFullscreenQuad(
  gl: GlContext,
  program: WebGLProgram,
): WebGLBuffer {
  const vertices = new Float32Array([
    -1, -1, 0, 0,
     1, -1, 1, 0,
    -1,  1, 0, 1,
    -1,  1, 0, 1,
     1, -1, 1, 0,
     1,  1, 1, 1,
  ]);
  const buffer = gl.createBuffer()!;
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

function attachColorTarget(
  gl: GlContext,
  texture: WebGLTexture,
  framebuffer: WebGLFramebuffer,
  width: number,
  height: number,
  internalFormat: number,
  type: number,
  filter: number,
): boolean {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, gl.RGBA, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
}

/**
 * Displacement maps use float RTs with NEAREST filtering (linear 32F sampling
 * needs an extension). The camera/lens chain uses `linearFilter` half-float
 * targets: WebGL2 filters 16F linearly in core, and renderability falls back
 * to RGBA8 via the candidate chain when EXT_color_buffer_float is missing.
 */
export function createFBO(
  gl: GlContext,
  width: number,
  height: number,
  useFloat = false,
  linearFilter = false,
): { framebuffer: WebGLFramebuffer; texture: WebGLTexture } {
  const framebuffer = gl.createFramebuffer()!;
  const texture = gl.createTexture()!;

  if (useFloat) {
    const candidates: [number, number, number][] = linearFilter
      ? [
          [gl.RGBA16F, gl.HALF_FLOAT, gl.LINEAR],
          [gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR],
        ]
      : [
          [gl.RGBA16F, gl.HALF_FLOAT, gl.NEAREST],
          [gl.RGBA32F, gl.FLOAT, gl.NEAREST],
          [gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR],
        ];
    let ok = false;
    for (const [internalFormat, type, filter] of candidates) {
      if (attachColorTarget(gl, texture, framebuffer, width, height, internalFormat, type, filter)) {
        ok = true;
        break;
      }
    }
    if (!ok) {
      console.warn("Failed to create displacement framebuffer");
    }
  } else {
    attachColorTarget(gl, texture, framebuffer, width, height, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return { framebuffer, texture };
}

export function hexToRGB(hex: string): [number, number, number] {
  hex = hex.replace("#", "");
  return [
    parseInt(hex.substring(0, 2), 16) / 255,
    parseInt(hex.substring(2, 4), 16) / 255,
    parseInt(hex.substring(4, 6), 16) / 255,
  ];
}

export function destroyGlContext(gl: GlContext): void {
  try {
    gl.getExtension("STACKGL_destroy_context")?.destroy();
  } catch {
    // ignore
  }
}
