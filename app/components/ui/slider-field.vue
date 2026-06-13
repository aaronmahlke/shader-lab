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
};

type Emits = {
  "update:mod-depth": [value: number];
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
} = defineProps<Props>();
const emit = defineEmits<Emits>();

const model = defineModel<number>({ default: 0.5 });

const hasModulation = computed(() => modColor != null && modDepth != null);
</script>

<template>
  <div class="overflow-hidden rounded-md">
    <div
      v-if="hasModulation"
      class="min-h-0 overflow-hidden transition-[grid-template-rows] duration-200 ease-out-expo"
    >
      <UiModSlider
        :base="model"
        :depth="modDepth ?? 0"
        :min="min"
        :max="max"
        :step="step"
        :color="modColor!"
        :live-value="modLiveValue"
        @update:depth="emit('update:mod-depth', $event)"
      />
    </div>
    <UiSlider
      v-model="model"
      :name="name"
      :label="label"
      :min="min"
      :max="max"
      :step="step"
      :tick-step="tickStep"
      :disabled="disabled"
      :is-drop-target="isDropTarget"
      :unit="unit"
    />
  </div>
</template>
