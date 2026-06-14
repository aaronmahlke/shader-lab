<script setup lang="ts">
import { SliderRoot, SliderThumb, SliderTrack } from "reka-ui";

type Props = {
  name?: string;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  tickStep?: number;
  disabled?: boolean;
  isDropTarget?: boolean;
  unit?: string;
};

const {
  name,
  label,
  min = 0,
  max = 1,
  step = 0.01,
  tickStep,
  disabled = false,
  isDropTarget = false,
  unit = "",
} = defineProps<Props>();

const model = defineModel<number>({ default: 0.5 });

const isDragging = ref(false);
const isHovered = ref(false);
const isEditing = ref(false);
const inputRef = ref<HTMLInputElement | null>(null);
const labelRef = ref<HTMLSpanElement | null>(null);
const valueRef = ref<HTMLDivElement | null>(null);
const trackRef = ref<HTMLElement | null>(null);

const labelEndPct = ref(0.18);
const valueStartPct = ref(0.82);

const percentage = computed(() => (model.value - min) / (max - min));

const MAX_TICKS = 10;

/** Pick a coarse visual step so the track never gets more than ~MAX_TICKS marks. */
function autoTickStep(range: number): number {
  if (range <= 0) return 1;
  const raw = range / MAX_TICKS;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}

const effectiveTickStep = computed(() => tickStep ?? autoTickStep(max - min));
const tickCount = computed(() => Math.max(1, Math.round((max - min) / effectiveTickStep.value)));
const showTicks = computed(() => isHovered.value || isDragging.value);
const showHandle = computed(() => isHovered.value || isDragging.value);

const displayValue = computed(() => {
  if (Number.isInteger(step) && step >= 1) return model.value.toFixed(0);
  if (step >= 0.1) return model.value.toFixed(1);
  return model.value.toFixed(2);
});

const handleNearEdge = computed(() => {
  const t = percentage.value;
  return t < labelEndPct.value || t > valueStartPct.value;
});

function measureZones() {
  if (!trackRef.value || !labelRef.value || !valueRef.value) return;
  const trackW = trackRef.value.offsetWidth;
  if (trackW === 0) return;
  labelEndPct.value = Math.min(0.4, (labelRef.value.offsetWidth + 18) / trackW);
  valueStartPct.value = Math.max(0.6, 1 - (valueRef.value.offsetWidth + 16) / trackW);
}

onMounted(() => nextTick(measureZones));
watch(() => model.value, () => nextTick(measureZones));
watch(() => isEditing.value, () => nextTick(measureZones));

function tickOpacity(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  if (t < labelEndPct.value) return t / labelEndPct.value;
  if (t > valueStartPct.value) return (1 - t) / (1 - valueStartPct.value);
  return 1;
}

function startEdit() {
  isEditing.value = true;
  nextTick(() => inputRef.value?.select());
}

function commitValue(e: Event) {
  const input = e.target as HTMLInputElement;
  const parsed = parseFloat(input.value);
  if (!isNaN(parsed)) {
    const snapped = Math.round(parsed / step) * step;
    model.value = Math.min(max, Math.max(min, snapped));
  }
  isEditing.value = false;
}

function onPointerDown(e: PointerEvent) {
  if (e.button === 2) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  isDragging.value = true;
}
</script>

<template>
  <div
    ref="trackRef"
    @pointerdown.capture="onPointerDown"
    @pointerenter="isHovered = true"
    @pointerleave="!isDragging && (isHovered = false)"
  >
    <SliderRoot
      :model-value="[model]"
      :min="min"
      :max="max"
      :step="step"
      :disabled="disabled"
      :name="name"
      as="div"
      class="relative h-8 outline-none"
      @update:model-value="(val?: number[]) => (model = val?.[0] ?? model)"
      @pointerup="isDragging = false"
      @pointercancel="isDragging = false"
    >
      <SliderTrack
        as="div"
        :class="[
          'group relative h-full overflow-hidden rounded-md bg-control-track p-px outline-none',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-ew-resize',
          isDropTarget && 'ring-1 ring-focus ring-offset-1 ring-offset-layer-1',
        ]"
      >
        <!-- Fill — no width transition while dragging so the bar tracks the thumb instantly -->
        <div
          :class="[
            'slider-fill absolute inset-y-px left-px flex items-center justify-end rounded-sm shadow-slider',
            showHandle ? 'bg-slider-fill-active' : 'bg-slider-fill',
            isDragging ? '' : 'transition-[width] duration-100 ease-out',
            !disabled && 'group-active:inset-y-0 group-active:left-0 group-active:rounded',
          ]"
          :style="{ width: `${percentage * 100}%` }"
        >
          <Transition name="slider-handle">
            <div
              v-if="showHandle"
              :class="[
                'slider-handle mr-0.5 w-0.5 rounded-full bg-slider-handle',
                handleNearEdge ? 'h-3.5 opacity-70' : 'h-4 opacity-100',
              ]"
            />
          </Transition>
        </div>

        <!-- Tick marks — coarse step, fade in on hover/drag -->
        <Transition name="slider-ticks">
          <div v-if="showTicks" class="pointer-events-none absolute inset-0">
            <div
              v-for="i in tickCount + 1"
              :key="i"
              class="slider-tick absolute top-1/2 h-2.5 w-px -translate-y-1/2"
              :class="(i - 1) / tickCount <= percentage ? 'bg-slider-tick-active' : 'bg-slider-tick'"
              :style="{
                left: `${((i - 1) / tickCount) * 100}%`,
                opacity: tickOpacity((i - 1) / tickCount),
              }"
            />
          </div>
        </Transition>

        <!-- Label -->
        <span
          v-if="label"
          ref="labelRef"
          class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-copy-sm text-neutral select-none"
        >
          {{ label }}
        </span>

        <!-- Value -->
        <div
          ref="valueRef"
          class="pointer-events-auto absolute right-2 top-1/2 -translate-y-1/2"
          @pointerdown.stop
        >
          <input
            v-if="isEditing"
            ref="inputRef"
            :value="displayValue"
            type="text"
            class="w-12 rounded bg-tint-subtle px-1 text-right font-mono text-copy-sm text-neutral-strong outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
            @blur="commitValue"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
            @keydown.escape="isEditing = false"
          />
          <button
            v-else
            class="cursor-text rounded px-1 font-mono text-copy-sm tabular-nums text-neutral-subtle transition-colors hover:text-neutral-strong"
            @click.stop="startEdit"
          >
            {{ displayValue }}{{ unit }}
          </button>
        </div>

        <SliderThumb class="size-0 focus:outline-none focus-visible:outline-none" />
      </SliderTrack>
    </SliderRoot>
  </div>
</template>

<style scoped>
.slider-fill {
  transition: background-color 150ms ease-out;
}

.slider-tick {
  transition: opacity 150ms ease-out;
}

.slider-ticks-enter-active,
.slider-ticks-leave-active {
  transition: opacity 150ms ease-out;
}
.slider-ticks-enter-from,
.slider-ticks-leave-to {
  opacity: 0;
}

.slider-handle-enter-active,
.slider-handle-leave-active {
  transition: opacity 120ms ease-out, transform 120ms ease-out;
}
.slider-handle-enter-from,
.slider-handle-leave-to {
  opacity: 0;
  transform: scaleY(0.6);
}
</style>
