import * as THREE from "three";
import type { RenderPass, LayerInstance } from "#shared/types/editor";
import type { GradientStop } from "#shared/types";
import { buildLayerUniforms, type ModulationFn } from "#shared/editor/compile-passes";

const INT_UNIFORMS = new Set([
  "waveType",
  "shape",
  "coordMode",
  "u_pointCount",
  "shapeType",
  "passMode",
]);

const GRADIENT_UNIFORM_NAMES = /^u_gradient/;

type RendererOptions = {
  layers?: Ref<LayerInstance[]>;
  getModulatedValue?: Ref<ModulationFn | null>;
  /** Called before each export frame so LFOs match wall-clock time. */
  sampleLfosAtTime?: (time: number) => void;
  /** Offscreen compositor: render at exact pixel size (never mutate canvas.width after GL init). */
  fixedBufferSize?: Ref<{ width: number; height: number }>;
  globalSpeed?: Ref<number>;
  paused?: Ref<boolean>;
};

// Layer fragment shaders (imported as strings via vite-plugin-glsl)
import gradientFrag from "#shared/shaders/layers/gradient.frag";
import meshFrag from "#shared/shaders/layers/mesh.frag";
import solidFrag from "#shared/shaders/layers/solid.frag";
import noiseFrag from "#shared/shaders/layers/noise.frag";
import distortionFrag from "#shared/shaders/layers/distortion.frag";
import ditherFrag from "#shared/shaders/layers/dither.frag";
import grainFrag from "#shared/shaders/layers/grain.frag";
import seamFrag from "#shared/shaders/layers/seam.frag";
import vignetteFrag from "#shared/shaders/layers/vignette.frag";
import compositeFillFrag from "#shared/shaders/layers/composite-fill.frag";
import hybridDissolveFrag from "#shared/shaders/layers/hybrid-dissolve.frag";
import resolveFrag from "#shared/shaders/layers/resolve.frag";
import outputFrag from "#shared/shaders/layers/output.frag";
import fullscreenVert from "#shared/shaders/layers/fullscreen.vert";

const FRAG_SHADERS: Record<string, string> = {
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
  resolve: resolveFrag,
  blit: outputFrag,
};

const GRADIENT_RESOLUTION = 256;

// ── Gradient texture helpers ────────────────────────────────────────

function hashGradientStops(stops: GradientStop[]): string {
  return stops
    .map((s) => `${s.color}@${s.position.toFixed(4)}`)
    .join("|");
}

