import {
  CompositionRenderer,
  createNestedResolvers,
  resolveLayerById,
  type ComponentSourceInput,
  type CompositionConfig,
  type MediaSource,
  type ModulationFn,
  type RenderPass,
  type LayerInstance,
} from "@shader-lab/core";

type RendererOptions = {
  layers?: Ref<LayerInstance[]>;
  tracks?: Ref<unknown[]>;
  getModulatedValue?: Ref<ModulationFn | null>;
  /** Registry lookup for nested composition layers (enables `::`-prefixed passes). */
  resolveComposition?: (compId: string) => CompositionConfig | null;
  sampleLfosAtTime?: (time: number) => void;
  fixedBufferSize?: Ref<{ width: number; height: number }>;
  /** Reference width for u_scale (composition native width). */
  scaleReferenceWidth?: Ref<number>;
  /** Composition height — reference for text raster scale. */
  contentReferenceHeight?: Ref<number>;
  globalSpeed?: Ref<number>;
  paused?: Ref<boolean>;
  /** When set, drives render time instead of internal clock. */
  compositionTime?: Ref<number>;
  /** Motion blur: sub-frame times for a frame (just [time] when off). */
  motionBlurTimes?: (time: number) => number[];
  /** Modulation fn at an arbitrary time (motion blur sub-frames). */
  modFnAt?: (time: number) => ModulationFn;
};

