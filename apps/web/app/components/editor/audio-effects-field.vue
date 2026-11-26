<script setup lang="ts">
/**
 * Effect chain editor (audio layer, precomp bus, master): add, toggle,
 * reorder, remove, edit params. Keyed params (fx:<id>:<param> tracks) show
 * as automated.
 */
import type { LayerInstance, PropertyTrack } from "@shader-lab/core";
import { AUDIO_EFFECTS, audioEffectDef, fxTrackName, newAudioEffect, type AudioEffect, type AudioEffectType } from "#shared/editor/audio-effects";
import { layerStudioIcon } from "~/utils/layer-icons";

const props = defineProps<{
  modelValue: AudioEffect[] | undefined;
  /** Layers of the owner's comp (duck sources: audio layers + precomps). */
  layers: readonly LayerInstance[];
  /** Owner id for automation tracks (layer id, or "master"). */
  ownerId: string;
  tracks: readonly PropertyTrack[];
}>();
const emit = defineEmits<{ "update:modelValue": [value: AudioEffect[]] }>();

const list = computed(() => props.modelValue ?? []);
const addOptions = AUDIO_EFFECTS.map((d) => ({ value: d.type, label: d.label }));
const sourceOptions = computed(() =>
  props.layers
    .filter((l) => l.type === "audio" || l.type === "composition")
    .map((l) => ({ value: l.id, label: l.name ?? l.type, icon: layerStudioIcon(l.type) })),
);

function commit(next: AudioEffect[]) {
  emit("update:modelValue", next);
}
function add(type: AudioEffectType | string) {
  commit([...list.value, newAudioEffect(type as AudioEffectType)]);
}
function patch(i: number, p: Partial<AudioEffect>) {
  commit(list.value.map((fx, j) => (j === i ? { ...fx, ...p } : fx)));
}
function setParam(i: number, name: string, v: number) {
  const fx = list.value[i]!;
  patch(i, { params: { ...fx.params, [name]: v } });
}
function move(i: number, d: -1 | 1) {
  const next = [...list.value];
  const j = i + d;
  if (j < 0 || j >= next.length) return;
  [next[i], next[j]] = [next[j]!, next[i]!];
  commit(next);
}
function remove(i: number) {
  commit(list.value.filter((_, j) => j !== i));
}
const keyed = (fx: AudioEffect, name: string) =>
  props.tracks.some((t) => t.layerId === props.ownerId && t.paramName === fxTrackName(fx.id, name) && t.enabled && t.keys.length > 0);
</script>

<template>
  <div class="flex flex-col gap-[4px]">
    <div v-for="(fx, i) in list" :key="fx.id" class="flex flex-col gap-[4px] bg-[var(--s-band)] p-[4px]">
      <div class="flex items-center gap-[5px]">
        <button
          type="button"
          class="size-[9px] shrink-0 cursor-default rounded-full outline-none"
          :class="fx.enabled !== false ? 'bg-[var(--s-accent)]' : 'bg-[var(--s-off)]'"
          :aria-label="fx.enabled !== false ? 'Turn off' : 'Turn on'"
          @click="patch(i, { enabled: fx.enabled === false })"
        />
        <span class="min-w-0 flex-1 truncate">{{ audioEffectDef(fx.type)?.label ?? fx.type }}</span>
        <StudioButton variant="ghost" square aria-label="Move up" title="Move up" :disabled="i === 0" @click="move(i, -1)">
          <svg width="7" height="5" viewBox="0 0 7 5" aria-hidden="true"><path d="M0 5h7L3.5 0z" fill="currentColor" /></svg>
        </StudioButton>
        <StudioButton variant="ghost" square aria-label="Move down" title="Move down" :disabled="i === list.length - 1" @click="move(i, 1)">
          <svg width="7" height="5" viewBox="0 0 7 5" aria-hidden="true"><path d="M0 0h7L3.5 5z" fill="currentColor" /></svg>
        </StudioButton>
        <StudioButton variant="ghost" square aria-label="Remove effect" title="Remove effect" @click="remove(i)">
          <StudioIcon name="close" />
        </StudioButton>
      </div>
      <StudioRefField
        v-if="fx.type === 'duck'"
        kind="layer"
        label="Ducked by"
        :model-value="fx.source ?? ''"
        :options="sourceOptions"
        placeholder="Pick a sound or precomp…"
        @update:model-value="patch(i, { source: $event || undefined })"
      />
      <div class="grid grid-cols-2 gap-[3px]">
        <template v-for="p in audioEffectDef(fx.type)?.params ?? []" :key="p.name">
          <UiSelect
            v-if="p.options"
            class="col-span-2"
            :model-value="fx.params[p.name] ?? p.default"
            :options="p.options"
            :label="p.label"
            @update:model-value="setParam(i, p.name, Number($event))"
          />
          <StudioField v-else :label="p.label">
            <StudioValue
              :model-value="fx.params[p.name] ?? p.default"
              :min="p.min"
              :max="p.max"
              :step="p.step"
              :precision="p.step >= 1 ? 0 : p.step >= 0.1 ? 1 : 2"
              :unit="p.unit ?? ''"
              :default-value="p.default"
              :title="keyed(fx, p.name) ? 'Automated (keys)' : undefined"
              :class="keyed(fx, p.name) && 'pointer-events-none opacity-60'"
              @update:model-value="setParam(i, p.name, $event)"
            />
          </StudioField>
        </template>
      </div>
    </div>
    <UiSelect :model-value="''" :options="addOptions" placeholder="Add effect…" @update:model-value="add(String($event))" />
  </div>
</template>
