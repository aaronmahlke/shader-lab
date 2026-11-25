import type { GradientStop } from "../types";
import type { LayerInstance, RenderPass } from "../types/editor";
import type { ModulationFn } from "../compiler/compile-passes";
import { STBN_TEXTURE_PATH } from "../modulation/stbn";
import { GRADIENT_RESOLUTION } from "../shaders";
import type { GlContext } from "./gl-utils";
import { createFBO, createFullscreenQuad, createGlContext, createProgram } from "./gl-utils";
import { FRAG_SHADERS, RAW_VERT } from "../shaders";
import {
  createRenderPipelineCache,
  disposeRenderPipelineCache,
  renderPasses,
  type ComponentTextureEntry,
  type MediaTextureEntry,
  type RenderPipelineCache,
  type RenderPassContext,
  type TextTextureEntry,
} from "./render-passes";
import type { ComponentSource, ComponentSourceInput, MediaSource } from "./component-source";
import { drawTextSpec, requestTextFont, type TextLayerSpec } from "./text-raster";

export type CompositionRendererOptions = {
  pixelRatio?: number;
  stbnTexturePath?: string;
  fixedBufferSize?: { width: number; height: number };
  /** Composition height in px — reference for text/content raster scale. */
  contentReferenceHeight?: number;
  /**
   * Reference width for the u_scale uniform when rendering into a fixed
   * buffer (e.g. the composition's native width). Keeps pixel-sized effects
   * like dither/grain stable across viewport zoom. Defaults to the window width.
   */
  scaleReferenceWidth?: number;
  findLayer?: (pass: RenderPass) => LayerInstance | undefined;
  getModulatedValue?: ModulationFn | null;
};

export class CompositionRenderer {
  private canvas: HTMLCanvasElement;
  private gl: GlContext;
  private options: CompositionRendererOptions;
  private stbnTexture: WebGLTexture | null = null;
  private gradientTextures = new Map<string, WebGLTexture>();
  private textTextures = new Map<string, TextTextureEntry>();
  private textCanvas: HTMLCanvasElement | null = null;
  private componentSources = new Map<string, ComponentSource>();
  private componentTextures = new Map<string, ComponentTextureEntry>();
  private mediaSources = new Map<string, MediaSource>();
  private mediaTextures = new Map<string, MediaTextureEntry>();
  private pipelineCache: RenderPipelineCache = createRenderPipelineCache();
  /** Motion blur: float accumulation target + a copy program to present it. */
  private accum: { framebuffer: WebGLFramebuffer; texture: WebGLTexture; width: number; height: number } | null = null;
  private present: { program: WebGLProgram; quad: WebGLBuffer } | null = null;
  private pixelRatio: number;

  constructor(canvas: HTMLCanvasElement, options: CompositionRendererOptions = {}) {
    this.canvas = canvas;
    this.options = options;
    this.pixelRatio = options.pixelRatio ?? (typeof window !== "undefined" ? window.devicePixelRatio : 1);

    const gl = createGlContext(canvas);
    if (!gl) throw new Error("WebGL2 is required");
    this.gl = gl;

    this.loadStbnTexture(options.stbnTexturePath ?? STBN_TEXTURE_PATH);
  }

  private loadStbnTexture(path: string): void {
    const gl = this.gl;
    const placeholder = gl.createTexture();
    if (!placeholder) return;

    const data = new Uint8Array([128, 128, 128, 255]);
    gl.bindTexture(gl.TEXTURE_2D, placeholder);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    this.stbnTexture = placeholder;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const tex = gl.createTexture();
      if (!tex) return;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      if (this.stbnTexture) gl.deleteTexture(this.stbnTexture);
      this.stbnTexture = tex;
    };
    img.src = path;
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  getGl(): GlContext {
    return this.gl;
  }

  /** Swap the fixed render buffer size at runtime (viewport zoom, export). */
  setFixedBufferSize(
    size: { width: number; height: number } | undefined,
    scaleReferenceWidth?: number,
  ): void {
    this.options.fixedBufferSize = size;
    if (scaleReferenceWidth !== undefined) {
      this.options.scaleReferenceWidth = scaleReferenceWidth;
    }
    this.syncCanvasSize();
  }

  resize(width: number, height: number, pixelRatio?: number): void {
    if (pixelRatio !== undefined) this.pixelRatio = pixelRatio;
    const w = Math.floor(width * this.pixelRatio);
    const h = Math.floor(height * this.pixelRatio);
    this.canvas.width = w;
    this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
  }