export function useMultiPassRenderer(
  canvasRef: Ref<HTMLCanvasElement | null>,
  passes: Ref<RenderPass[]> | ComputedRef<RenderPass[]>,
  options: RendererOptions = {},
) {
  const globalSpeed = options.globalSpeed ?? ref(1);
  const paused = options.paused ?? ref(false);
  const layersRef = options.layers;
  const tracksRef = options.tracks;
  const getModulatedValue = options.getModulatedValue;
  const fixedBufferSize = options.fixedBufferSize;
  const sampleLfosAtTime = options.sampleLfosAtTime;
  const compositionTime = options.compositionTime;

  let renderer: CompositionRenderer | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let animationId: number | null = null;
  let exportLoopPaused = false;
  let accumulatedTime = 0;
  let lastFrameTime = 0;
  let savedExportState: {
    pixelRatio: number;
    bufferWidth: number;
    bufferHeight: number;
  } | null = null;
  let compositionRenderRaf: number | null = null;

  /** Off while the frame cache shows frames (playback / scrubbing over cached frames). */
  let liveRenderEnabled = true;

  function scheduleRender() {
    if (import.meta.server || !renderer || !liveRenderEnabled) return;
    if (compositionRenderRaf !== null) return;
    compositionRenderRaf = requestAnimationFrame(() => {
      compositionRenderRaf = null;
      render();
    });
  }

  /**
   * Per-frame nested resolvers (nested composition layers only). The renderer
   * captures `findLayerForPass` once at construction, so the render loop
   * updates this closure variable each frame and the static option functions
   * delegate to it. Resolvers must be rebuilt per frame: they evaluate nested
   * keyframes/LFOs at the host layer's LOCAL time, which depends on `time`.
   */
  let nestedResolvers: ReturnType<typeof createNestedResolvers> | null = null;

  function findLayerForPass(pass: RenderPass): LayerInstance | undefined {
    if (nestedResolvers) return nestedResolvers.findLayer(pass);
    if (!layersRef?.value) return undefined;
    // Includes cloner copies (virtual layers).
    return resolveLayerById(layersRef.value, pass.sourceLayerId ?? pass.layerId);
  }

  function hasCompositionLayers(): boolean {
    return layersRef?.value.some((l) => l.type === "composition") ?? false;
  }

  function render(timeOverride?: number) {
    if (!renderer) return;

    const time = timeOverride ?? compositionTime?.value ?? accumulatedTime;

    sampleLfosAtTime?.(time);

    // Per (sub-)frame: the modulation fn at that time, plus nested comp
    // resolvers when composition layers exist (findLayer reads them).
    const prepare = (t: number): ModulationFn | null => {
      // The live modFn evaluates at the playhead; off-playhead renders (frame cache,
      // motion-blur sub-frames) evaluate at their own time.
      const modFn = (t === time && timeOverride === undefined) || !options.modFnAt
        ? getModulatedValue?.value ?? null
        : options.modFnAt(t);
      if (options.resolveComposition && layersRef?.value && hasCompositionLayers()) {
        nestedResolvers = createNestedResolvers({
          layers: layersRef.value,
          parentModFn: modFn,
          resolveComposition: options.resolveComposition,
          time: t,
        });
      } else {
        nestedResolvers = null;
      }
      return nestedResolvers?.modFn ?? modFn;
    };

    const times = options.modFnAt && options.motionBlurTimes ? options.motionBlurTimes(time) : [time];
    renderer.renderFrameSamples(times, passes.value, prepare, time);
    // Leave the engine sampled at the frame time for UI reads.
    if (times.length > 1) sampleLfosAtTime?.(time);
  }

  function animate() {
    if (exportLoopPaused || compositionTime) return;
    animationId = requestAnimationFrame(animate);
    const now = performance.now() / 1000;
    const delta = lastFrameTime === 0 ? 0 : now - lastFrameTime;
    lastFrameTime = now;

    if (!paused.value) {
      accumulatedTime += delta * globalSpeed.value;
    }
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
    resize();
    if (renderer && animationId === null) {
      animate();
    }
  }

  function resize() {
    // During export the buffer is driven explicitly (configureRenderer);
    // resizing the buffer changes the canvas box, which fires the
    // ResizeObserver, which would snap the buffer back to viewport size
    // mid-export and break the encoder's constant-size requirement.
    if (!renderer || !canvasRef.value || exportLoopPaused) return;
    const rect = canvasRef.value.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    renderer.syncCanvasSize();
    render();
  }

  function init() {
    const canvas = canvasRef.value;
    if (!canvas) return;

    renderer = new CompositionRenderer(canvas, {
      fixedBufferSize: fixedBufferSize?.value,
      scaleReferenceWidth: options.scaleReferenceWidth?.value,
      contentReferenceHeight: options.contentReferenceHeight?.value,
      findLayer: findLayerForPass,
      getModulatedValue: getModulatedValue?.value ?? null,
    });
    renderer.syncCanvasSize();
    if (compositionTime) {
      render();
    } else {
      animate();
    }
    window.addEventListener("resize", resize);

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => resize());
      resizeObserver.observe(canvas);
    }
  }

  // Live buffer size changes (viewport zoom): resize without recreating the renderer.
  if (fixedBufferSize) {
    watch(fixedBufferSize, (size) => {
      if (!renderer || exportLoopPaused) return;
      renderer.setFixedBufferSize(size, options.scaleReferenceWidth?.value);
      render();
    });
  }

  function destroy() {
    if (animationId !== null) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    if (compositionRenderRaf !== null) {
      cancelAnimationFrame(compositionRenderRaf);
      compositionRenderRaf = null;
    }
    window.removeEventListener("resize", resize);
    resizeObserver?.disconnect();
    resizeObserver = null;
    renderer?.dispose();
    renderer = null;
  }

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
        if (exportLoopPaused) return;
        renderer?.setOptions({ fixedBufferSize: fixedBufferSize.value });
        renderer?.syncCanvasSize();
      },
    );
  }

  watch(
    () => passes.value.length,
    (len, prev) => {
      if (renderer && len > 0 && prev === 0) resize();
    },
  );

  // Recompiles that keep the pass count (e.g. a nested composition arriving
  // in the registry) still need a redraw — the paused loop won't pick the new
  // pass array up on its own.
  watch(passes, scheduleRender);

  watch(
    () => getModulatedValue?.value,
    (fn) => {
      renderer?.setOptions({ getModulatedValue: fn ?? null });
    },
  );

  if (compositionTime) {
    watch(compositionTime, scheduleRender, { immediate: true });
  }

  if (layersRef || tracksRef) {
    watch(
      [layersRef, tracksRef].filter(Boolean) as Ref<unknown>[],
      scheduleRender,
      { deep: true },
    );
  }

  // Text layers draw with a fallback until their web font arrives; the core
  // invalidates its text cache on load, the paused loop needs a nudge to redraw.
  if (typeof document !== "undefined" && document.fonts) {
    document.fonts.addEventListener("loadingdone", scheduleRender);
    onBeforeUnmount(() => document.fonts.removeEventListener("loadingdone", scheduleRender));
  }

  onBeforeUnmount(destroy);

  function configureRenderer(width: number, height: number) {
    if (!renderer) return;
    const canvas = renderer.getCanvas();
    if (!savedExportState) {
      savedExportState = {
        pixelRatio: 1,
        bufferWidth: canvas.width,
        bufferHeight: canvas.height,
      };
    }
    renderer.resize(width, height, 1);
  }

  function restoreRenderer() {
    if (!renderer || !savedExportState) return;
    const fixed = fixedBufferSize?.value;
    if (fixed && fixed.width >= 1 && fixed.height >= 1) {
      renderer.setOptions({ fixedBufferSize: fixed });
      renderer.resize(fixed.width, fixed.height, 1);
    } else if (
      savedExportState.bufferWidth >= 1 &&
      savedExportState.bufferHeight >= 1
    ) {
      renderer.resize(
        savedExportState.bufferWidth,
        savedExportState.bufferHeight,
        savedExportState.pixelRatio,
      );
    } else {
      renderer.syncCanvasSize();
    }
    savedExportState = null;
    render();
  }

  /** Render exactly `time` (not necessarily the playhead: the frame cache renders ahead). */
  function renderFrame(time: number) {
    sampleLfosAtTime?.(time);
    accumulatedTime = time;
    lastFrameTime = performance.now() / 1000;
    render(time);
  }

  function setLiveRenderEnabled(enabled: boolean) {
    if (liveRenderEnabled === enabled) return;
    liveRenderEnabled = enabled;
    if (enabled) scheduleRender();
  }

  /** Push (or clear) a captured component frame for a layer. */
  /** What the last frame needed from a component's capture (zoom-aware scale, visible rect). */
  function getComponentView(layerId: string) {
    return renderer?.getComponentView(layerId) ?? null;
  }

  function setComponentSource(layerId: string, source: ComponentSourceInput | null): void {
    renderer?.setComponentSource(layerId, source);
  }

  /** Push (or clear) the latest decoded media frame for an image/video layer. */
  function setMediaSource(layerId: string, source: MediaSource | null): void {
    renderer?.setMediaSource(layerId, source);
  }

  async function capture(width: number, height: number, filename: string): Promise<void> {
    if (!renderer) return;

    pauseAnimationLoop();
    configureRenderer(width, height);
    renderFrame(accumulatedTime);

    const blob = await renderer.captureBlob();
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
    getCanvas: (): HTMLCanvasElement | null => renderer?.getCanvas() ?? null,
    syncCanvasSize: resize,
    configureRenderer,
    restoreRenderer,
    renderFrame,
    capture,
    setComponentSource,
    getComponentView,
    setMediaSource,
    requestRender: scheduleRender,
    setLiveRenderEnabled,
  };
}
