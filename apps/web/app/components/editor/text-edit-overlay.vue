<script setup lang="ts">
import type { LayerInstance } from "@shader-lab/core";
import type { LayerTransformValues } from "#shared/editor/layer-transform";
import type { TextEditIntent } from "#shared/editor/canvas-tool";

/**
 * Inline editor for a text layer, rendered inside the (zoom-scaled) artboard.
 * Mirrors core's `drawTextSpec` layout — full-frame block, lines centered
 * vertically, alignment padding — and applies the layer's universal transform
 * as CSS, so the DOM text sits exactly where the raster draws it. The GL
 * layer is hidden while this is mounted; `layer.values.content` is written
 * live on input.
 */
const props = defineProps<{
  layer: LayerInstance;
  comp: { width: number; height: number };
  transform: LayerTransformValues;
  intent: TextEditIntent;
}>();

const emit = defineEmits<{ commit: [] }>();

const editorRef = ref<HTMLDivElement | null>(null);
/** Bumped when fonts finish loading so metrics recompute. */
const metricsTick = ref(0);

let measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (!measureCtx) {
    measureCtx = document.createElement("canvas").getContext("2d");
  }
  return measureCtx;
}

/** Style/layout fields of the layer, mirroring core's `textSpecFromValues`. */
const spec = computed(() => {
  const v = props.layer.values;
  return {
    fontFamily: typeof v.fontFamily === "string" ? v.fontFamily : "sans-serif",
    fontSize: typeof v.fontSize === "number" ? v.fontSize : 160,
    fontWeight: typeof v.fontWeight === "number" ? v.fontWeight : 600,
    color: typeof v.u_color === "string" ? v.u_color : "#ffffff",
    tracking: typeof v.tracking === "number" ? v.tracking : 0,
    lineHeight: typeof v.lineHeight === "number" ? v.lineHeight : 1.1,
    textAlign: (v.textAlign === "left" || v.textAlign === "right"
      ? v.textAlign
      : "center") as "left" | "center" | "right",
  };
});

const content = computed(() =>
  typeof props.layer.values.content === "string" ? props.layer.values.content : "",
);

/**
 * Vertical placement matching `drawTextSpec`: canvas draws each line with
 * `textBaseline: middle` centered around comp mid-height. CSS line boxes
 * center the font's content area (ascent+descent) instead, so the block top
 * is solved from the same font metrics to land the baselines identically.
 */
const layout = computed(() => {
  metricsTick.value;
  const { height: H } = props.comp;
  const s = spec.value;
  const fontPx = Math.max(1, s.fontSize);
  const lineStep = fontPx * s.lineHeight;
  const lineCount = Math.max(1, content.value.split("\n").length);
  const startY = H / 2 - (lineStep * (lineCount - 1)) / 2;

  let a = fontPx * 0.8;
  let d = fontPx * 0.2;
  let emA = fontPx * 0.8;
  let emD = fontPx * 0.2;
  const ctx = getMeasureCtx();
  if (ctx) {
    ctx.font = `${s.fontWeight} ${fontPx}px ${s.fontFamily}`;
    ctx.textBaseline = "alphabetic";
    const m = ctx.measureText("Mg") as TextMetrics & {
      emHeightAscent?: number;
      emHeightDescent?: number;
    };
    a = m.fontBoundingBoxAscent ?? a;
    d = m.fontBoundingBoxDescent ?? d;
    emA = m.emHeightAscent ?? emA;
    emD = m.emHeightDescent ?? emD;
  }

  // Canvas alphabetic baseline of the first line (middle baseline at startY).
  const baseline0 = startY + (emA - emD) / 2;
  // CSS first-line baseline = blockTop + half-leading + ascent; solve blockTop.
  const blockTop = baseline0 - a - (lineStep - (a + d)) / 2;
  const pad = Math.round(fontPx * 0.25);
  return { blockTop, lineStep, pad, fontPx };
});

