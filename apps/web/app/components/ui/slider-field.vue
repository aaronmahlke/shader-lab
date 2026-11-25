<script setup lang="ts">
type Props = {
  name?: string;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  tickStep?: number;
  disabled?: boolean;
  modColor?: string;
  modDepth?: number;
  modLiveValue?: number;
  isDropTarget?: boolean;
  unit?: string;
  animatable?: boolean;
  trackEnabled?: boolean;
  keyedAtPlayhead?: boolean;
};

type Emits = {
  "update:mod-depth": [value: number];
  "toggle-track": [];
  "toggle-keyframe": [];
};

const {
  name,
  label,
  min = 0,
  max = 1,
  step = 0.01,
  tickStep,
  disabled = false,
  modColor,
  modDepth,
  modLiveValue,
  isDropTarget = false,
  unit,
  animatable = false,
  trackEnabled = false,
  keyedAtPlayhead = false,
} = defineProps<Props>();
const emit = defineEmits<Emits>();

const model = defineModel<number>({ default: 0.5 });

const hasModulation = computed(() => modColor != null && modDepth != null);
/** One/two-letter labels (X, Y, Z, R) sit inside the box, like Live. */
const shortLabel = computed(() => !!label && label.length <= 2);
const precision = computed(() => (Number.isInteger(step) && step >= 1 ? 0 : step >= 0.1 ? 1 : 2));
const keyState = computed(() =>
  !animatable ? undefined : keyedAtPlayhead ? "on" : trackEnabled ? "animated" : "off",
);
const mods = computed(() =>
  hasModulation.value ? [{ id: "mod", color: modColor!, depth: modDepth!, live: modLiveValue }] : undefined,
);
/** Keyframe button: not animated yet → stopwatch on (adds a key); otherwise toggle the key at the playhead. */
function onToggleKey() {
  if (trackEnabled) emit("toggle-keyframe");
  else emit("toggle-track");
}
</script>

<template>
  <!-- Studio value box (see /kitchen/value): label above, LFO rows, keyframe diamond. -->
  <div
    class="flex min-w-0 flex-col gap-[3px]"
    :class="[isDropTarget && 'outline outline-1 outline-offset-1 outline-[var(--s-accent)]', disabled && 'pointer-events-none opacity-50']"
  >
    <span v-if="label && !shortLabel" class="truncate select-none">{{ label }}</span>
    <StudioValue
      :label="shortLabel ? label : undefined"
      v-model="model"
      :min="min"
      :max="max"
      :step="step"
      :precision="precision"
      :unit="unit"
      :mods="mods"
      :keyframe="keyState"
      @update:depth="(_id: string, d: number) => emit('update:mod-depth', d)"
      @toggle-key="onToggleKey"
    />
  </div>
</template>
