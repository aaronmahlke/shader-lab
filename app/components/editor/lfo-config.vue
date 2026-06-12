<script setup lang="ts">
import { XMarkIcon, SignalIcon } from "@heroicons/vue/16/solid";
import type { LFOSource } from "#shared/types/editor";
import { LFO_PRESETS, clonePresetPoints } from "#shared/editor/lfo-presets";

type Props = {
  lfo: LFOSource;
  cursorPosition?: number;
};

type Emits = {
  close: [];
};

const { lfo, cursorPosition } = defineProps<Props>();
const emit = defineEmits<Emits>();

const activePreset = computed(() => {
  for (const [key, preset] of Object.entries(LFO_PRESETS)) {
    if (JSON.stringify(preset.points) === JSON.stringify(lfo.points)) return key;
  }
  return null;
});

function applyPreset(key: string) {
  lfo.points = clonePresetPoints(key);
}
</script>

<template>
  <div class="w-[380px] rounded-lg bg-control-strong p-1 shadow-panel">
    <div class="flex flex-col gap-1">
      <div class="flex h-7 items-center gap-2 px-2">
        <SignalIcon class="size-4 shrink-0" :style="{ color: lfo.color }" />
        <UiEditableText v-model="lfo.label" fill class="min-w-0 flex-1 text-copy-sm text-neutral" />
        <UiHover radius="rounded-md" :focusable="false">
          <button
            type="button"
            class="flex size-7 shrink-0 items-center justify-center text-neutral-subtle outline-none group-hover/h:text-neutral-strong"
            title="Close"
            @click="emit('close')"
          >
            <XMarkIcon class="size-4" />
          </button>
        </UiHover>
      </div>

      <div class="overflow-hidden rounded-lg bg-code">
        <EditorWaveEditor
          v-model="lfo.points"
          :color="lfo.color"
          :cursor-position="cursorPosition"
          class="h-24"
        />
      </div>

      <div class="flex items-center justify-between gap-2 px-1 pb-1">
        <div class="flex gap-1">
          <button
            v-for="(preset, key) in LFO_PRESETS"
            :key="key"
            class="h-7 rounded-md px-2 text-copy-sm transition-colors duration-150"
            :class="activePreset === key ? 'bg-tint-strong text-neutral' : 'bg-tint-subtle text-neutral-subtle hover:text-neutral'"
            @click="applyPreset(key as string)"
          >
            {{ preset.label }}
          </button>
        </div>
        <div class="flex gap-1">
          <button
            class="h-7 rounded-md px-2 text-copy-sm transition-colors duration-150"
            :class="lfo.mode === 'loop' ? 'bg-tint-strong text-neutral' : 'bg-tint-subtle text-neutral-subtle hover:text-neutral'"
            @click="lfo.mode = 'loop'"
          >
            Loop
          </button>
          <button
            class="h-7 rounded-md px-2 text-copy-sm transition-colors duration-150"
            :class="lfo.mode === 'pingpong' ? 'bg-tint-strong text-neutral' : 'bg-tint-subtle text-neutral-subtle hover:text-neutral'"
            @click="lfo.mode = 'pingpong'"
          >
            Ping-pong
          </button>
        </div>
      </div>

      <div class="flex flex-col gap-2.5 px-1 pb-1">
        <UiSliderField
          v-model="lfo.rate"
          label="Rate"
          :min="0.01"
          :max="3"
          :step="0.01"
        />
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
</template>
