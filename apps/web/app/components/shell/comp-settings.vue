<script setup lang="ts">
import type { CompositionSettings, LayerInstance, PropertyTrack } from "@shader-lab/core";
import type { AudioEffect } from "#shared/editor/audio-effects";
import type { SoundRule } from "#shared/editor/sound-rules";

/** Inspector with nothing selected: the comp's own settings. */
const props = defineProps<{ settings: CompositionSettings; compName: string }>();
const emit = defineEmits<{
  "set-size": [width: number, height: number];
  update: [patch: Partial<CompositionSettings>];
  "mix-save": [name: string];
  "mix-apply": [id: string];
  "mix-delete": [id: string];
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
const editorLayers = inject<Ref<LayerInstance[]> | null>("editorLayers", null);
const editorTracks = inject<Ref<PropertyTrack[]> | null>("editorTracks", null);
/** Project sound kit + project id (provided by the editor page). */
const soundRulesCtx = inject<{ project: Ref<SoundRule[]>; projectId: Ref<string | null> } | null>("soundRules", null);
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

    <EditorInspectorSection title="Tempo">
      <StudioField label="BPM" inline>
        <StudioValue
          :model-value="settings.bpm ?? 0"
          :min="0"
          :max="300"
          :step="0.1"
          :precision="1"
          :fill="false"
          title="0 = no grid"
          @update:model-value="emit('update', { bpm: $event > 0 ? $event : undefined })"
        />
      </StudioField>
      <template v-if="(settings.bpm ?? 0) > 0">
        <StudioField label="Offset" inline>
          <StudioValue
            :model-value="settings.bpmOffset ?? 0"
            :min="-10"
            :max="60"
            :step="0.001"
            :precision="3"
            unit=" s"
            :fill="false"
            title="Time of a downbeat"
            @update:model-value="emit('update', { bpmOffset: $event })"
          />
        </StudioField>
        <StudioField label="Beats / bar" inline>
          <StudioValue
            :model-value="settings.beatsPerBar ?? 4"
            :min="1"
            :max="16"
            :step="1"
            :precision="0"
            :fill="false"
            @update:model-value="emit('update', { beatsPerBar: Math.round($event) })"
          />
        </StudioField>
      </template>
    </EditorInspectorSection>

    <EditorSoundRulesField
      v-if="soundRulesCtx"
      :settings="settings"
      :project-rules="soundRulesCtx.project.value"
      :layers="editorLayers?.value ?? []"
      :tracks="editorTracks?.value ?? []"
      :project-id="soundRulesCtx.projectId.value"
    />

    <EditorInspectorSection title="Master (audio)">
      <StudioField label="Volume" inline>
        <StudioValue
          :model-value="settings.masterVolume ?? 0"
          :min="-48"
          :max="12"
          :step="0.1"
          :precision="1"
          unit=" dB"
          :default-value="0"
          @update:model-value="emit('update', { masterVolume: $event })"
        />
      </StudioField>
      <div v-if="settings.mixVersions?.length" class="flex flex-col gap-[2px]">
        <div
          v-for="m in settings.mixVersions"
          :key="m.id"
          class="flex h-[var(--s-ctl)] items-center gap-[4px] bg-[var(--s-inset)] pl-[6px] shadow-[inset_0_0_0_1px_var(--s-edge)]"
        >
          <span class="flex-1 truncate" :class="m.id === settings.activeMix ? 'text-[var(--s-accent)]' : ''">{{ m.name }}</span>
          <StudioButton variant="ghost" :active="m.id === settings.activeMix" title="Use this mix" @click="emit('mix-apply', m.id)">Use</StudioButton>
          <StudioButton variant="ghost" square title="Delete mix version" aria-label="Delete mix version" @click="emit('mix-delete', m.id)">
            <StudioIcon name="close" />
          </StudioButton>
        </div>
      </div>
      <StudioButton title="Snapshot the current sound (audio layers, buses, master) as a mix version" @click="emit('mix-save', `Mix ${String.fromCharCode(65 + (settings.mixVersions?.length ?? 0) % 26)}`)">
        Save mix version
      </StudioButton>
      <EditorAudioEffectsField
        :model-value="settings.masterEffects as AudioEffect[] | undefined"
        :layers="editorLayers?.value ?? []"
        owner-id="master"
        :tracks="editorTracks?.value ?? []"
        @update:model-value="emit('update', { masterEffects: $event })"
      />
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
