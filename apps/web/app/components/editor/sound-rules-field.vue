<script setup lang="ts">
/**
 * Sound rules ("on <event> play <sound>"): the project's kit (every comp)
 * and this comp's own rules. Not clips, so not on the timeline; each rule
 * is a mixer strip ("rule:<id>").
 */
import type { CompositionSettings, LayerInstance, PropertyTrack } from "@shader-lab/core";
import type { AudioEffect } from "#shared/editor/audio-effects";
import { defaultRuleLabel, ruleLayerId, type SoundRule } from "#shared/editor/sound-rules";
import { isSynthSrc, SYNTH_PRESETS, synthSrc } from "~/utils/audio-synth";
import { layerStudioIcon } from "~/utils/layer-icons";
import { mediaSrcFileName, uploadMediaFile } from "~/utils/media-upload";

const props = defineProps<{
  settings: CompositionSettings;
  /** Project kit (mutated in place; the page saves it). */
  projectRules: SoundRule[];
  layers: readonly LayerInstance[];
  tracks: readonly PropertyTrack[];
  projectId?: string | null;
}>();
const history = useEditorHistory();

const compRules = computed(() => (props.settings.soundRules as SoundRule[] | undefined) ?? []);
const overridden = computed(() => new Set(compRules.value.map((r) => r.id)));
const open = ref<string | null>(null);

