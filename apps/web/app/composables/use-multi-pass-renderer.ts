import {
  CompositionRenderer,
  type ModulationFn,
  type RenderPass,
  type LayerInstance,
} from "@shader-lab/core";

type RendererOptions = {
  layers?: Ref<LayerInstance[]>;
  tracks?: Ref<unknown[]>;
  getModulatedValue?: Ref<ModulationFn | null>;
  sampleLfosAtTime?: (time: number) => void;
  fixedBufferSize?: Ref<{ width: number; height: number }>;
  globalSpeed?: Ref<number>;
  paused?: Ref<boolean>;
  /** When set, drives render time instead of internal clock. */
  compositionTime?: Ref<number>;
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

  function scheduleCompositionRender() {
    if (import.meta.server || !renderer) return;
    if (compositionRenderRaf !== null) return;
    compositionRenderRaf = requestAnimationFrame(() => {
      compositionRenderRaf = null;
      render();
    });
  }

  function findLayerForPass(pass: RenderPass): LayerInstance | undefined {
    if (!layersRef?.value) return undefined;
    return layersRef.value.find((l) => l.id === pass.layerId);
  }

  function render() {
    if (!renderer) return;

    const time = compositionTime?.value ?? accumulatedTime;

    sampleLfosAtTime?.(time);

    renderer.renderFrame(
      time,
      passes.value,
      getModulatedValue?.value ?? null,
    );
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
    if (renderer && animationId === null) {
      animate();
    }
  }

  function resize() {
    if (!renderer || !canvasRef.value) return;
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

  watch(
    () => getModulatedValue?.value,
    (fn) => {
      renderer?.setOptions({ getModulatedValue: fn ?? null });
    },
  );

  if (compositionTime) {
    watch(compositionTime, scheduleCompositionRender, { immediate: true });
  }

  if (layersRef || tracksRef) {
    watch(
      [layersRef, tracksRef].filter(Boolean) as Ref<unknown>[],
      () => render(),
      { deep: true },
    );
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

  function renderFrame(time: number) {
    sampleLfosAtTime?.(time);
    accumulatedTime = time;
    lastFrameTime = performance.now() / 1000;
    render();
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
  };
}
