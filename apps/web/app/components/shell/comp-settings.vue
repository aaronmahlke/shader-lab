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
    <EditorInspectorSection :title="`Composition · ${compName}`">
      <StudioField label="Format" inline>
        <UiSelect :model-value="presetValue" :options="presetOptions" @update:model-value="onPreset(String($event))" />
      </StudioField>
      <StudioField label="Size" inline>
        <div class="grid grid-cols-2 gap-[4px]">
          <StudioValue
            label="W"
            :model-value="settings.width"
            :min="16"
            :max="8192"
            :step="1"
            :precision="0"
            :fill="false"
            @update:model-value="emit('set-size', Math.round($event), settings.height)"
          />
          <StudioValue
            label="H"
            :model-value="settings.height"
            :min="16"
            :max="8192"
            :step="1"
            :precision="0"
            :fill="false"
            @update:model-value="emit('set-size', settings.width, Math.round($event))"
          />
        </div>
      </StudioField>
      <StudioField label="Frame rate" inline>
        <UiSelect :model-value="settings.fps" :options="FPS" @update:model-value="emit('update', { fps: Number($event) })" />
      </StudioField>
      <StudioField label="Duration" inline>
        <StudioValue
          :model-value="settings.duration"
          :min="0.1"
          :max="600"
          :step="0.1"
          :precision="2"
          unit="s"
          :fill="false"
          @update:model-value="emit('update', { duration: $event })"
        />
      </StudioField>
    </EditorInspectorSection>

    <EditorInspectorSection title="Render">
      <StudioField label="Motion blur" inline>
        <StudioSegmented
          :model-value="settings.motionBlur === true"
          :options="[{ value: true, label: 'On' }, { value: false, label: 'Off' }]"
          @update:model-value="emit('update', { motionBlur: $event })"
        />
      </StudioField>
      <template v-if="settings.motionBlur === true">
        <StudioField label="Shutter" inline>
          <StudioValue
            :model-value="settings.shutterAngle ?? 180"
            :min="0"
            :max="720"
            :step="15"
            :precision="0"
            unit="°"
            @update:model-value="emit('update', { shutterAngle: Math.round($event) })"
          />
        </StudioField>
        <StudioField label="Samples" inline>
          <StudioValue
            :model-value="settings.motionBlurSamples ?? 8"
            :min="2"
            :max="32"
            :step="1"
            :precision="0"
            @update:model-value="emit('update', { motionBlurSamples: Math.round($event) })"
          />
        </StudioField>
      </template>
    </EditorInspectorSection>

    <ShellCompPropsPanel
      :model-value="settings.props ?? []"
      @update:model-value="emit('update', { props: $event })"
    />
  </div>
</template>
