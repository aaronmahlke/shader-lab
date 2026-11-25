<script setup lang="ts">
import { XMarkIcon } from "@heroicons/vue/16/solid";
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
  <div class="w-[440px] rounded-lg bg-control-strong p-1 shadow-panel">
    <div class="flex flex-col gap-1">
      <div class="flex items-center gap-2">
        <div class="flex min-w-0 flex-1 items-center gap-2 px-2">
          <UiLfoSineIcon class="h-2 w-5 shrink-0" :style="{ color: lfo.color }" />
          <UiEditableText
            v-model="lfo.label"
            fill
            class="min-w-0 flex-1 text-copy-sm leading-5 text-neutral"
          />
        </div>
        <UiButton
          variant="secondary"
          size="sm"
          :active="true"
          :icon-left="XMarkIcon"
          title="Close"
          class="shrink-0"
          @click="emit('close')"
        />
      </div>

      <div class="overflow-hidden rounded-lg bg-black">
        <EditorWaveEditor
          v-model="lfo.points"
          :wave-shape="lfo.waveShape ?? 'sine'"
          :editable="isCustom"
          :color="lfo.color"
          :cursor-position="cursorPosition"
          class="h-24"
        />
      </div>

      <div class="flex flex-wrap items-center gap-1.5">
        <UiButton
          variant="option"
          size="sm"
          :active="isCustom"
          @click="setCustom"
        >
          Custom
        </UiButton>

        <UiButton
          variant="option"
          size="sm"
          :active="!isCustom"
          @click="setSine"
        >
          Sine
        </UiButton>

        <UiButton
          v-for="(preset, key) in LFO_PRESETS"
          v-show="key !== 'sine'"
          :key="key"
          variant="option"
          size="sm"
          :active="activePreset === key"
          @click="applyPreset(key as string)"
        >
          {{ preset.label }}
        </UiButton>

        <div class="ml-auto flex gap-1.5">
          <UiButton
            variant="option"
            size="sm"
            :active="lfo.mode === 'loop'"
            @click="lfo.mode = 'loop'"
          >
            Loop
          </UiButton>
          <UiButton
            variant="option"
            size="sm"
            :active="lfo.mode === 'pingpong'"
            @click="lfo.mode = 'pingpong'"
          >
            Ping-pong
          </UiButton>
        </div>
      </div>

      <div class="flex flex-col gap-2.5">
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
  </div>
</template>
