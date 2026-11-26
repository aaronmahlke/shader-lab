<script setup lang="ts">
/** Audio layer → Trigger: play the sound on picture events, anchored and varied. */
import type { LayerInstance } from "@shader-lab/core";
import type { AudioTrigger } from "~/utils/audio-triggers";
import { layerStudioIcon } from "~/utils/layer-icons";
import { uploadMediaFile } from "~/utils/media-upload";

const props = defineProps<{ layer: LayerInstance; layers: readonly LayerInstance[]; projectId?: string | null }>();
const history = useEditorHistory();

const trig = computed(() => props.layer.trigger as AudioTrigger | undefined);
const ON = [
  { value: "off", label: "Off (plays on its own)" },
  { value: "press", label: "Pointer press" },
  { value: "release", label: "Pointer release" },
  { value: "motionPeak", label: "Motion: speed peak" },
  { value: "motionStart", label: "Motion: start" },
  { value: "motionEnd", label: "Motion: end" },
  { value: "in", label: "Layer in point" },
  { value: "out", label: "Layer out point" },
  { value: "cue", label: "Component cue" },
  { value: "marker", label: "Marker" },
];
const ANCHOR = [
  { value: "onset", label: "Onset" },
  { value: "peak", label: "Peak" },
  { value: "end", label: "End" },
];
const targetOptions = computed(() =>
  props.layers.filter((l) => l.id !== props.layer.id && l.type !== "audio").map((l) => ({ value: l.id, label: l.name ?? l.type, icon: layerStudioIcon(l.type) })),
);

function set(p: Partial<AudioTrigger> | null) {
  if (p === null) delete props.layer.trigger;
  else props.layer.trigger = { anchor: "onset", ...(trig.value ?? { on: "press" }), ...p } as AudioTrigger;
  history?.record();
}
const uploading = ref(false);
async function addAlternate(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = "";
  if (!file) return;
  uploading.value = true;
  try {
    const url = await uploadMediaFile("audio", file, props.projectId);
    set({ alternates: [...(trig.value?.alternates ?? []), url] });
  } finally {
    uploading.value = false;
  }
}
</script>

<template>
  <EditorInspectorSection title="Trigger">
    <UiSelect
      label="Play on"
      :model-value="trig?.on ?? 'off'"
      :options="ON"
      @update:model-value="$event === 'off' ? set(null) : set({ on: $event as AudioTrigger['on'] })"
    />
    <template v-if="trig">
      <StudioRefField
        kind="layer"
        label="From layer"
        :model-value="trig.target ?? ''"
        :options="targetOptions"
        placeholder="Any layer"
        @update:model-value="set({ target: $event || undefined })"
      />
      <StudioField v-if="trig.on === 'cue' || trig.on === 'marker'" label="Name (optional)">
        <StudioInput :model-value="trig.name ?? ''" placeholder="e.g. keystroke" @update:model-value="set({ name: $event || undefined })" />
      </StudioField>
      <div class="grid grid-cols-2 gap-[4px]">
        <UiSelect label="Anchor" :model-value="trig.anchor ?? 'onset'" :options="ANCHOR" @update:model-value="set({ anchor: $event as AudioTrigger['anchor'] })" />
        <StudioField label="Nudge">
          <StudioValue :model-value="trig.offsetMs ?? 0" :min="-500" :max="500" :step="1" :precision="0" unit=" ms" :default-value="0" @update:model-value="set({ offsetMs: $event })" />
        </StudioField>
        <StudioField label="Pitch ±">
          <StudioValue :model-value="trig.pitchJitter ?? 0" :min="0" :max="12" :step="0.1" :precision="1" unit=" st" :default-value="0" @update:model-value="set({ pitchJitter: $event })" />
        </StudioField>
        <StudioField label="Gain ±">
          <StudioValue :model-value="trig.gainJitter ?? 0" :min="0" :max="12" :step="0.1" :precision="1" unit=" dB" :default-value="0" @update:model-value="set({ gainJitter: $event })" />
        </StudioField>
      </div>
      <StudioField v-if="trig.on.startsWith('motion')" label="Fit to move" inline>
        <StudioSegmented :model-value="!!trig.fit" :options="[{ value: true, label: 'On' }, { value: false, label: 'Off' }]" @update:model-value="set({ fit: $event })" />
      </StudioField>
      <div class="flex items-center gap-[4px]">
        <span class="flex-1 text-[var(--s-dim)]">
          {{ (trig.alternates?.length ?? 0) + 1 }} sound{{ trig.alternates?.length ? "s" : "" }} (round-robin)
        </span>
        <label class="flex h-[var(--s-ctl)] cursor-default items-center bg-[var(--s-inset)] px-[6px] shadow-[inset_0_0_0_1px_var(--s-edge)] hover:bg-[var(--s-inset-hover)]">
          {{ uploading ? "Uploading…" : "Add alternate…" }}
          <input type="file" class="hidden" accept="audio/*" @change="addAlternate" />
        </label>
        <StudioButton v-if="trig.alternates?.length" variant="ghost" square title="Clear alternates" aria-label="Clear alternates" @click="set({ alternates: [] })">
          <StudioIcon name="close" />
        </StudioButton>
      </div>
    </template>
  </EditorInspectorSection>
</template>
