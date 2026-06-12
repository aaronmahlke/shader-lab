<script setup lang="ts">
import type { ArtworkDocument } from "#shared/types/artwork";
import type { ArtworkLayerCaches } from "#shared/artwork/layer-bounds";
import { ArtworkTextEditKey, type ArtworkTextEditApi } from "~/composables/use-artwork-text-edit";

const props = defineProps<{
  artwork: ArtworkDocument;
  layerCaches: ArtworkLayerCaches;
}>();

const emit = defineEmits<{
  deleteLayer: [id: string];
}>();

const selectedLayerId = defineModel<string | null>("selectedLayerId", { required: true });

const stageRef = ref<HTMLElement | null>(null);
const artworkRef = computed(() => props.artwork);

const textEdit = inject(ArtworkTextEditKey) as ArtworkTextEditApi;

const {
  selectionStyle,
  handles,
  snapOverlay,
  pickAt,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  isDragging,
} = useArtworkCanvasControls(
  stageRef,
  artworkRef,
  selectedLayerId,
  computed(() => props.layerCaches),
  { editingLayerId: textEdit.editingLayerId, onDeleteLayer: (id) => emit("deleteLayer", id) },
);

const stageScale = ref(1);

function updateStageScale() {
  const el = stageRef.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  stageScale.value = rect.height / props.artwork.canvas.height;
}

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  updateStageScale();
  const el = stageRef.value;
  if (el && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => updateStageScale());
    resizeObserver.observe(el);
  }
});

onUnmounted(() => {
  resizeObserver?.disconnect();
});

function onStageDblClick(e: MouseEvent) {
  const picked = pickAt(e.clientX, e.clientY);
  if (picked?.type === "text") {
    textEdit.startEditing(picked.id);
  }
}

const isEditingText = computed(
  () => !!textEdit.editingLayerId.value,
);

const showSelectionChrome = computed(
  () => selectionStyle.value && !isEditingText.value,
);
</script>

<template>
  <div
    ref="stageRef"
    tabindex="0"
    class="relative max-h-full max-w-full touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent,#6cb4ee)] focus-visible:ring-offset-2 focus-visible:ring-offset-base-0"
    :class="isDragging ? 'cursor-grabbing' : 'cursor-default'"
    :style="{ aspectRatio: `${artwork.canvas.width} / ${artwork.canvas.height}` }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @dblclick="onStageDblClick"
  >
    <slot />

    <ArtworkCanvasGuides
      v-if="snapOverlay"
      :canvas="artwork.canvas"
      :guides="snapOverlay.guides"
      :distances="snapOverlay.distances"
    />

    <ArtworkTextEditorOverlay
      v-if="textEdit.editingLayer.value"
      :layer="textEdit.editingLayer.value"
      :canvas="artwork.canvas"
      :display-scale="stageScale"
      @selection="textEdit.updateSelection"
      @commit="textEdit.stopEditing"
    />

    <div
      v-if="showSelectionChrome"
      class="pointer-events-none absolute z-10 box-border rounded-sm border-2 border-[var(--color-accent,#6cb4ee)]"
      :style="selectionStyle"
    >
      <div
        v-for="h in handles"
        :key="h.id"
        class="pointer-events-auto absolute size-2.5 rounded-full border-2 border-[var(--color-accent,#6cb4ee)] bg-base-1 shadow-sm"
        :class="{
          'cursor-nwse-resize': h.id === 'nw' || h.id === 'se',
          'cursor-nesw-resize': h.id === 'ne' || h.id === 'sw',
          'cursor-ns-resize': h.id === 'n' || h.id === 's',
          'cursor-ew-resize': h.id === 'e' || h.id === 'w',
        }"
        :style="h.style"
      />
    </div>
  </div>
</template>