  syncCanvasSize(): void {
    const fixed = this.options.fixedBufferSize;
    if (fixed && fixed.width >= 1 && fixed.height >= 1) {
      this.resize(fixed.width, fixed.height, 1);
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    if (rect.width >= 1 && rect.height >= 1) {
      this.resize(rect.width, rect.height);
    }
  }

  private createGradientData(stops: GradientStop[]): Uint8Array {
    const canvas = document.createElement("canvas");
    canvas.width = GRADIENT_RESOLUTION;
    canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    const sorted = [...stops].sort((a, b) => a.position - b.position);
    const gradient = ctx.createLinearGradient(0, 0, GRADIENT_RESOLUTION, 0);
    for (const stop of sorted) {
      gradient.addColorStop(Math.max(0, Math.min(1, stop.position)), stop.color);
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, GRADIENT_RESOLUTION, 1);
    return new Uint8Array(ctx.getImageData(0, 0, GRADIENT_RESOLUTION, 1).data);
  }

  private getScaleUniform(): number {
    const fixed = this.options.fixedBufferSize;
    if (fixed && typeof window !== "undefined") {
      const refWidth = Math.max(1, window.innerWidth);
      const designWidth = Math.max(1, fixed.width);
      return designWidth / refWidth;
    }
    return this.pixelRatio;
  }

  renderFrame(
    time: number,
    passes: RenderPass[],
    modFn?: ModulationFn | null,
  ): void {
    const gl = this.gl;
    const width = this.canvas.width;
    const height = this.canvas.height;

    if (passes.length === 0) {
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }

    renderPasses(passes, this.passContext(time, modFn), { readPixels: false, pipelineCache: this.pipelineCache });
  }

  /**
   * Motion blur: render the pass graph once per sub-frame time and average
   * them (additive accumulation into a float target, then presented). `prepare`
   * returns the modulation fn for a sub-frame time (and may update any
   * per-time state such as nested comp resolvers). One time = plain render.
   */
  renderFrameSamples(
    times: number[],
    passes: RenderPass[],
    prepare: (time: number) => ModulationFn | null | undefined,
  ): void {
    if (times.length <= 1 || passes.length === 0) {
      const t = times[0] ?? 0;
      this.renderFrame(t, passes, prepare(t));
      return;
    }
    const gl = this.gl;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const accum = this.ensureAccum(width, height);

    gl.bindFramebuffer(gl.FRAMEBUFFER, accum.framebuffer);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const weight = 1 / times.length;
    for (const t of times) {
      renderPasses(passes, this.passContext(t, prepare(t)), {
        readPixels: false,
        pipelineCache: this.pipelineCache,
        outputTarget: accum,
        outputWeight: weight,
      });
    }

    // Present the averaged frame.
    const present = this.ensurePresent();
    if (!present) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.useProgram(present.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, present.quad);
    const pos = gl.getAttribLocation(present.program, "aPosition");
    const uv = gl.getAttribLocation(present.program, "aUV");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 16, 0);
    if (uv >= 0) {
      gl.enableVertexAttribArray(uv);
      gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, accum.texture);
    gl.uniform1i(gl.getUniformLocation(present.program, "u_input"), 0);
    gl.uniform2f(gl.getUniformLocation(present.program, "u_resolution"), width, height);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private ensureAccum(width: number, height: number) {
    if (this.accum && this.accum.width === width && this.accum.height === height) return this.accum;
    if (this.accum) {
      this.gl.deleteFramebuffer(this.accum.framebuffer);
      this.gl.deleteTexture(this.accum.texture);
    }
    // Half-float when renderable (no banding across sub-frames), else RGBA8.
    const { framebuffer, texture } = createFBO(this.gl, width, height, true, true);
    this.accum = { framebuffer, texture, width, height };
    return this.accum;
  }

  private ensurePresent() {
    if (this.present) return this.present;
    const program = createProgram(this.gl, RAW_VERT, FRAG_SHADERS.blit);
    if (!program) return null;
    this.present = { program, quad: createFullscreenQuad(this.gl, program) };
    return this.present;
  }

  private passContext(time: number, modFn?: ModulationFn | null): RenderPassContext {
    const gl = this.gl;
    const width = this.canvas.width;
    const height = this.canvas.height;
    return {
      gl,
      width,
      height,
      time,
      scaleUniform: this.getScaleUniform(),
      gradientTextures: this.gradientTextures,
      stbnTexture: this.stbnTexture,
      createGradientData: (stops) => this.createGradientData(stops),
      textTextures: this.textTextures,
      createTextImage: (spec, w, h, contentScale, window) =>
        this.createTextImage(spec, w, h, contentScale, window),
      componentSources: this.componentSources,
      componentTextures: this.componentTextures,
      mediaSources: this.mediaSources,
      mediaTextures: this.mediaTextures,
      contentScale: this.getContentScale(height),
      findLayer: this.options.findLayer,
      getModulatedValue: modFn ?? this.options.getModulatedValue ?? null,
    };
  }

  /** Buffer px per composition px (fixed buffers reference the comp height). */
  private getContentScale(bufferHeight: number): number {
    const reference = this.options.contentReferenceHeight;
    if (!reference || reference < 1) return 1;
    return bufferHeight / reference;
  }

  /** Rasterize a text spec on a reusable 2D canvas. */
  private createTextImage(
    spec: TextLayerSpec,
    width: number,
    height: number,
    contentScale: number,
    window?: readonly [number, number, number, number],
  ): TexImageSource | null {
    if (typeof document === "undefined") return null;
    if (!this.textCanvas) this.textCanvas = document.createElement("canvas");
    const canvas = this.textCanvas;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    requestTextFont(spec, contentScale);
    drawTextSpec(ctx, spec, width, height, contentScale, window);
    return canvas;
  }

  /**
   * Push (or clear) the captured frame for a component layer. The host owns
   * capture entirely; the renderer re-uploads on the next frame only when a
   * new push happened. Passing null frees the layer's source and GPU texture.
   */
  setComponentSource(layerId: string, source: ComponentSourceInput | null): void {
    if (!source) {
      this.componentSources.delete(layerId);
      const cached = this.componentTextures.get(layerId);
      if (cached) {
        this.gl.deleteTexture(cached.texture);
        this.componentTextures.delete(layerId);
      }
      return;
    }
    const previous = this.componentSources.get(layerId);
    this.componentSources.set(layerId, {
      ...source,
      version: (previous?.version ?? 0) + 1,
    });
  }

  /** Layer ids that currently have a pushed component source. */
  getComponentSourceIds(): string[] {
    return [...this.componentSources.keys()];
  }

  /**
   * Push (or clear) the decoded frame for an image/video layer. The host owns
   * loading and decoding entirely and bumps `version` on every new frame (each
   * decoded video frame); the renderer re-uploads on the next render only when
   * the version changed. Passing null frees the layer's source and GPU texture.
   */
  setMediaSource(layerId: string, source: MediaSource | null): void {
    if (!source) {
      this.mediaSources.delete(layerId);
      const cached = this.mediaTextures.get(layerId);
      if (cached) {
        this.gl.deleteTexture(cached.texture);
        this.mediaTextures.delete(layerId);
      }
      return;
    }
    this.mediaSources.set(layerId, source);
  }

  /** Layer ids that currently have a pushed media source. */
  getMediaSourceIds(): string[] {
    return [...this.mediaSources.keys()];
  }

  async captureBlob(): Promise<Blob | null> {
    return new Promise((resolve) => {
      this.canvas.toBlob(resolve, "image/png");
    });
  }

  setOptions(options: Partial<CompositionRendererOptions>): void {
    this.options = { ...this.options, ...options };
  }

  dispose(): void {
    disposeRenderPipelineCache(this.gl, this.pipelineCache);
    if (this.accum) {
      this.gl.deleteFramebuffer(this.accum.framebuffer);
      this.gl.deleteTexture(this.accum.texture);
      this.accum = null;
    }
    if (this.present) {
      this.gl.deleteProgram(this.present.program);
      this.gl.deleteBuffer(this.present.quad);
      this.present = null;
    }
    if (this.stbnTexture) {
      this.gl.deleteTexture(this.stbnTexture);
      this.stbnTexture = null;
    }
    for (const tex of this.gradientTextures.values()) {
      this.gl.deleteTexture(tex);
    }
    for (const entry of this.textTextures.values()) {
      this.gl.deleteTexture(entry.texture);
    }
    for (const entry of this.componentTextures.values()) {
      this.gl.deleteTexture(entry.texture);
    }
    this.textTextures.clear();
    this.gradientTextures.clear();
    this.componentSources.clear();
    this.componentTextures.clear();
  }
}
