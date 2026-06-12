<script setup lang="ts">
import type { ArtworkCanvas, ArtworkTextLayer } from "#shared/types/artwork";
import {
  canvasTextVisualTopPx,
  editorStyleFromLayer,
  getContentEditableSelection,
  getTextRuns,
  parseEditorElement,
  runsToEditorHtml,
  setLayerRuns,
  textEditorAnchorStyle,
} from "#shared/artwork/text-layer";
import { ArtworkTextEditKey } from "~/composables/use-artwork-text-edit";

const props = defineProps<{
  layer: ArtworkTextLayer;
  canvas: ArtworkCanvas;
  /** stage.clientHeight / canvas.height */
  displayScale: number;
}>();

const emit = defineEmits<{
  selection: [start: number, end: number];
  commit: [];
}>();

const textEdit = inject(ArtworkTextEditKey, null);
const editorRef = ref<HTMLDivElement | null>(null);
const measureCtx = shallowRef<CanvasRenderingContext2D | null>(null);
/** DOM vs canvas ink-top delta in stage pixels (applied after % anchor). */
const fineTuneY = ref<number | null>(null);

const anchorStyle = computed(() => {
  const ctx = measureCtx.value;
  if (!ctx) return {};
  const base = textEditorAnchorStyle(props.layer, props.canvas, ctx);
  if (fineTuneY.value == null) return base;
  return {
    ...base,
    transform: `translateY(${fineTuneY.value}px)`,
  };
});

const editorCss = computed(() =>
  editorStyleFromLayer(props.layer, props.canvas.height, props.displayScale),
);

function alignEditorToCanvas() {
  const el = editorRef.value;
  const ctx = measureCtx.value;
  const stage = el?.offsetParent as HTMLElement | null;
  if (!el || !ctx || !stage) return;

  const canvasTop = canvasTextVisualTopPx(ctx, props.canvas, props.layer);
  const expectedTop = (canvasTop / props.canvas.height) * stage.clientHeight;

  const textNode = el.firstChild?.nodeType === Node.TEXT_NODE
    ? el.firstChild
    : el.querySelector("*")?.firstChild ?? el.firstChild ?? el;
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, 0);
  const inkTop = range.getBoundingClientRect().top;
  const stageTop = stage.getBoundingClientRect().top;
  fineTuneY.value = expectedTop - (inkTop - stageTop);
}

function onSelectionChange() {
  if (!editorRef.value) return;
  syncSelection();
}

onMounted(() => {
  const c = document.createElement("canvas");
  measureCtx.value = c.getContext("2d");
  document.addEventListener("selectionchange", onSelectionChange);

  nextTick(async () => {
    const el = editorRef.value;
    if (!el) return;
    el.innerHTML = runsToEditorHtml(props.layer, getTextRuns(props.layer));
    await document.fonts.ready;
    requestAnimationFrame(() => {
      alignEditorToCanvas();
    });
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    syncSelection();
    textEdit?.registerEditor(el, syncSelection);
  });
});

onUnmounted(() => {
  document.removeEventListener("selectionchange", onSelectionChange);
  textEdit?.registerEditor(null);
});

watch(
  () => [props.layer, props.displayScale],
  () => {
    const el = editorRef.value;
    if (!el || document.activeElement === el) return;
    el.innerHTML = runsToEditorHtml(props.layer, getTextRuns(props.layer));
    nextTick(alignEditorToCanvas);
  },
);

function syncSelection() {
  const el = editorRef.value;
  if (!el) return;

  const range = getContentEditableSelection(el);
  if (!range) {
    emit("selection", 0, 0);
    return;
  }

  emit("selection", range.start, range.end);
}

function onInput() {
  const el = editorRef.value;
  if (!el) return;
  setLayerRuns(props.layer, parseEditorElement(el, props.layer));
  syncSelection();
}

function onBlur() {
  const el = editorRef.value;
  if (el) {
    setLayerRuns(props.layer, parseEditorElement(el, props.layer));
  }
  window.setTimeout(() => {
    const active = document.activeElement;
    if (el?.contains(active)) return;
    if (active?.closest("[data-keeps-text-edit]")) return;
    emit("commit");
  }, 0);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    (e.target as HTMLElement).blur();
  }
}
</script>

<template>
  <div
    class="pointer-events-auto absolute z-30 outline-none"
    :style="{
      ...anchorStyle,
      visibility: fineTuneY != null ? 'visible' : 'hidden',
    }"
  >
    <div
      ref="editorRef"
      contenteditable="true"
      class="artwork-text-editor select-text outline-none"
      :style="editorCss"
      @input="onInput"
      @blur="onBlur"
      @keyup="syncSelection"
      @mouseup="syncSelection"
      @keydown="onKeydown"
    />
  </div>
</template>

<style scoped>
/* Stage uses select-none; editing must opt back in so Backspace/Delete work. */
.artwork-text-editor {
  user-select: text;
  -webkit-user-select: text;
}

/* App base resets font-weight:inherit on all nodes, which breaks <b> from execCommand. */
.artwork-text-editor :is(b, strong) {
  font-weight: 700 !important;
}
</style>
