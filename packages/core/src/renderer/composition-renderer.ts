import type { GradientStop } from "../types";
import type { LayerInstance, RenderPass } from "../types/editor";
import type { ModulationFn } from "../compiler/compile-passes";
import { STBN_TEXTURE_PATH } from "../modulation/stbn";
import { GRADIENT_RESOLUTION } from "../shaders";
import type { GlContext } from "./gl-utils";
import { createGlContext } from "./gl-utils";
import { renderPasses } from "./render-passes";

export type CompositionRendererOptions = {
  pixelRatio?: number;
  stbnTexturePath?: string;
  fixedBufferSize?: { width: number; height: number };
  findLayer?: (pass: RenderPass) => LayerInstance | undefined;
  getModulatedValue?: ModulationFn | null;
};

export class CompositionRenderer {
  private canvas: HTMLCanvasElement;
  private gl: GlContext;
  private options: CompositionRendererOptions;
  private stbnTexture: WebGLTexture | null = null;
  private gradientTextures = new Map<string, WebGLTexture>();
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

    this.gradientTextures.clear();

    renderPasses(passes, {
      gl,
      width,
      height,
      time,
      scaleUniform: this.getScaleUniform(),
      gradientTextures: this.gradientTextures,
      stbnTexture: this.stbnTexture,
      createGradientData: (stops) => this.createGradientData(stops),
      findLayer: this.options.findLayer,
      getModulatedValue: modFn ?? this.options.getModulatedValue ?? null,
    }, { readPixels: false, disposeResources: true });

    this.gradientTextures.clear();
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
    if (this.stbnTexture) {
      this.gl.deleteTexture(this.stbnTexture);
      this.stbnTexture = null;
    }
    for (const tex of this.gradientTextures.values()) {
      this.gl.deleteTexture(tex);
    }
    this.gradientTextures.clear();
  }
}
