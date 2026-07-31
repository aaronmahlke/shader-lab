import { useElementSize } from "@vueuse/core";
import {
  EditorKeyboardPriority,
  useEditorKeyboard,
} from "~/composables/use-editor-keyboard";

export type ViewportSize = { width: number; height: number };

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 16;
const FIT_PADDING = 48;
/** At least this many screen px of artboard must stay inside the viewport. */
const MIN_VISIBLE_PX = 64;
const ZOOM_STEPS = [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];

/**
 * Figma-style viewport: the composition is an artboard on a pasteboard.
 * Ctrl/cmd+wheel zooms to the cursor, plain wheel pans, middle-mouse drags
 * pan. Zoom 1 = one composition pixel per CSS pixel.
 *
 * Starts in fit mode: the artboard auto-fits on container/composition size
 * changes until the user zooms or pans manually. `fit()` re-enters the mode.
 */
export function useViewport(
  containerRef: Ref<HTMLElement | null>,
  artboardSize: Ref<ViewportSize>,
) {
  const zoom = ref(1);
  const pan = ref({ x: 0, y: 0 });
  const panning = ref(false);
  /** Sticky fit: keep the artboard fitted until the user takes over. */
  const fitMode = ref(true);

  const { width: containerW, height: containerH } = useElementSize(containerRef);

  const artboardStyle = computed(() => ({
    width: `${artboardSize.value.width}px`,
    height: `${artboardSize.value.height}px`,
    transform: `translate(${pan.value.x}px, ${pan.value.y}px) scale(${zoom.value})`,
    transformOrigin: "0 0",
  }));

  const zoomPercent = computed(() => Math.round(zoom.value * 100));

  function clampZoom(z: number): number {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
  }

  /** Keep some artboard on screen — the view can never be lost entirely. */
  function clampPan(p: { x: number; y: number }, z: number): { x: number; y: number } {
    const aw = artboardSize.value.width * z;
    const ah = artboardSize.value.height * z;
    const cw = containerW.value;
    const ch = containerH.value;
    if (cw < 1 || ch < 1) return p;
    const margin = Math.min(MIN_VISIBLE_PX, aw / 2, ah / 2);
    return {
      x: Math.min(cw - margin, Math.max(margin - aw, p.x)),
      y: Math.min(ch - margin, Math.max(margin - ah, p.y)),
    };
  }

  /** Zoom keeping the given container-space point stationary. */
  function zoomAt(nextZoom: number, focal?: { x: number; y: number }) {
    const z = clampZoom(nextZoom);
    const f = focal ?? { x: containerW.value / 2, y: containerH.value / 2 };
    const worldX = (f.x - pan.value.x) / zoom.value;
    const worldY = (f.y - pan.value.y) / zoom.value;
    pan.value = clampPan({ x: f.x - worldX * z, y: f.y - worldY * z }, z);
    zoom.value = z;
    fitMode.value = false;
  }

  function fit() {
    const cw = containerW.value;
    const ch = containerH.value;
    const { width: aw, height: ah } = artboardSize.value;
    if (cw < 1 || ch < 1 || aw < 1 || ah < 1) return;
    const z = clampZoom(
      Math.min((cw - FIT_PADDING * 2) / aw, (ch - FIT_PADDING * 2) / ah),
    );
    zoom.value = z;
    pan.value = { x: (cw - aw * z) / 2, y: (ch - ah * z) / 2 };
    fitMode.value = true;
  }

  function zoomTo100() {
    zoomAt(1);
  }

  function stepZoom(direction: 1 | -1) {
    const current = zoom.value;
    const next =
      direction === 1
        ? ZOOM_STEPS.find((s) => s > current * 1.001) ?? MAX_ZOOM
        : [...ZOOM_STEPS].reverse().find((s) => s < current * 0.999) ?? MIN_ZOOM;
    zoomAt(next);
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const rect = containerRef.value?.getBoundingClientRect();
    if (!rect) return;
    if (e.ctrlKey || e.metaKey) {
      // Pinch / ctrl+wheel: zoom to cursor.
      const factor = Math.exp(-e.deltaY * 0.01);
      zoomAt(zoom.value * factor, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    } else {
      pan.value = clampPan(
        { x: pan.value.x - e.deltaX, y: pan.value.y - e.deltaY },
        zoom.value,
      );
      fitMode.value = false;
    }
  }

  /** Middle-mouse drag pans (space stays reserved for playback). */
  function onPointerDown(e: PointerEvent): boolean {
    if (e.button !== 1) return false;
    e.preventDefault();
    e.stopPropagation();
    panning.value = true;
    const start = { x: e.clientX, y: e.clientY };
    const startPan = { ...pan.value };

    function onMove(ev: PointerEvent) {
      pan.value = clampPan(
        {
          x: startPan.x + (ev.clientX - start.x),
          y: startPan.y + (ev.clientY - start.y),
        },
        zoom.value,
      );
      fitMode.value = false;
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      panning.value = false;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return true;
  }

  // Zoom shortcuts: cmd/ctrl +/-/0 (fit) /1 (100%).
  const { register } = useEditorKeyboard();
  register({
    id: "viewport:zoom",
    priority: EditorKeyboardPriority.transport,
    handle(e) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return false;
      if (e.key === "=" || e.key === "+") {
        stepZoom(1);
        return true;
      }
      if (e.key === "-") {
        stepZoom(-1);
        return true;
      }
      if (e.key === "0") {
        fit();
        return true;
      }
      if (e.key === "1") {
        zoomTo100();
        return true;
      }
      return false;
    },
  });

  // Fit mode: track container and composition size changes.
  watch([containerW, containerH], ([w, h]) => {
    if (w < 1 || h < 1) return;
    if (fitMode.value) fit();
    else pan.value = clampPan(pan.value, zoom.value);
  });
  watch(artboardSize, () => {
    if (fitMode.value) fit();
    else pan.value = clampPan(pan.value, zoom.value);
  });

  return {
    zoom,
    pan,
    zoomPercent,
    panning,
    fitMode,
    artboardStyle,
    fit,
    zoomTo100,
    stepZoom,
    zoomAt,
    onWheel,
    onPointerDown,
  };
}
