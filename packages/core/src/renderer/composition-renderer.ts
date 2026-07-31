import type { GradientStop } from "../types";
import type { LayerInstance, RenderPass } from "../types/editor";
import type { ModulationFn } from "../compiler/compile-passes";
import { STBN_TEXTURE_PATH } from "../modulation/stbn";
import { GRADIENT_RESOLUTION } from "../shaders";
import type { GlContext } from "./gl-utils";
import { createGlContext } from "./gl-utils";
import {
  createRenderPipelineCache,
  disposeRenderPipelineCache,
  renderPasses,
  type RenderPipelineCache,
  type TextTextureEntry,
} from "./render-passes";
import { drawTextSpec, type TextLayerSpec } from "./text-raster";

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
  private pipelineCache: RenderPipelineCache = createRenderPipelineCache();
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

    renderPasses(passes, {
      gl,
      width,
      height,
      time,
      scaleUniform: this.getScaleUniform(),
      gradientTextures: this.gradientTextures,
      stbnTexture: this.stbnTexture,
      createGradientData: (stops) => this.createGradientData(stops),
      textTextures: this.textTextures,
      createTextImage: (spec, w, h, contentScale) =>
        this.createTextImage(spec, w, h, contentScale),
      contentScale: this.getContentScale(height),
      findLayer: this.options.findLayer,
      getModulatedValue: modFn ?? this.options.getModulatedValue ?? null,
    }, { readPixels: false, pipelineCache: this.pipelineCache });
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
  ): TexImageSource | null {
    if (typeof document === "undefined") return null;
    if (!this.textCanvas) this.textCanvas = document.createElement("canvas");
    const canvas = this.textCanvas;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    drawTextSpec(ctx, spec, width, height, contentScale);
    return canvas;
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
    this.textTextures.clear();
    this.gradientTextures.clear();
  }
}
