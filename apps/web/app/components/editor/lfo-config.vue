<script setup lang="ts">
import {
  evaluatePropertyTrack,
  findPropertyTrack,
  hasKeyframeAt,
  isPropertyTrackActive,
  removeKeyframeAt,
  setTrackEnabled,
  sourceTrackLayerId,
  upsertKeyframe,
  type LFOSource,
  type PropertyTrack,
} from "@shader-lab/core";
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

const history = useEditorHistory();

const tracks = inject<Ref<PropertyTrack[]> | null>("editorTracks", null);
const time = inject<Ref<number> | null>("editorTime", null);

/**
 * A keyframeable LFO param (rate, phase): shows the value at the playhead and,
 * with the stopwatch on, edits key the playhead instead of the static value.
 */
function useAnimatedParam(name: "rate" | "phase") {
  const owner = () => sourceTrackLayerId(lfo.id);
  const track = () => (tracks ? findPropertyTrack(tracks.value, owner(), name) : undefined);
  const active = computed(() => isPropertyTrackActive(track()));
  const keyed = computed(() => !!time && hasKeyframeAt(track(), time.value));
  const value = computed({
    get: () => evaluatePropertyTrack(track(), time?.value ?? 0, lfo[name]),
    set: (v: number) => {
      if (active.value && tracks && time) {
        tracks.value = upsertKeyframe(tracks.value, owner(), name, time.value, v);
      } else {
        lfo[name] = v;
      }
    },
  });
  function toggleTrack() {
    if (!tracks || !time) return;
    tracks.value = active.value
      ? setTrackEnabled(tracks.value, owner(), name, false)
      : setTrackEnabled(tracks.value, owner(), name, true, value.value, time.value);
    history?.record();
  }
  function toggleKeyframe() {
    if (!tracks || !time || !active.value) return;
    tracks.value = keyed.value
      ? removeKeyframeAt(tracks.value, owner(), name, time.value)
      : upsertKeyframe(tracks.value, owner(), name, time.value, value.value);
    history?.record();
  }
  return reactive({ value, active, keyed, toggleTrack, toggleKeyframe, animatable: !!tracks && !!time });
}

const rate = useAnimatedParam("rate");
const phase = useAnimatedParam("phase");

const isCustom = computed(() => (lfo.waveShape ?? "sine") === "custom");

const activePreset = computed(() => {
  if (!isCustom.value) return "sine";
  for (const [key, preset] of Object.entries(LFO_PRESETS)) {
    if (key === "sine") continue;
    if (JSON.stringify(preset.points) === JSON.stringify(lfo.points)) return key;
  }
  return null;
});

function setSine() {
  lfo.waveShape = "sine";
  lfo.points = clonePresetPoints("sine");
  history?.record();
}

function setCustom() {
  lfo.waveShape = "custom";
  history?.record();
}

function applyPreset(key: string) {
  lfo.waveShape = "custom";
  lfo.points = clonePresetPoints(key);
  history?.record();
}
</script>

<template>
  <!-- Studio floating panel: header band, dark wave inset, word toggles, value sliders. -->
  <div data-ui="studio" class="w-[440px] overflow-hidden rounded-[var(--s-r)] bg-[var(--s-tile)] shadow-[0_0_0_1px_var(--s-edge),0_8px_24px_#000a]">
    <div class="flex h-[var(--s-row)] items-center gap-[6px] bg-[var(--s-band)] pr-[2px] pl-[6px]">
      <UiLfoSineIcon class="h-1.5 w-4 shrink-0" :style="{ color: lfo.color }" />
      <UiEditableText v-model="lfo.label" fill class="min-w-0 flex-1 !text-[length:var(--s-fs)]" />
      <StudioButton variant="ghost" square aria-label="Close" title="Close" @click="emit('close')">
        <StudioIcon name="close" />
      </StudioButton>
    </div>

    <div class="flex flex-col gap-[6px] p-[6px]">
      <div class="overflow-hidden bg-[var(--s-inset)] shadow-[inset_0_0_0_1px_var(--s-edge)]">
        <EditorWaveEditor
          v-model="lfo.points"
          :wave-shape="lfo.waveShape ?? 'sine'"
          :editable="isCustom"
          :color="lfo.color"
          :cursor-position="cursorPosition"
          class="h-24"
        />
      </div>

      <div class="flex flex-wrap items-center gap-[2px]">
        <StudioButton :active="isCustom && !activePreset" @click="setCustom">Custom</StudioButton>
        <StudioButton :active="!isCustom" @click="setSine">Sine</StudioButton>
        <StudioButton
          v-for="(preset, key) in LFO_PRESETS"
          v-show="key !== 'sine'"
          :key="key"
          :active="activePreset === key"
          @click="applyPreset(key as string)"
        >
          {{ preset.label }}
        </StudioButton>
        <span class="flex-1" />
        <StudioSegmented
          :model-value="lfo.mode ?? 'loop'"
          :options="[{ value: 'loop', label: 'Loop' }, { value: 'pingpong', label: 'Ping-pong' }]"
          @update:model-value="lfo.mode = $event as 'loop' | 'pingpong'"
        />
      </div>

      <UiSliderField
        v-model="rate.value"
        label="Rate"
        :min="0.01"
        :max="3"
        :step="0.01"
        :animatable="rate.animatable"
        :track-enabled="rate.active"
        :keyed-at-playhead="rate.keyed"
        @toggle-track="rate.toggleTrack"
        @toggle-keyframe="rate.toggleKeyframe"
      />
      <UiSliderField
        v-model="phase.value"
        label="Phase"
        :min="0"
        :max="360"
        :step="1"
        :animatable="phase.animatable"
        :track-enabled="phase.active"
        :keyed-at-playhead="phase.keyed"
        @toggle-track="phase.toggleTrack"
        @toggle-keyframe="phase.toggleKeyframe"
      />
    </div>
  </div>
</template>