/** The layer's universal transform as CSS (same math as layerToCompUv). */
const transformStyle = computed(() => {
  const { width: W, height: H } = props.comp;
  const t = props.transform;
  const s = Math.max(t.scale / 100, 1e-4);
  return {
    transformOrigin: `${t.anchorX * W}px ${(1 - t.anchorY) * H}px`,
    transform: `translate(${t.positionX * W}px, ${-t.positionY * H}px) rotate(${t.rotation}deg) scale(${s})`,
  };
});

const editorStyle = computed(() => {
  const s = spec.value;
  const l = layout.value;
  return {
    top: `${l.blockTop}px`,
    padding: `0 ${l.pad}px`,
    fontFamily: s.fontFamily,
    fontSize: `${l.fontPx}px`,
    fontWeight: String(s.fontWeight),
    lineHeight: `${l.lineStep}px`,
    letterSpacing: `${s.tracking}px`,
    color: s.color,
    caretColor: s.color,
    textAlign: s.textAlign,
    whiteSpace: "pre" as const,
  };
});

// --- Content sync ---

/** Plaintext-only editing keeps flat text nodes; map stray <br> just in case. */
function readText(el: HTMLElement): string {
  let out = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
      return;
    }
    if (node instanceof HTMLBRElement) {
      out += "\n";
      return;
    }
    node.childNodes.forEach(walk);
  };
  el.childNodes.forEach(walk);
  return out;
}

function onInput() {
  const el = editorRef.value;
  if (!el) return;
  props.layer.values.content = readText(el);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).blur();
  }
}

function onBlur() {
  onInput();
  emit("commit");
}

// --- Caret intent ---

function caretFromPoint(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (typeof doc.caretPositionFromPoint === "function") {
    const pos = doc.caretPositionFromPoint(x, y);
    return pos ? { node: pos.offsetNode, offset: pos.offset } : null;
  }
  if (typeof doc.caretRangeFromPoint === "function") {
    const range = doc.caretRangeFromPoint(x, y);
    return range ? { node: range.startContainer, offset: range.startOffset } : null;
  }
  return null;
}

let dragSelectionCleanup: (() => void) | null = null;

/** Extend the selection while the initial pointer drag is still active. */
function beginDragSelection() {
  const onMove = (e: PointerEvent) => {
    if (!(e.buttons & 1)) {
      dragSelectionCleanup?.();
      return;
    }
    const el = editorRef.value;
    const pos = caretFromPoint(e.clientX, e.clientY);
    if (!el || !pos || !el.contains(pos.node)) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    sel.extend(pos.node, pos.offset);
  };
  const onUp = () => dragSelectionCleanup?.();

  dragSelectionCleanup = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    dragSelectionCleanup = null;
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function applyIntent(el: HTMLElement, intent: TextEditIntent) {
  const sel = window.getSelection();
  if (!sel) return;

  if (intent.type === "point") {
    const pos = caretFromPoint(intent.clientX, intent.clientY);
    if (pos && el.contains(pos.node)) {
      const range = document.createRange();
      range.setStart(pos.node, pos.offset);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      if (intent.drag) beginDragSelection();
      return;
    }
  }

  const range = document.createRange();
  range.selectNodeContents(el);
  if (intent.type !== "all") range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

onMounted(() => {
  const el = editorRef.value;
  if (!el) return;
  el.textContent = content.value;

  document.fonts.ready.then(() => {
    metricsTick.value++;
  });

  // Let position and metrics settle before caret hit-testing.
  requestAnimationFrame(() => {
    nextTick(() => {
      el.focus();
      applyIntent(el, props.intent);
    });
  });
});

onUnmounted(() => {
  dragSelectionCleanup?.();
});
</script>

<template>
  <div
    class="pointer-events-none absolute inset-0 z-30"
    :style="transformStyle"
  >
    <div
      ref="editorRef"
      contenteditable="plaintext-only"
      spellcheck="false"
      class="canvas-text-editor pointer-events-auto absolute inset-x-0 outline-none"
      :style="editorStyle"
      @input="onInput"
      @keydown="onKeydown"
      @blur="onBlur"
      @pointerdown.stop
    />
  </div>
</template>

<style scoped>
.canvas-text-editor {
  user-select: text;
  -webkit-user-select: text;
}
</style>