const ON = [
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
const SOUND = [{ value: "none", label: "Synth preset…" }, ...Object.keys(SYNTH_PRESETS).map((k) => ({ value: k, label: k }))];
const targetOptions = computed(() =>
  props.layers.filter((l) => l.type !== "audio").map((l) => ({ value: l.id, label: l.name ?? l.type, icon: layerStudioIcon(l.type) })),
);

const newId = () => Math.random().toString(36).slice(2, 10);
function setCompRules(next: SoundRule[]) {
  props.settings.soundRules = next as CompositionSettings["soundRules"];
  history?.record();
}
function add(scope: "project" | "comp") {
  const rule: SoundRule = { id: newId(), on: "press", src: synthSrc(SYNTH_PRESETS.Click!) };
  if (scope === "project") props.projectRules.push(rule);
  else setCompRules([...compRules.value, rule]);
  open.value = rule.id;
}
function remove(scope: "project" | "comp", rule: SoundRule) {
  if (scope === "project") props.projectRules.splice(props.projectRules.indexOf(rule), 1);
  else setCompRules(compRules.value.filter((r) => r !== rule));
}
/** Move a rule between the project kit and this comp. */
function move(scope: "project" | "comp", rule: SoundRule) {
  const copy = JSON.parse(JSON.stringify(rule)) as SoundRule;
  if (scope === "project") {
    props.projectRules.splice(props.projectRules.indexOf(rule), 1);
    setCompRules([...compRules.value, copy]);
  } else {
    setCompRules(compRules.value.filter((r) => r !== rule));
    props.projectRules.push(copy);
  }
}
/** Turn a project rule off (or back on) for this comp only. */
function toggleForComp(rule: SoundRule) {
  if (overridden.value.has(rule.id)) setCompRules(compRules.value.filter((r) => r.id !== rule.id));
  else setCompRules([...compRules.value, { ...JSON.parse(JSON.stringify(rule)), enabled: false }]);
}
function patch(scope: "project" | "comp", rule: SoundRule, p: Partial<SoundRule>) {
  Object.assign(rule, p);
  for (const k of Object.keys(p) as (keyof SoundRule)[]) if (p[k] === undefined) delete rule[k];
  if (scope === "comp") setCompRules([...compRules.value]);
}

const uploading = ref<string | null>(null);
async function upload(scope: "project" | "comp", rule: SoundRule, e: Event, alternate = false) {
  const file = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = "";
  if (!file) return;
  uploading.value = rule.id;
  try {
    const url = await uploadMediaFile("audio", file, props.projectId);
    patch(scope, rule, alternate ? { alternates: [...(rule.alternates ?? []), url] } : { src: url });
  } finally {
    uploading.value = null;
  }
}
const soundName = (src: string) => (isSynthSrc(src) ? "Synth patch" : mediaSrcFileName(src));
const summary = (r: SoundRule) =>
  `${ON.find((o) => o.value === r.on)?.label ?? r.on}${r.name ? ` "${r.name}"` : ""}${r.target ? ` · ${props.layers.find((l) => l.id === r.target)?.name ?? "layer"}` : ""} → ${soundName(r.src)}`;
</script>

<template>
  <EditorInspectorSection title="Sound rules">
    <template v-for="scope in (['project', 'comp'] as const)" :key="scope">
      <div class="flex h-[var(--s-row)] items-center gap-[4px] text-[var(--s-dim)]">
        <span class="flex-1">{{ scope === "project" ? "Project (every comp)" : "This comp" }}</span>
        <StudioButton variant="ghost" square :title="`Add a ${scope === 'project' ? 'project' : 'comp'} rule`" :aria-label="`Add ${scope} rule`" @click="add(scope)">
          <StudioIcon name="plus" />
        </StudioButton>
      </div>
      <div
        v-for="rule in (scope === 'project' ? projectRules : compRules.filter((r) => !projectRules.some((p) => p.id === r.id) || r.enabled !== false))"
        :key="`${scope}-${rule.id}`"
        class="flex flex-col bg-[var(--s-inset)] shadow-[inset_0_0_0_1px_var(--s-edge)]"
      >
        <div class="flex h-[var(--s-ctl)] items-center gap-[4px] pl-[4px]">
          <StudioButton
            v-if="scope === 'project'"
            variant="ghost"
            square
            :title="overridden.has(rule.id) ? 'Off or overridden in this comp — click to use the project rule' : 'Turn off in this comp'"
            :aria-label="overridden.has(rule.id) ? 'Use in this comp' : 'Turn off in this comp'"
            @click="toggleForComp(rule)"
          >
            <StudioIcon :name="overridden.has(rule.id) ? 'minus' : 'eye'" />
          </StudioButton>
          <button
            type="button"
            class="flex min-w-0 flex-1 cursor-default flex-col items-start text-left"
            :class="scope === 'project' && overridden.has(rule.id) ? 'opacity-40' : ''"
            :title="summary(rule)"
            @click="open = open === rule.id ? null : rule.id"
          >
            <span class="w-full truncate">{{ rule.label || defaultRuleLabel(rule) }}</span>
          </button>
          <StudioButton variant="ghost" square :title="scope === 'project' ? 'Move to this comp' : 'Move to project (every comp)'" :aria-label="scope === 'project' ? 'Move to comp' : 'Move to project'" @click="move(scope, rule)">
            <StudioIcon :name="scope === 'project' ? 'back' : 'forward'" />
          </StudioButton>
          <StudioButton variant="ghost" square title="Delete rule" aria-label="Delete rule" @click="remove(scope, rule)">
            <StudioIcon name="trash" />
          </StudioButton>
        </div>
        <div v-if="open === rule.id" class="flex flex-col gap-[4px] p-[4px] pt-0">
          <StudioField label="Name">
            <StudioInput :model-value="rule.label ?? ''" :placeholder="defaultRuleLabel(rule)" @update:model-value="patch(scope, rule, { label: $event || undefined })" />
          </StudioField>
          <UiSelect label="Play on" :model-value="rule.on" :options="ON" @update:model-value="patch(scope, rule, { on: $event as SoundRule['on'] })" />
          <StudioRefField
            kind="layer"
            label="From layer"
            :model-value="rule.target ?? ''"
            :options="targetOptions"
            placeholder="Any layer"
            clearable
            @update:model-value="patch(scope, rule, { target: $event || undefined })"
          />
          <StudioField v-if="rule.on === 'cue' || rule.on === 'marker'" label="Cue / marker name">
            <StudioInput :model-value="rule.name ?? ''" placeholder="any" @update:model-value="patch(scope, rule, { name: $event || undefined })" />
          </StudioField>
          <StudioField label="Sound">
            <div class="flex items-center gap-[4px]">
              <span class="h-[var(--s-ctl)] min-w-0 flex-1 truncate bg-[var(--s-tile)] px-[5px] leading-[var(--s-ctl)]" :title="rule.src">{{ soundName(rule.src) }}</span>
              <label class="flex h-[var(--s-ctl)] cursor-default items-center bg-[var(--s-tile)] px-[6px] shadow-[inset_0_0_0_1px_var(--s-edge)] hover:bg-[var(--s-inset-hover)]">
                {{ uploading === rule.id ? "Uploading…" : "File…" }}
                <input type="file" class="hidden" accept="audio/*" @change="upload(scope, rule, $event)" />
              </label>
            </div>
          </StudioField>
          <UiSelect model-value="none" :options="SOUND" @update:model-value="$event !== 'none' && patch(scope, rule, { src: synthSrc(SYNTH_PRESETS[$event as string]!) })" />
          <div class="grid grid-cols-2 gap-[4px]">
            <StudioField label="Volume">
              <StudioValue :model-value="rule.volume ?? 0" :min="-48" :max="12" :step="0.1" :precision="1" unit=" dB" :default-value="0" @update:model-value="patch(scope, rule, { volume: $event })" />
            </StudioField>
            <UiSelect label="Anchor" :model-value="rule.anchor ?? 'onset'" :options="ANCHOR" @update:model-value="patch(scope, rule, { anchor: $event as SoundRule['anchor'] })" />
            <StudioField label="Nudge">
              <StudioValue :model-value="rule.offsetMs ?? 0" :min="-500" :max="500" :step="1" :precision="0" unit=" ms" :default-value="0" @update:model-value="patch(scope, rule, { offsetMs: $event })" />
            </StudioField>
            <StudioField label="Pitch ±">
              <StudioValue :model-value="rule.pitchJitter ?? 0" :min="0" :max="12" :step="0.1" :precision="1" unit=" st" :default-value="0" @update:model-value="patch(scope, rule, { pitchJitter: $event })" />
            </StudioField>
            <StudioField label="Gain ±">
              <StudioValue :model-value="rule.gainJitter ?? 0" :min="0" :max="12" :step="0.1" :precision="1" unit=" dB" :default-value="0" @update:model-value="patch(scope, rule, { gainJitter: $event })" />
            </StudioField>
            <StudioField v-if="rule.on.startsWith('motion')" label="Fit to move">
              <StudioSegmented :model-value="!!rule.fit" :options="[{ value: true, label: 'On' }, { value: false, label: 'Off' }]" @update:model-value="patch(scope, rule, { fit: $event || undefined })" />
            </StudioField>
          </div>
          <div class="grid grid-cols-2 gap-[4px]">
            <StudioField label="Only from (s)">
              <StudioValue
                :model-value="rule.window?.from ?? 0"
                :min="0"
                :max="600"
                :step="0.01"
                :precision="2"
                :default-value="0"
                @update:model-value="patch(scope, rule, { window: { ...rule.window, from: $event > 0 ? $event : undefined } })"
              />
            </StudioField>
            <StudioField label="Until (s, 0 = end)">
              <StudioValue
                :model-value="rule.window?.to ?? 0"
                :min="0"
                :max="600"
                :step="0.01"
                :precision="2"
                :default-value="0"
                @update:model-value="patch(scope, rule, { window: { ...rule.window, to: $event > 0 ? $event : undefined } })"
              />
            </StudioField>
          </div>
          <div class="flex items-center gap-[4px]">
            <span class="flex-1 text-[var(--s-dim)]">{{ (rule.alternates?.length ?? 0) + 1 }} sound{{ rule.alternates?.length ? "s" : "" }} (round-robin)</span>
            <label class="flex h-[var(--s-ctl)] cursor-default items-center bg-[var(--s-tile)] px-[6px] shadow-[inset_0_0_0_1px_var(--s-edge)] hover:bg-[var(--s-inset-hover)]">
              Add alternate…
              <input type="file" class="hidden" accept="audio/*" @change="upload(scope, rule, $event, true)" />
            </label>
            <StudioButton v-if="rule.alternates?.length" variant="ghost" square title="Clear alternates" aria-label="Clear alternates" @click="patch(scope, rule, { alternates: undefined })">
              <StudioIcon name="close" />
            </StudioButton>
          </div>
          <EditorAudioEffectsField
            :model-value="rule.effects as AudioEffect[] | undefined"
            :layers="layers"
            :owner-id="ruleLayerId(rule.id)"
            :tracks="tracks"
            @update:model-value="patch(scope, rule, { effects: $event })"
          />
        </div>
      </div>
    </template>
  </EditorInspectorSection>
</template>
