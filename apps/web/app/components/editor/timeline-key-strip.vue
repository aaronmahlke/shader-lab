<script setup lang="ts">
import {
  EASING_PRESETS,
  type CubicBezierEase,
  type Keyframe,
  type KeyframeEasing,
} from "@shader-lab/core";

/**
 * Keyframe diamonds (+ easing context menu) for one timeline row. Shared by
 * layer property rows, modulator link rows and modulator param rows; the
 * timeline owns selection, dragging and easing writes.
 */
const { keys, label, left, isSelected, atPlayhead, easingId } = defineProps<{
  keys: Keyframe[];
  label: string;
  left: (time: number) => string;
  isSelected: (time: number) => boolean;
  atPlayhead: (time: number) => boolean;
  easingId: (time: number) => string;
}>();

const emit = defineEmits<{
  "key-pointerdown": [time: number, event: PointerEvent];
  "apply-easing": [time: number, easing: KeyframeEasing | CubicBezierEase];
}>();

const NAMED_EASINGS: { id: KeyframeEasing; label: string }[] = [
  { id: "linear", label: "Linear" },
  { id: "easeIn", label: "Ease In" },
  { id: "easeOut", label: "Ease Out" },
  { id: "easeInOut", label: "Ease In Out" },
  { id: "hold", label: "Hold" },
];

function shape(key: Keyframe): "linear" | "eased" | "hold" {
  if (key.ease === "hold") return "hold";
  if (key.curve) return "eased";
  if (key.ease && key.ease !== "linear") return "eased";
  return "linear";
}
</script>

<template>
  <UiContextMenu v-for="key in keys" :key="key.time">
    <button
      type="button"
      class="absolute top-1/2 z-10 size-2.5 -translate-x-1/2 -translate-y-1/2 cursor-default border-0 bg-transparent p-0 outline-none"
      :style="{ left: left(key.time) }"
      :title="`${label} @ ${key.time.toFixed(2)}s`"
      @pointerdown.stop="emit('key-pointerdown', key.time, $event)"
    >
      <UiKeyframeDiamond
        class="size-full"
        :selected="isSelected(key.time)"
        :at-playhead="atPlayhead(key.time)"
        :easing="shape(key)"
      />
    </button>
    <template #menu>
      <UiContextMenuItem
        v-for="named in NAMED_EASINGS"
        :key="named.id"
        @click="emit('apply-easing', key.time, named.id)"
      >
        <span class="flex-1">{{ named.label }}</span>
        <span v-if="easingId(key.time) === named.id">✓</span>
      </UiContextMenuItem>
      <UiContextMenuSeparator />
      <UiContextMenuItem
        v-for="preset in EASING_PRESETS"
        :key="preset.id"
        @click="emit('apply-easing', key.time, preset.curve)"
      >
        <span class="flex-1">{{ preset.label }}</span>
        <span v-if="easingId(key.time) === preset.id">✓</span>
      </UiContextMenuItem>
    </template>
  </UiContextMenu>
</template>
