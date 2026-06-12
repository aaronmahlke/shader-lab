import type { InjectionKey } from "vue";
import type { ArtworkDocument, ArtworkTextLayer } from "#shared/types/artwork";
import type { ArtworkTextRunStyle } from "#shared/artwork/text-layer";
import {
  applyStyleToRange,
  getContentEditableSelection,
  getTextRuns,
  isRangeAllBold,
  parseEditorElement,
  restoreSelectionOffsets,
  runsToEditorHtml,
  setLayerRuns,
} from "#shared/artwork/text-layer";

export type ArtworkTextEditApi = ReturnType<typeof useArtworkTextEdit>;

export const ArtworkTextEditKey: InjectionKey<ArtworkTextEditApi> = Symbol("artwork-text-edit");

export function useArtworkTextEdit(
  artwork: Ref<ArtworkDocument>,
  selectedLayerId: Ref<string | null>,
) {
  const editingLayerId = ref<string | null>(null);
  const selection = ref({ start: 0, end: 0 });
  const editorElement = ref<HTMLElement | null>(null);
  let syncEditorSelection: (() => void) | null = null;

  const editingLayer = computed(() => {
    const id = editingLayerId.value;
    if (!id) return null;
    const layer = artwork.value.layers.find((l) => l.id === id);
    return layer?.type === "text" ? layer : null;
  });

  function startEditing(layerId: string) {
    editingLayerId.value = layerId;
    selectedLayerId.value = layerId;
    selection.value = { start: 0, end: 0 };
  }

  function stopEditing() {
    editingLayerId.value = null;
    registerEditor(null);
  }

  function registerEditor(el: HTMLElement | null, syncSelection?: () => void) {
    editorElement.value = el;
    syncEditorSelection = syncSelection ?? null;
  }

  function updateSelection(start: number, end: number) {
    selection.value = {
      start: Math.max(0, start),
      end: Math.max(0, end),
    };
  }

  /** Prefer live contenteditable selection over the cached ref. */
  function resolveSelection(layer: ArtworkTextLayer) {
    const el = editorElement.value;
    if (el && editingLayerId.value === layer.id) {
      const live = getContentEditableSelection(el);
      if (live) {
        updateSelection(live.start, live.end);
        return live;
      }
    }
    return { ...selection.value };
  }

  function applyToSelection(patch: ArtworkTextRunStyle, layer?: ArtworkTextLayer) {
    const target = layer ?? editingLayer.value
      ?? (selectedLayerId.value
        ? artwork.value.layers.find((l) => l.id === selectedLayerId.value && l.type === "text")
        : null);
    if (!target || target.type !== "text") return;

    const { start, end } = resolveSelection(target);
    if (start === end) return;

    const runs = getTextRuns(target);
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    if (lo >= hi) return;

    setLayerRuns(target, applyStyleToRange(runs, lo, hi, patch));
  }

  function refreshEditorFromRuns(layer: ArtworkTextLayer, range?: { start: number; end: number }) {
    const el = editorElement.value;
    if (!el || editingLayerId.value !== layer.id) return;

    const { start, end } = range ?? resolveSelection(layer);
    el.innerHTML = runsToEditorHtml(layer, getTextRuns(layer));
    restoreSelectionOffsets(el, start, end);
  }

  function applyBoldToggle(layer: ArtworkTextLayer) {
    const { start, end } = resolveSelection(layer);
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    if (lo >= hi) return;

    const runs = getTextRuns(layer);
    const nextBold = !isRangeAllBold(runs, lo, hi);
    setLayerRuns(layer, applyStyleToRange(runs, lo, hi, { bold: nextBold }));
    refreshEditorFromRuns(layer, { start, end });
    syncEditorSelection?.();
  }

  function applyRichCommand(
    command: "bold" | "italic" | "underline",
    layer?: ArtworkTextLayer,
  ) {
    const target = layer ?? editingLayer.value;
    if (!target || target.type !== "text") return;

    if (command === "bold") {
      applyBoldToggle(target);
      return;
    }

    const el = editorElement.value;
    if (el && editingLayerId.value === target.id) {
      el.focus();
      document.execCommand(command);
      setLayerRuns(target, parseEditorElement(el, target));
      syncEditorSelection?.();
      return;
    }

    applyToSelection(
      command === "italic" ? { italic: true } : { underline: true },
      target,
    );
  }

  function toggleBold(layer?: ArtworkTextLayer) {
    applyRichCommand("bold", layer);
  }

  function toggleItalic(layer?: ArtworkTextLayer) {
    applyRichCommand("italic", layer);
  }

  function toggleUnderline(layer?: ArtworkTextLayer) {
    applyRichCommand("underline", layer);
  }

  function setSelectionColor(color: string, layer?: ArtworkTextLayer) {
    applyToSelection({ color }, layer);
  }

  watch(selectedLayerId, (id) => {
    if (editingLayerId.value && id !== editingLayerId.value) {
      stopEditing();
    }
  });

  function canFormatLayer(layerId: string) {
    const { start, end } = selection.value;
    return start !== end;
  }

  return {
    editingLayerId,
    editingLayer,
    selection,
    startEditing,
    stopEditing,
    registerEditor,
    updateSelection,
    applyToSelection,
    canFormatLayer,
    toggleBold,
    toggleItalic,
    toggleUnderline,
    setSelectionColor,
  };
}
