<script setup lang="ts">
import { Trash2Icon } from "lucide-vue-next";
import type { LFOSource } from "#shared/types/editor";
import { LFO_PRESETS, clonePresetPoints } from "#shared/editor/lfo-presets";

type Props = {
  lfo: LFOSource;
  cursorPosition?: number;
};

type Emits = {
  delete: [];
};

const { lfo, cursorPosition } = defineProps<Props>();
const emit = defineEmits<Emits>();

function applyPreset(key: string) {
  lfo.points = clonePresetPoints(key);
}
</script>

<template>
  <div class="mx-auto w-full max-w-lg rounded-xl border border-edge bg-base-1">
    <div class="flex flex-col gap-3 p-3">
      <div class="flex items-center justify-between px-1">
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <span class="size-2.5 shrink-0 rounded-full" :style="{ backgroundColor: lfo.color }" />
          <UiEditableText v-model="lfo.label" fill class="text-copy-sm text-primary" />
        </div>
        <button
          class="flex size-6 items-center justify-center rounded-md text-tertiary transition-colors duration-150 hover:bg-surface-1 hover:text-secondary"
          title="Delete LFO"
          @click="emit('delete')"
        >
          <Trash2Icon class="size-3.5" />
        </button>
      </div>

      <EditorWaveEditor
        v-model="lfo.points"
        :color="lfo.color"
        :cursor-position="cursorPosition"
      />

      <div class="flex items-center justify-between gap-3 px-1">
        <div class="flex gap-1">
          <UiButton
            v-for="(preset, key) in LFO_PRESETS"
            :key="key"
            variant="option"
            size="sm"
            @click="applyPreset(key as string)"
          >
            {{ preset.label }}
          </UiButton>
        </div>
        <div class="flex gap-1">
          <UiButton
            variant="option"
            size="sm"
            :active="lfo.mode === 'loop'"
            @click="lfo.mode = 'loop'"
          >
            Loop
          </UiButton>
          <UiButton
            variant="option"
            size="sm"
            :active="lfo.mode === 'pingpong'"
            @click="lfo.mode = 'pingpong'"
          >
            Ping-pong
          </UiButton>
        </div>
      </div>

      <div class="flex gap-3">
        <div class="flex-1">
          <UiSliderField
            v-model="lfo.rate"
            label="Rate (Hz)"
            :min="0.01"
            :max="3"
            :step="0.01"
          />
        </div>
        <div class="flex-1">
          <UiSliderField
            v-model="lfo.phase"
            label="Phase"
            :min="0"
            :max="360"
            :step="1"
          />
        </div>
      </div>
    </div>
  </div>
</template>
