<script setup lang="ts">
import { PlusIcon } from "@heroicons/vue/16/solid";
import type { LFOSource } from "@shader-lab/core";
import { LFO_COLORS, nextLfoColor } from "#shared/editor/lfo-colors";
import { clonePresetPoints } from "#shared/editor/lfo-presets";

type Emits = {
  "drag-start": [lfoId: string, x: number, y: number];
  "duplicate-lfo": [lfoId: string];
  "clear-assignments": [lfoId: string];
  "delete-lfo": [lfoId: string];
};

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
</script>

<template>
  <div class="mx-auto flex w-full max-w-lg items-center gap-2 rounded-xl border border-edge bg-surface-1/50 p-2">
    <EditorLfoPill
      v-for="lfo in lfos"
      :key="lfo.id"
      :lfo="lfo"
      :selected="selectedLfoId === lfo.id"
      @select="selectLfo(lfo.id)"
      @drag-start="(x: number, y: number) => emit('drag-start', lfo.id, x, y)"
      @duplicate="emit('duplicate-lfo', lfo.id)"
      @clear-assignments="emit('clear-assignments', lfo.id)"
      @delete="emit('delete-lfo', lfo.id)"
    />
    <button
      class="flex size-8 items-center justify-center rounded-lg text-tertiary transition-colors duration-150 hover:bg-surface-1 hover:text-secondary"
      title="Add LFO"
      @click="addLfo"
    >
      <PlusIcon class="size-4" />
    </button>
  </div>
</template>