function createGradientTexture(stops: GradientStop[]): THREE.CanvasTexture {
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

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function updateGradientTexture(
  texture: THREE.CanvasTexture,
  stops: GradientStop[],
) {
  const canvas = texture.image as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;

  const sorted = [...stops].sort((a, b) => a.position - b.position);
  const gradient = ctx.createLinearGradient(0, 0, GRADIENT_RESOLUTION, 0);
  for (const stop of sorted) {
    gradient.addColorStop(Math.max(0, Math.min(1, stop.position)), stop.color);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, GRADIENT_RESOLUTION, 1);
  texture.needsUpdate = true;
}

// ── Composable ──────────────────────────────────────────────────────

export function useMultiPassRenderer(
  canvasRef: Ref<HTMLCanvasElement | null>,
  passes: Ref<RenderPass[]> | ComputedRef<RenderPass[]>,
  options: RendererOptions = {},
) {
  const globalSpeed = options.globalSpeed ?? ref(1);
  const paused = options.paused ?? ref(false);
  const layersRef = options.layers;
  const getModulatedValue = options.getModulatedValue;
  const fixedBufferSize = options.fixedBufferSize;
  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.OrthographicCamera | null = null;
  let geometry: THREE.PlaneGeometry | null = null;
  let animationId: number | null = null;
  let exportLoopPaused = false;
  let accumulatedTime = 0;
  let lastFrameTime = 0;
  let savedExportState: {
    pixelRatio: number;
    bufferWidth: number;
    bufferHeight: number;
  } | null = null;

  const sampleLfosAtTime = options.sampleLfosAtTime;

  const renderTargets = new Map<string, THREE.WebGLRenderTarget>();
  const materials = new Map<string, THREE.ShaderMaterial>();

  // Cache gradient textures to avoid recreating every frame.
  // Keyed by a hash of the gradient stops.
  const gradientTextureCache = new Map<
    string,
    { hash: string; texture: THREE.CanvasTexture }
  >();

  // Track which shader type each material was built for, so we can detect
  // when a layer's type changes and recreate its material.
  const materialLayerTypes = new Map<string, string>();

  // Zero displacement encoded as RG=(0.5, 0.5), alpha=1 — bound when distort has no prior map
  let neutralDisplacementTexture: THREE.DataTexture | null = null;
  let blackTexture: THREE.DataTexture | null = null;

  function getNeutralDisplacementTexture(): THREE.DataTexture {
    if (!neutralDisplacementTexture) {
      const data = new Uint8Array([128, 128, 255, 255]);
      neutralDisplacementTexture = new THREE.DataTexture(
        data,
        1,
        1,
        THREE.RGBAFormat,
      );
      neutralDisplacementTexture.minFilter = THREE.LinearFilter;
      neutralDisplacementTexture.magFilter = THREE.LinearFilter;
      neutralDisplacementTexture.wrapS = THREE.ClampToEdgeWrapping;
      neutralDisplacementTexture.wrapT = THREE.ClampToEdgeWrapping;
      neutralDisplacementTexture.needsUpdate = true;
    }
    return neutralDisplacementTexture;
  }

  function getBlackTexture(): THREE.DataTexture {
    if (!blackTexture) {
      const data = new Uint8Array([0, 0, 0, 255]);
      blackTexture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
      blackTexture.minFilter = THREE.LinearFilter;
      blackTexture.magFilter = THREE.LinearFilter;
      blackTexture.wrapS = THREE.ClampToEdgeWrapping;
      blackTexture.wrapT = THREE.ClampToEdgeWrapping;
      blackTexture.needsUpdate = true;
    }
    return blackTexture;
  }

  // ── Gradient texture management ─────────────────────────────────

  function getOrUpdateGradientTexture(
    layerId: string,
    uniformName: string,
    stops: GradientStop[],
  ): THREE.CanvasTexture {
    const cacheKey = `${layerId}:${uniformName}`;
    const hash = hashGradientStops(stops);
    const cached = gradientTextureCache.get(cacheKey);

    if (cached && cached.hash === hash) {
      return cached.texture;
    }

    if (cached) {
      // Stops changed — update in place
      updateGradientTexture(cached.texture, stops);
      cached.hash = hash;
      return cached.texture;
    }

    // First time — create new
    const texture = createGradientTexture(stops);
    gradientTextureCache.set(cacheKey, { hash, texture });
    return texture;
  }

  function findLayerForPass(pass: RenderPass): LayerInstance | undefined {
    if (!layersRef?.value) return undefined;
    const direct = layersRef.value.find((l) => l.id === pass.layerId);
    if (direct) return direct;
    const baseId = pass.layerId.replace(/:stipple$/, "");
    if (baseId !== pass.layerId) {
      return layersRef.value.find((l) => l.id === baseId);
    }
    return undefined;
  }

  const COMPILED_UNIFORM_KEYS = [
    "shapeType",
    "passMode",
    "dissolveReach",
    "edgeWidth",
    "dotSize",
    "stippleSeed",
  ] as const;

  function resolveUniformValues(pass: RenderPass): Record<string, unknown> {
    if (pass.layerType === "resolve") return pass.uniforms;

    const layer = findLayerForPass(pass);
    const merged = layer
      ? {
          ...buildLayerUniforms(layer, getModulatedValue?.value ?? null),
          ...pass.uniforms,
        }
      : { ...pass.uniforms };

    for (const key of COMPILED_UNIFORM_KEYS) {
      if (pass.uniforms[key] !== undefined) {
        merged[key] = pass.uniforms[key];
      }
    }

    return merged;
  }

  // ── Build uniforms for a single pass ────────────────────────────

  function buildPassUniforms(
    pass: RenderPass,
    time: number,
    width: number,
    height: number,
    dpr: number,
  ): Record<string, { value: unknown }> {
    const uniformValues = resolveUniformValues(pass);

    const uniforms: Record<string, { value: unknown }> = {
      u_time: { value: time },
      u_resolution: { value: new THREE.Vector2(width, height) },
      u_scale: { value: dpr },
    };

    for (const [key, val] of Object.entries(uniformValues)) {
      if (GRADIENT_UNIFORM_NAMES.test(key) && Array.isArray(val)) {
        uniforms[key] = {
          value: getOrUpdateGradientTexture(
            pass.layerId,
            key,
            val as GradientStop[],
          ),
        };
      } else if (
        (key === "u_color" || /^u_color\d+$/.test(key)) &&
        typeof val === "string"
      ) {
        uniforms[key] = { value: new THREE.Color(val) };
      } else if (Array.isArray(val) && val.length === 2) {
        uniforms[key] = { value: new THREE.Vector2(val[0] as number, val[1] as number) };
      } else if (typeof val === "number" && INT_UNIFORMS.has(key)) {
        uniforms[key] = { value: Math.round(val) };
      } else {
        uniforms[key] = { value: val };
      }
    }

    if (pass.layerType === "distortion" && !pass.inputLayerId) {
      uniforms.u_input = { value: getNeutralDisplacementTexture() };
    } else if (pass.inputLayerId) {
      const inputRT = renderTargets.get(pass.inputLayerId);
      uniforms.u_input = { value: inputRT?.texture ?? getBlackTexture() };
      if (pass.layerType === "resolve" && inputRT) {
        uniforms.u_displacement = { value: inputRT.texture };
      }
    }

    uniforms.u_hasInput = { value: !!pass.inputLayerId };

    if (pass.stippleInputLayerId) {
      const stippleRT = renderTargets.get(pass.stippleInputLayerId);
      uniforms.u_hasStippleInput = { value: !!stippleRT };
      if (stippleRT) {
        uniforms.u_stipple = { value: stippleRT.texture };
      }
    } else {
      uniforms.u_hasStippleInput = { value: false };
    }

    if (pass.layerType === "resolve" && pass.colorSourceLayerId) {
      const colorRT = renderTargets.get(pass.colorSourceLayerId);
      if (colorRT) {
        uniforms.u_color = { value: colorRT.texture };
      }
    }

    return uniforms;
  }

  // ── Core render loop ────────────────────────────────────────────

  function render() {
    if (!renderer || !scene || !camera || !geometry) return;

    const now = performance.now() / 1000;
    const delta = lastFrameTime === 0 ? 0 : now - lastFrameTime;
    lastFrameTime = now;

    if (!paused.value) {
      accumulatedTime += delta * globalSpeed.value;
    }

    const time = accumulatedTime;
    const dpr = window.devicePixelRatio || 1;
    const width = renderer.domElement.width;
    const height = renderer.domElement.height;

    // Grain/dither use pixel-sized blocks (ditherScale * u_scale). Match shader-editor
    // density when rendering at a fixed artwork resolution smaller than the viewport.
    // Use design width (not export width) so 2×/4× exports keep the same grain density.
    let scaleUniform = dpr;
    if (fixedBufferSize) {
      const refWidth = Math.max(1, window.innerWidth);
      const designWidth = Math.max(1, fixedBufferSize.value.width);
      scaleUniform = designWidth / refWidth;
    }

    const currentPasses = passes.value;
    if (currentPasses.length === 0) {
      renderer.setRenderTarget(null);
      renderer.setClearColor(0x000000, 1);
      renderer.clear();
      return;
    }

    for (const pass of currentPasses) {
      // Ensure render target exists for non-output passes
      if (!pass.isOutput) {
        let rt = renderTargets.get(pass.layerId);
        const created = !rt;
        if (!rt) {
          rt = new THREE.WebGLRenderTarget(width, height, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            wrapS: THREE.ClampToEdgeWrapping,
            wrapT: THREE.ClampToEdgeWrapping,
          });
          rt.texture.wrapS = THREE.ClampToEdgeWrapping;
          rt.texture.wrapT = THREE.ClampToEdgeWrapping;
          renderTargets.set(pass.layerId, rt);
        }
        if (created) {
          renderer!.setRenderTarget(rt);
          renderer!.setClearColor(0x000000, 1);
          renderer!.clear();
        }
      }

      const uniforms = buildPassUniforms(pass, time, width, height, scaleUniform);

      if (pass.layerType === "resolve" && !uniforms.u_color) {
        continue;
      }

      // Get or create material (recreate if layer type changed)
      let material = materials.get(pass.layerId);
      const prevType = materialLayerTypes.get(pass.layerId);

      if (material && prevType !== pass.layerType) {
        // Layer type changed — dispose old material and recreate
        material.dispose();
        material = undefined;
        materials.delete(pass.layerId);
        materialLayerTypes.delete(pass.layerId);
      }

      const fragShader = pass.isOutput && !FRAG_SHADERS[pass.layerType]
        ? outputFrag
        : FRAG_SHADERS[pass.layerType];

      if (!material) {
        material = new THREE.ShaderMaterial({
          vertexShader: fullscreenVert,
          fragmentShader: fragShader,
          uniforms,
        });
        materials.set(pass.layerId, material);
        materialLayerTypes.set(pass.layerId, pass.layerType);
      } else {
        // Update existing uniforms in place
        for (const [key, entry] of Object.entries(uniforms)) {
          if (material.uniforms[key]) {
            material.uniforms[key].value = entry.value;
          } else {
            material.uniforms[key] = entry;
          }
        }
      }

      // Render this pass
      const mesh = new THREE.Mesh(geometry, material);
      scene.children.length = 0;
      scene.add(mesh);

      if (pass.isOutput) {
        renderer.setRenderTarget(null);
      } else {
        renderer.setRenderTarget(renderTargets.get(pass.layerId)!);
      }

      renderer.render(scene, camera);
    }

    // Always reset render target after all passes
    renderer.setRenderTarget(null);
  }

  function animate() {
    if (exportLoopPaused) return;
    animationId = requestAnimationFrame(animate);
    render();
  }

  function pauseAnimationLoop() {
    exportLoopPaused = true;
    paused.value = true;
    if (animationId !== null) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  }

  function resumeAnimationLoop() {
    exportLoopPaused = false;
    paused.value = false;
    lastFrameTime = 0;
    if (renderer && animationId === null) {
      animate();
    }
  }

  // ── Resize ──────────────────────────────────────────────────────

  function getCanvasRenderSize(canvas: HTMLCanvasElement) {
    const fixed = fixedBufferSize?.value;
    if (fixed && fixed.width >= 1 && fixed.height >= 1) {
      return { width: fixed.width, height: fixed.height, pixelRatio: 1 };
    }

    const rect = canvas.getBoundingClientRect();
    if (rect.width >= 1 && rect.height >= 1) {
      return { width: rect.width, height: rect.height, pixelRatio: window.devicePixelRatio };
    }
    return { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio };
  }

  function resizeRenderTargets() {
    if (!renderer) return;
    const rtWidth = renderer.domElement.width;
    const rtHeight = renderer.domElement.height;
    for (const rt of renderTargets.values()) {
      rt.setSize(rtWidth, rtHeight);
    }
  }

  function resize() {
    if (!renderer) return;
    const canvas = canvasRef.value;
    if (!canvas) return;

    const { width, height, pixelRatio } = getCanvasRenderSize(canvas);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    resizeRenderTargets();
  }

  // ── Init ────────────────────────────────────────────────────────

  function init() {
    const canvas = canvasRef.value;
    if (!canvas) return;

    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    const { width, height, pixelRatio } = getCanvasRenderSize(canvas);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);

    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    geometry = new THREE.PlaneGeometry(2, 2);

    animate();
    window.addEventListener("resize", resize);
  }

  // ── Cleanup ─────────────────────────────────────────────────────

  function destroy() {
    if (animationId !== null) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }

    window.removeEventListener("resize", resize);

    // Dispose render targets
    for (const rt of renderTargets.values()) {
      rt.dispose();
    }
    renderTargets.clear();

    // Dispose materials
    for (const material of materials.values()) {
      material.dispose();
    }
    materials.clear();
    materialLayerTypes.clear();

    // Dispose cached gradient textures
    for (const { texture } of gradientTextureCache.values()) {
      texture.dispose();
    }
    gradientTextureCache.clear();

    neutralDisplacementTexture?.dispose();
    neutralDisplacementTexture = null;
    blackTexture?.dispose();
    blackTexture = null;

    // Dispose shared geometry
    geometry?.dispose();
    geometry = null;

    // Dispose renderer
    renderer?.dispose();
    renderer = null;
    scene = null;
    camera = null;
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  // Watch for canvas ref becoming available (needed because <ClientOnly>
  // defers rendering, so the canvas isn't in the DOM at onMounted time)
  function passGraphSignature(activePasses: RenderPass[]): string {
    return activePasses
      .map((p) => `${p.layerId}:${p.layerType}:${p.inputLayerId}:${p.stippleInputLayerId}`)
      .join("|");
  }

  let lastPassGraphSignature = "";

  function pruneUnusedPassResources(activePasses: RenderPass[]) {
    const signature = passGraphSignature(activePasses);
    if (signature !== lastPassGraphSignature) {
      for (const rt of renderTargets.values()) {
        rt.dispose();
      }
      renderTargets.clear();
      for (const material of materials.values()) {
        material.dispose();
      }
      materials.clear();
      materialLayerTypes.clear();
      lastPassGraphSignature = signature;
    }

    const activeIds = new Set(activePasses.map((p) => p.layerId));

    for (const [id, rt] of renderTargets) {
      if (!activeIds.has(id)) {
        rt.dispose();
        renderTargets.delete(id);
      }
    }

    for (const [id, material] of materials) {
      if (!activeIds.has(id)) {
        material.dispose();
        materials.delete(id);
        materialLayerTypes.delete(id);
      }
    }
  }

  watch(
    () => passGraphSignature(passes.value),
    () => pruneUnusedPassResources(passes.value),
  );

  watch(canvasRef, (canvas) => {
    if (canvas && !renderer) {
      init();
    } else if (!canvas && renderer) {
      destroy();
    }
  }, { immediate: true });

  if (fixedBufferSize) {
    watch(
      () => `${fixedBufferSize.value.width}x${fixedBufferSize.value.height}`,
      () => {
        if (renderer) resize();
      },
    );
  }

  watch(
    () => passes.value.length,
    (len, prev) => {
      if (renderer && len > 0 && prev === 0) resize();
    },
  );

  onBeforeUnmount(destroy);

  function configureRenderer(width: number, height: number) {
    if (!renderer) return;
    if (!savedExportState) {
      const canvas = renderer.domElement;
      savedExportState = {
        pixelRatio: renderer.getPixelRatio(),
        bufferWidth: canvas.width,
        bufferHeight: canvas.height,
      };
    }
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    resizeRenderTargets();
  }

  function restoreRenderer() {
    if (!renderer || !savedExportState) return;
    const fixed = fixedBufferSize?.value;
    if (fixed && fixed.width >= 1 && fixed.height >= 1) {
      renderer.setPixelRatio(1);
      renderer.setSize(fixed.width, fixed.height, false);
    } else if (
      savedExportState.bufferWidth >= 1 &&
      savedExportState.bufferHeight >= 1
    ) {
      renderer.setPixelRatio(savedExportState.pixelRatio);
      renderer.setSize(
        savedExportState.bufferWidth,
        savedExportState.bufferHeight,
        false,
      );
    } else {
      renderer.setPixelRatio(savedExportState.pixelRatio);
      resize();
    }
    resizeRenderTargets();
    savedExportState = null;
    render();
  }

  function renderFrame(time: number) {
    sampleLfosAtTime?.(time);
    accumulatedTime = time;
    lastFrameTime = performance.now() / 1000;
    render();
  }

  async function capture(
    width: number,
    height: number,
    filename: string,
  ): Promise<void> {
    if (!renderer) return;

    pauseAnimationLoop();
    configureRenderer(width, height);
    renderFrame(accumulatedTime);

    const blob = await new Promise<Blob | null>((resolve) => {
      renderer!.domElement.toBlob(resolve, "image/png");
    });

    restoreRenderer();
    resumeAnimationLoop();

    if (blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  return {
    pause: pauseAnimationLoop,
    resume: resumeAnimationLoop,
    getCanvas: (): HTMLCanvasElement | null => renderer?.domElement ?? null,
    syncCanvasSize: resize,
    configureRenderer,
    restoreRenderer,
    renderFrame,
    capture,
  };
}
