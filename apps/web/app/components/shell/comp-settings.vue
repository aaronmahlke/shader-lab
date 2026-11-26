<script setup lang="ts">
import type { CompositionSettings } from "@shader-lab/core";

/** Inspector with nothing selected: the comp's own settings. */
const props = defineProps<{ settings: CompositionSettings; compName: string }>();
const emit = defineEmits<{
  "set-size": [width: number, height: number];
  update: [patch: Partial<CompositionSettings>];
}>();

const PRESETS = [
  { label: "Landscape 16:9", width: 1920, height: 1080 },
  { label: "Portrait 9:16", width: 1080, height: 1920 },
  { label: "Square 1:1", width: 1080, height: 1080 },
  { label: "Social 4:5", width: 1080, height: 1350 },
] as const;

const presetValue = computed(() => {
  const p = PRESETS.find((x) => x.width === props.settings.width && x.height === props.settings.height);
  return p?.label ?? "custom";
});
const presetOptions = computed(() => [
  ...PRESETS.map((p) => ({ value: p.label as string, label: p.label })),
  ...(presetValue.value === "custom" ? [{ value: "custom", label: "Custom" }] : []),
]);
function onPreset(label: string) {
  const p = PRESETS.find((x) => x.label === label);
  if (p) emit("set-size", p.width, p.height);
}

const FPS = [24, 25, 30, 50, 60].map((v) => ({ value: v, label: `${v} fps` }));
</script>

<template>
  <!-- data-global-shortcuts: ⌘Z etc. still reach the editor while a field has focus. -->
  <div class="flex flex-col" data-global-shortcuts>
    <section class="flex flex-col gap-1 border-b border-neutral-subtle px-3 pt-3 pb-3">
      <h3 class="mb-1 text-xs font-medium text-neutral-subtle">Composition · {{ compName }}</h3>
      <div class="shell-row">
        <span>Format</span>
        <d-select size="sm" :model-value="presetValue" :options="presetOptions" @update:model-value="onPreset" />
      </div>
      <div class="shell-row">
        <span>Width</span>
        <d-number-field
          size="sm"
          :model-value="settings.width"
          :min="16"
          :max="8192"
          :format-options="{ useGrouping: false }"
          @update:model-value="emit('set-size', $event, settings.height)"
        />
      </div>
      <div class="shell-row">
        <span>Height</span>
        <d-number-field
          size="sm"
          :model-value="settings.height"
          :min="16"
          :max="8192"
          :format-options="{ useGrouping: false }"
          @update:model-value="emit('set-size', settings.width, $event)"
        />
      </div>
      <div class="shell-row">
        <span>Frame rate</span>
        <d-select size="sm" :model-value="settings.fps" :options="FPS" @update:model-value="emit('update', { fps: $event })" />
      </div>
      <div class="shell-row">
        <span>Duration</span>
        <d-number-field
          size="sm"
          :model-value="settings.duration"
          :min="0.1"
          :max="600"
          :step="0.5"
          :format-options="{ maximumFractionDigits: 2, style: 'unit', unit: 'second', unitDisplay: 'narrow' }"
          @update:model-value="emit('update', { duration: $event })"
        />
      </div>
    </section>

    <section class="flex flex-col gap-1 border-b border-neutral-subtle px-3 pt-3 pb-3">
      <h3 class="mb-1 text-xs font-medium text-neutral-subtle">Render</h3>
      <div class="shell-row">
        <span>Motion blur</span>
        <d-switch size="sm" :model-value="settings.motionBlur !== false" @update:model-value="emit('update', { motionBlur: $event })" />
      </div>
      <template v-if="settings.motionBlur !== false">
        <div class="shell-row">
          <span>Shutter</span>
          <d-number-field
            size="sm"
            :model-value="settings.shutterAngle ?? 180"
            :min="0"
            :max="720"
            :step="15"
            :format-options="{ style: 'unit', unit: 'degree', unitDisplay: 'narrow' }"
            @update:model-value="emit('update', { shutterAngle: $event })"
          />
        </div>
        <div class="shell-row">
          <span>Samples</span>
          <d-number-field
            size="sm"
            :model-value="settings.motionBlurSamples ?? 8"
            :min="2"
            :max="32"
            @update:model-value="emit('update', { motionBlurSamples: Math.round($event) })"
          />
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.shell-row {
  display: grid;
  grid-template-columns: 5.5rem minmax(0, 1fr);
  align-items: center;
  gap: 0.5rem;
  min-height: 2rem;
}
.shell-row > span {
  font-size: 0.75rem;
  color: var(--text-color-neutral-subtle);
}
</style>
