import type { ArtworkDocument, ArtworkTextLayer } from "#shared/types/artwork";
import {
  applySnapToRect,
  type PxRect,
  type SnapOverlay,
} from "#shared/artwork/canvas-snap";
import { setUniformMediaScale } from "#shared/artwork/media-scale";
import {
  type ArtworkLayerCaches,
  type ArtworkRect,
  type HandleId,
  type TransformableLayer,
  hitTestHandle,
  isCornerHandle,
  isTransformableLayer,
  measureLayerPx,
  pickTransformableLayer,
  pxRectToNormalized,
  setLayerFromPxRect,
} from "#shared/artwork/layer-bounds";

type DragMode = "move" | "scale";

function isEditableTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

export function useArtworkCanvasControls(
  stageRef: Ref<HTMLElement | null>,
  artwork: Ref<ArtworkDocument>,
  selectedLayerId: Ref<string | null>,
  layerCaches: Ref<ArtworkLayerCaches>,
  options?: {
    editingLayerId?: Ref<string | null>;
    onDeleteLayer?: (layerId: string) => void;
  },
) {
  const measureCtx = shallowRef<CanvasRenderingContext2D | null>(null);

  onMounted(() => {
    const canvas = document.createElement("canvas");
    measureCtx.value = canvas.getContext("2d");
  });

  const selectedLayer = computed(() => {
    const id = selectedLayerId.value;
    if (!id) return null;
    const layer = artwork.value.layers.find((l) => l.id === id);
    return layer && isTransformableLayer(layer) ? layer : null;
  });

  const selectionRect = computed((): ArtworkRect | null => {
    const layer = selectedLayer.value;
    const ctx = measureCtx.value;
    if (!layer || !ctx) return null;
    const px = measureLayerPx(ctx, artwork.value.canvas, layer, layerCaches.value);
    if (!px) return null;
    return pxRectToNormalized(px, artwork.value.canvas);
  });

  function stageRect(): DOMRect | null {
    return stageRef.value?.getBoundingClientRect() ?? null;
  }

  /** Client coords → artwork norm (x 0–1 left, y 0–1 from bottom). */
  function clientToNorm(clientX: number, clientY: number) {
    const rect = stageRect();
    if (!rect) return { x: 0.5, y: 0.5 };
    const x = (clientX - rect.left) / rect.width;
    const y = 1 - (clientY - rect.top) / rect.height;
    return {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    };
  }

  function normDeltaToPx(dx: number, dy: number) {
    const { width, height } = artwork.value.canvas;
    return { dx: dx * width, dy: -dy * height };
  }

  function collectLayerRects(excludeId?: string) {
    const ctx = measureCtx.value;
    if (!ctx) return [] as { id: string; rect: PxRect }[];

    const out: { id: string; rect: PxRect }[] = [];
    for (const layer of artwork.value.layers) {
      if (!layer.enabled || !isTransformableLayer(layer)) continue;
      if (excludeId && layer.id === excludeId) continue;
      if ((layer.type === "image" || layer.type === "video") && !layer.src) continue;
      const px = measureLayerPx(ctx, artwork.value.canvas, layer, layerCaches.value);
      if (px) out.push({ id: layer.id, rect: px });
    }
    return out;
  }

  function measureLayerRect(layer: TransformableLayer): PxRect | null {
    const ctx = measureCtx.value;
    if (!ctx) return null;
    return measureLayerPx(ctx, artwork.value.canvas, layer, layerCaches.value);
  }

  const snapOverlay = ref<SnapOverlay | null>(null);

  function clearSnapOverlay() {
    snapOverlay.value = null;
  }

  const dragMode = ref<DragMode | null>(null);
  let activeHandle: HandleId | null = null;
  const dragLayerId = ref<string | null>(null);
  let pointerStart = { x: 0, y: 0 };
  let scaleStart = 1;
  let scaleStartX = 1;
  let scaleStartY = 1;
  let intrinsicSize = { w: 1, h: 1 };
  let rectStart: ArtworkRect | null = null;
  let dragRectStart: PxRect | null = null;

  function applyMoveWithSnap(
    layer: TransformableLayer,
    norm: { x: number; y: number },
  ) {
    const ctx = measureCtx.value;
    if (!ctx || !dragRectStart) return;

    const { dx, dy } = normDeltaToPx(
      norm.x - pointerStart.x,
      norm.y - pointerStart.y,
    );

    const proposed: PxRect = {
      left: dragRectStart.left + dx,
      top: dragRectStart.top + dy,
      width: dragRectStart.width,
      height: dragRectStart.height,
    };

    const result = applySnapToRect(
      proposed,
      artwork.value.canvas,
      collectLayerRects(),
      layer.id,
    );

    snapOverlay.value = { guides: result.guides, distances: result.distances };
    setLayerFromPxRect(ctx, artwork.value.canvas, layer, result.rect);
  }

  function nudgeLayer(
    layer: TransformableLayer,
    dxPx: number,
    dyPx: number,
  ) {
    const ctx = measureCtx.value;
    const rect = measureLayerRect(layer);
    if (!ctx || !rect) return;

    const proposed: PxRect = {
      left: rect.left + dxPx,
      top: rect.top + dyPx,
      width: rect.width,
      height: rect.height,
    };

    const result = applySnapToRect(
      proposed,
      artwork.value.canvas,
      collectLayerRects(),
      layer.id,
    );

    snapOverlay.value = { guides: result.guides, distances: result.distances };
    setLayerFromPxRect(ctx, artwork.value.canvas, layer, result.rect);
  }

  function pickAt(clientX: number, clientY: number) {
    const ctx = measureCtx.value;
    if (!ctx) return null;
    const norm = clientToNorm(clientX, clientY);
    return pickTransformableLayer(
      ctx,
      artwork.value.canvas,
      artwork.value.layers,
      norm.x,
      norm.y,
      layerCaches.value,
    );
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    if (options?.editingLayerId?.value) return;
    const ctx = measureCtx.value;
    if (!ctx) return;

    stageRef.value?.focus();

    const norm = clientToNorm(e.clientX, e.clientY);
    const rect = selectionRect.value;

    if (rect && selectedLayer.value) {
      const handle = hitTestHandle(rect, norm.x, norm.y);
      if (handle) {
        activeHandle = handle;
        dragMode.value = "scale";
        dragLayerId.value = selectedLayer.value.id;
        pointerStart = { x: norm.x, y: norm.y };
        rectStart = { ...rect };
        clearSnapOverlay();
        if (selectedLayer.value.type === "text") {
          scaleStart = selectedLayer.value.fontSize;
        } else {
          scaleStart = selectedLayer.value.scale;
          scaleStartX = selectedLayer.value.scaleX ?? selectedLayer.value.scale;
          scaleStartY = selectedLayer.value.scaleY ?? selectedLayer.value.scale;
          const measured = measureLayerRect(selectedLayer.value);
          if (measured) {
            intrinsicSize = {
              w: measured.width / scaleStartX,
              h: measured.height / scaleStartY,
            };
          }
        }
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
    }

    const picked = pickTransformableLayer(
      ctx,
      artwork.value.canvas,
      artwork.value.layers,
      norm.x,
      norm.y,
      layerCaches.value,
    );

    if (picked) {
      if (selectedLayerId.value !== picked.id) {
        selectedLayerId.value = picked.id;
      }
      dragMode.value = "move";
      dragLayerId.value = picked.id;
      pointerStart = { x: norm.x, y: norm.y };
      dragRectStart = measureLayerRect(picked);
      clearSnapOverlay();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    selectedLayerId.value = null;
    clearSnapOverlay();
  }

  function normToTopLeft(norm: { x: number; y: number }) {
    return { x: norm.x, y: 1 - norm.y };
  }

  function applyCornerScale(layer: TransformableLayer, cur: { x: number; y: number }) {
    if (!rectStart) return;

    const cx = rectStart.x + rectStart.width / 2;
    const cy = rectStart.y + rectStart.height / 2;
    const start = normToTopLeft(pointerStart);
    const center = { x: cx, y: cy };

    const startDist = Math.hypot(start.x - center.x, start.y - center.y);
    const curDist = Math.hypot(cur.x - center.x, cur.y - center.y);
    const scaleFactor = curDist / Math.max(startDist, 0.001);
    const clamped = Math.max(0.15, Math.min(8, scaleFactor));

    if (layer.type === "text") {
      layer.fontSize = Math.max(8, Math.round(scaleStart * clamped));
      return;
    }

    const s = Math.max(0.05, scaleStart * clamped);
    setUniformMediaScale(layer, s);
  }

  function applyEdgeScale(layer: TransformableLayer, handle: HandleId, cur: { x: number; y: number }) {
    if (!rectStart || !activeHandle) return;

    const west0 = rectStart.x;
    const east0 = rectStart.x + rectStart.width;
    const north0 = rectStart.y;
    const south0 = rectStart.y + rectStart.height;

    let west = west0;
    let east = east0;
    let north = north0;
    let south = south0;

    if (handle.includes("w")) west = Math.min(cur.x, east0 - 0.005);
    if (handle.includes("e")) east = Math.max(cur.x, west0 + 0.005);
    if (handle.includes("n")) north = Math.min(cur.y, south0 - 0.005);
    if (handle.includes("s")) south = Math.max(cur.y, north0 + 0.005);

    const newWidth = Math.max(0.005, east - west);
    const newHeight = Math.max(0.005, south - north);
    const widthRatio = newWidth / Math.max(rectStart.width, 0.001);
    const heightRatio = newHeight / Math.max(rectStart.height, 0.001);

    const centerX = west + newWidth / 2;
    const centerY = north + newHeight / 2;
    layer.x = centerX;
    layer.y = 1 - centerY;

    if (layer.type === "text") {
      if (handle === "e" || handle === "w") {
        layer.fontSize = Math.max(8, Math.round(scaleStart * widthRatio));
      } else {
        layer.fontSize = Math.max(8, Math.round(scaleStart * heightRatio));
      }
      return;
    }

    const { width: cw, height: ch } = artwork.value.canvas;
    const newWidthPx = newWidth * cw;
    const newHeightPx = newHeight * ch;

    if (handle === "e" || handle === "w") {
      setUniformMediaScale(layer, Math.max(0.05, newWidthPx / intrinsicSize.w));
    } else {
      setUniformMediaScale(layer, Math.max(0.05, newHeightPx / intrinsicSize.h));
    }
  }

  function applyResize(layer: TransformableLayer, norm: { x: number; y: number }) {
    const cur = normToTopLeft(norm);
    if (activeHandle && isCornerHandle(activeHandle)) {
      applyCornerScale(layer, cur);
    } else if (activeHandle) {
      applyEdgeScale(layer, activeHandle, cur);
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragMode.value || !dragLayerId.value) return;
    const layer = artwork.value.layers.find((l) => l.id === dragLayerId.value);
    if (!layer || !isTransformableLayer(layer)) return;

    const norm = clientToNorm(e.clientX, e.clientY);
    if (dragMode.value === "move") {
      applyMoveWithSnap(layer, norm);
    } else {
      applyResize(layer, norm);
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (dragMode.value) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
    dragMode.value = null;
    activeHandle = null;
    dragLayerId.value = null;
    rectStart = null;
    dragRectStart = null;
    clearSnapOverlay();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (isEditableTarget(e.target)) return;
    if (options?.editingLayerId?.value) return;

    if (e.key === "Backspace" || e.key === "Delete") {
      const id = selectedLayerId.value;
      if (id && options?.onDeleteLayer) {
        e.preventDefault();
        options.onDeleteLayer(id);
      }
      return;
    }

    const layer = selectedLayer.value;
    if (!layer) return;

    const step = e.shiftKey ? 10 : 1;
    let dx = 0;
    let dy = 0;

    switch (e.key) {
      case "ArrowLeft":
        dx = -step;
        break;
      case "ArrowRight":
        dx = step;
        break;
      case "ArrowUp":
        dy = -step;
        break;
      case "ArrowDown":
        dy = step;
        break;
      default:
        return;
    }

    e.preventDefault();
    stageRef.value?.focus();
    nudgeLayer(layer, dx, dy);

    if (nudgeOverlayTimer) clearTimeout(nudgeOverlayTimer);
    nudgeOverlayTimer = setTimeout(() => {
      clearSnapOverlay();
      nudgeOverlayTimer = null;
    }, 1200);
  }

  let nudgeOverlayTimer: ReturnType<typeof setTimeout> | null = null;

  onMounted(() => {
    window.addEventListener("keydown", onKeyDown);
  });

  onUnmounted(() => {
    window.removeEventListener("keydown", onKeyDown);
    if (nudgeOverlayTimer) clearTimeout(nudgeOverlayTimer);
  });

  /** CSS % styles for overlay box from normalized rect (top-left origin). */
  const selectionStyle = computed(() => {
    const r = selectionRect.value;
    if (!r) return null;
    return {
      left: `${r.x * 100}%`,
      top: `${r.y * 100}%`,
      width: `${r.width * 100}%`,
      height: `${r.height * 100}%`,
    };
  });

  const handles = computed(() => {
    const r = selectionRect.value;
    if (!r) return [];
    const positions: { id: HandleId; left: string; top: string }[] = [
      { id: "nw", left: "0%", top: "0%" },
      { id: "n", left: "50%", top: "0%" },
      { id: "ne", left: "100%", top: "0%" },
      { id: "w", left: "0%", top: "50%" },
      { id: "e", left: "100%", top: "50%" },
      { id: "sw", left: "0%", top: "100%" },
      { id: "s", left: "50%", top: "100%" },
      { id: "se", left: "100%", top: "100%" },
    ];
    return positions.map((p) => ({
      id: p.id,
      style: {
        left: p.left,
        top: p.top,
        transform: "translate(-50%, -50%)",
      },
    }));
  });

  return {
    selectionRect,
    selectionStyle,
    handles,
    snapOverlay,
    pickAt,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    isDragging: computed(() => dragMode.value !== null),
  };
}
