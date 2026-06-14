<script setup lang="ts">
import type { ComponentPublicInstance } from "vue";
import { PlusIcon } from "@heroicons/vue/16/solid";
import type { LFOSource } from "@shader-lab/core";
import { nextLfoColor } from "#shared/editor/lfo-colors";
import { clonePresetPoints } from "#shared/editor/lfo-presets";

type Emits = {
  "drag-start": [lfoId: string, x: number, y: number];
  "duplicate-lfo": [lfoId: string];
  "clear-assignments": [lfoId: string];
  "delete-lfo": [lfoId: string];
};

const { cursorPosition } = defineProps<{
  cursorPosition?: number;
}>();

const lfos = defineModel<LFOSource[]>("lfos", { required: true });
const selectedLfoId = defineModel<string | null>("selectedLfoId", { required: true });
const emit = defineEmits<Emits>();

let lfoCounter = 0;

function initLfoCounter() {
  for (const lfo of lfos.value) {
    const match = /^lfo-(\d+)$/.exec(lfo.id);
    if (match) lfoCounter = Math.max(lfoCounter, Number(match[1]));
  }
}

initLfoCounter();

function nextLfoId(): string {
  return `lfo-${++lfoCounter}`;
}

const rowEls = new Map<string, HTMLElement>();
const panelRef = ref<HTMLElement | null>(null);
const panelStyle = ref({ top: "0px", left: "0px" });

const selectedLfo = computed(() => {
  if (!selectedLfoId.value) return null;
  return lfos.value.find((l) => l.id === selectedLfoId.value) ?? null;
});

const GAP = 8;
const VIEWPORT_PAD = 12;

function bindRowRef(id: string, el: Element | ComponentPublicInstance | null) {
  if (!el) {
    rowEls.delete(id);
    return;
  }
  if (el instanceof HTMLElement) {
    rowEls.set(id, el);
    return;
  }
  const exposed = el as ComponentPublicInstance & { rowEl?: HTMLElement | Ref<HTMLElement | null> };
  const node = exposed.rowEl;
  const html = node instanceof HTMLElement ? node : node?.value;
  if (html instanceof HTMLElement) {
    rowEls.set(id, html);
  }
}

function updatePanelPosition() {
  const id = selectedLfoId.value;
  if (!id) return;

  const rowEl = rowEls.get(id);
  if (!rowEl) return;

  const rowRect = rowEl.getBoundingClientRect();
  const sidebar = rowEl.closest("aside");
  const anchorRect = sidebar?.getBoundingClientRect() ?? rowRect;

  let top = rowRect.top;
  let left = anchorRect.right + GAP;

  const panelEl = panelRef.value;
  const panelHeight = panelEl?.offsetHeight ?? 0;
  const panelWidth = panelEl?.offsetWidth ?? 440;

  if (panelHeight > 0) {
    const maxTop = window.innerHeight - VIEWPORT_PAD - panelHeight;
    top = Math.min(Math.max(VIEWPORT_PAD, top), maxTop);
  }

  const maxLeft = window.innerWidth - VIEWPORT_PAD - panelWidth;
  left = Math.min(left, maxLeft);

  panelStyle.value = {
    top: `${top}px`,
    left: `${left}px`,
  };
}

function schedulePositionUpdate() {
  nextTick(() => {
    updatePanelPosition();
    nextTick(updatePanelPosition);
  });
}

watch(selectedLfoId, schedulePositionUpdate);
watch(() => lfos.value.length, schedulePositionUpdate);

onMounted(() => {
  schedulePositionUpdate();
  window.addEventListener("resize", updatePanelPosition);
  window.addEventListener("scroll", updatePanelPosition, true);
});

onUnmounted(() => {
  window.removeEventListener("resize", updatePanelPosition);
  window.removeEventListener("scroll", updatePanelPosition, true);
});

function addLfo() {
  const existingColors = lfos.value.map((l) => l.color);
  const id = nextLfoId();
  lfos.value.push({
    id,
    label: `LFO ${lfos.value.length + 1}`,
    color: nextLfoColor(existingColors),
    points: clonePresetPoints("sine"),
    waveShape: "sine",
    rate: 1.0,
    phase: 0,
    mode: "loop",
  });
  selectedLfoId.value = id;
}

function selectLfo(id: string) {
  selectedLfoId.value = selectedLfoId.value === id ? null : id;
}

function onDeleteLfo(id: string) {
  emit("delete-lfo", id);
}
</script>

<template>
  <div class="flex shrink-0 flex-col gap-px p-1">
    <EditorLfoListRow
      v-for="lfo in lfos"
      :key="lfo.id"
      :ref="(el) => bindRowRef(lfo.id, el)"
      :lfo="lfo"
      :selected="selectedLfoId === lfo.id"
      @select="selectLfo(lfo.id)"
      @drag-start="(x: number, y: number) => emit('drag-start', lfo.id, x, y)"
      @duplicate="emit('duplicate-lfo', lfo.id)"
      @clear-assignments="emit('clear-assignments', lfo.id)"
      @delete="onDeleteLfo(lfo.id)"
    />
    <UiHover full-width>
      <button
        type="button"
        class="flex h-9 w-full items-center gap-2 p-1 text-copy-sm text-neutral-subtle outline-none group-hover/h:text-neutral-strong"
        title="Add LFO"
        @click="addLfo"
      >
        <PlusIcon class="size-4 shrink-0" />
        <span>Add LFO</span>
      </button>
    </UiHover>
  </div>

  <Teleport to="body">
    <div
      v-if="selectedLfo"
      ref="panelRef"
      class="fixed z-50"
      :style="panelStyle"
    >
      <EditorLfoConfig
        :key="selectedLfo.id"
        :lfo="selectedLfo"
        :cursor-position="cursorPosition"
        @close="selectedLfoId = null"
      />
    </div>
  </Teleport>
</template>
