<script setup lang="ts">
/**
 * Mixer (Ableton-style channel strips): one per audio layer, one per
 * precomp that holds sound (its group bus), and master. Live meters while
 * playing; fader in dB, pan, mute, solo. Automated (keyed) faders are shown
 * but edited on the timeline.
 */
import type { CompositionSettings, LayerInstance, PropertyTrack } from "@shader-lab/core";
import type { AudioEntry } from "~/composables/use-audio-playback";
import { isRuleLayerId } from "#shared/editor/sound-rules";

const props = defineProps<{
  layers: LayerInstance[];
  tracks: PropertyTrack[];
  settings: CompositionSettings;
  entries: readonly AudioEntry[];
  meters: Record<string, number>;
}>();
const emit = defineEmits<{ "update-settings": [patch: Partial<CompositionSettings>] }>();
const history = useEditorHistory();

type Strip = {
  key: string;
  name: string;
  layer: LayerInstance | null;
  kind: "audio" | "group" | "master";
  volParam: string;
  panParam: string;
};

const strips = computed<Strip[]>(() => {
  const groups = new Set(props.entries.map((e) => e.hosts[0]?.key).filter(Boolean) as string[]);
  const out: Strip[] = [];
  for (const l of props.layers) {
    if (l.type === "audio") out.push({ key: l.id, name: l.name ?? "Audio", layer: l, kind: "audio", volParam: "volume", panParam: "pan" });
    else if (l.type === "composition" && groups.has(l.id)) {
      out.push({ key: l.id, name: l.name ?? "Precomp", layer: l, kind: "group", volParam: "audioVolume", panParam: "audioPan" });
    }
  }
  return out;
});

const keyed = (layer: LayerInstance | null, param: string) =>
  !!layer && props.tracks.some((t) => t.layerId === layer.id && t.paramName === param && t.enabled && t.keys.length > 0);
const num = (layer: LayerInstance, p: string, d: number) => (typeof layer.values[p] === "number" ? (layer.values[p] as number) : d);

function setParam(layer: LayerInstance, p: string, v: number) {
  layer.values[p] = v;
  history?.record();
}
function toggle(layer: LayerInstance, flag: "audioMuted" | "audioSolo") {
  // Sound rules: the strip's layer is virtual; its values ARE the rule.
  if (isRuleLayerId(layer.id)) {
    const rule = layer.values as Record<string, unknown>;
    const key = flag === "audioMuted" ? "muted" : "solo";
    if (rule[key]) delete rule[key];
    else rule[key] = true;
    history?.record();
    return;
  }
  if (layer[flag]) delete layer[flag];
  else layer[flag] = true;
  history?.record();
}

/** Meter fill 0..1 for a peak in dB (−48 … +6). */
const fill = (db: number | undefined) => (db === undefined || !Number.isFinite(db) ? 0 : Math.min(1, Math.max(0, (db + 48) / 54)));
</script>

<template>
  <div class="flex h-full min-h-0 gap-[2px] overflow-x-auto bg-[var(--s-frame)] p-[2px]" data-global-shortcuts>
    <div v-if="!strips.length" class="flex flex-1 items-center justify-center bg-[var(--s-tile)] text-[var(--s-dim)]">
      No sound in this comp yet. Drop an audio file on the canvas.
    </div>
    <div
      v-for="s in [...strips, { key: 'master', name: 'Master', layer: null, kind: 'master', volParam: '', panParam: '' } as Strip]"
      :key="s.key"
      class="flex w-[76px] shrink-0 flex-col gap-[3px] bg-[var(--s-tile)] p-[4px]"
      :class="s.kind === 'master' && 'ml-auto'"
    >
      <div class="flex items-center gap-[4px]" :title="s.name">
        <StudioIcon :name="s.kind === 'group' ? 'comp' : s.kind === 'master' ? 'audio' : 'audio'" class="shrink-0 text-[var(--s-dim)]" />
        <span class="min-w-0 flex-1 truncate">{{ s.name }}</span>
      </div>

      <!-- meter -->
      <div class="relative min-h-[40px] flex-1 bg-[var(--s-inset)] shadow-[inset_0_0_0_1px_var(--s-edge)]">
        <div
          class="absolute inset-x-[3px] bottom-[2px] transition-[height] duration-75"
          :class="(meters[s.key] ?? -Infinity) > -0.5 ? 'bg-[var(--s-danger)]' : 'bg-[#5bd16b]'"
          :style="{ height: `calc(${fill(meters[s.key]) * 100}% - 4px)` }"
        />
        <span class="absolute top-[2px] right-[3px] text-[var(--s-dim)] tabular-nums">
          {{ Number.isFinite(meters[s.key] ?? -Infinity) ? Math.round(meters[s.key]!) : "–∞" }}
        </span>
      </div>

      <!-- fader (dB) -->
      <StudioValue
        v-if="s.layer"
        :model-value="num(s.layer, s.volParam, 0)"
        :min="-48"
        :max="12"
        :step="0.1"
        :precision="1"
        unit=" dB"
        :default-value="0"
        :title="keyed(s.layer, s.volParam) ? 'Automated: edit the keys on the timeline' : 'Volume'"
        :class="keyed(s.layer, s.volParam) && 'pointer-events-none opacity-60'"
        @update:model-value="setParam(s.layer!, s.volParam, $event)"
      />
      <StudioValue
        v-else
        :model-value="settings.masterVolume ?? 0"
        :min="-48"
        :max="12"
        :step="0.1"
        :precision="1"
        unit=" dB"
        :default-value="0"
        title="Master volume"
        @update:model-value="emit('update-settings', { masterVolume: $event })"
      />

      <!-- pan -->
      <StudioValue
        v-if="s.layer"
        label="Pan"
        :model-value="num(s.layer, s.panParam, 0)"
        :min="-1"
        :max="1"
        :step="0.01"
        :precision="2"
        :default-value="0"
        :class="keyed(s.layer, s.panParam) && 'pointer-events-none opacity-60'"
        @update:model-value="setParam(s.layer!, s.panParam, $event)"
      />
      <div v-else class="h-[var(--s-ctl)]" />

      <!-- mute / solo -->
      <div v-if="s.layer" class="grid grid-cols-2 gap-[2px]">
        <StudioButton :active="!!s.layer.audioMuted" class="justify-center" title="Mute (sound only)" @click="toggle(s.layer!, 'audioMuted')">M</StudioButton>
        <StudioButton :active="!!s.layer.audioSolo" class="justify-center" title="Solo" @click="toggle(s.layer!, 'audioSolo')">S</StudioButton>
      </div>
      <div v-else class="h-[var(--s-ctl)]" />
    </div>
  </div>
</template>
