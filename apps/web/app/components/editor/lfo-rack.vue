<script setup lang="ts">
import type { LFOSource } from "@shader-lab/core";

/**
 * Composition-scoped LFO panel for the right sidebar: the inspector-section
 * header pattern ("LFOs" + a muted "Composition" scope badge) above the LFO
 * list. A border-t plus a subtle darker tint separate it from the per-layer
 * inspector above so it reads as a distinct panel.
 */

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
</script>

<template>
  <div class="flex min-h-0 flex-col border-t border-neutral bg-neutral-950/50">
    <div class="flex shrink-0 items-center justify-between gap-2 px-3 pt-3 pb-1.5">
      <h3 class="text-copy-sm font-semibold text-primary select-none">LFOs</h3>
      <span
        class="rounded bg-control px-1.5 py-0.5 text-[10px] leading-4 text-tertiary select-none"
        title="LFOs are shared across all layers of this composition"
      >
        Composition
      </span>
    </div>
    <EditorLfoList
      v-model:lfos="lfos"
      v-model:selected-lfo-id="selectedLfoId"
      class="min-h-0 flex-1 overflow-y-auto"
      :cursor-position="cursorPosition"
      @drag-start="(id: string, x: number, y: number) => emit('drag-start', id, x, y)"
      @duplicate-lfo="emit('duplicate-lfo', $event)"
      @clear-assignments="emit('clear-assignments', $event)"
      @delete-lfo="emit('delete-lfo', $event)"
    />
  </div>
</template>
