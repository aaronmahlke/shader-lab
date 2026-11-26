<script setup lang="ts">
/** Audio layer → Synth: generate the sound from a JSON patch (presets to start from). */
import type { LayerInstance } from "@shader-lab/core";
import { isSynthSrc, parseSynth, SYNTH_PRESETS, synthSrc } from "~/utils/audio-synth";

const props = defineProps<{ layer: LayerInstance }>();
const history = useEditorHistory();

const src = computed(() => (typeof props.layer.values.src === "string" ? props.layer.values.src : ""));
const patch = computed(() => (isSynthSrc(src.value) ? parseSynth(src.value) : null));
const presetOptions = [
  // reka-ui Select items can't have an empty value: "none" is the placeholder.
  { value: "none", label: isSynthSrc(src.value) ? "Load preset…" : "Generate from preset…" },
  ...Object.keys(SYNTH_PRESETS).map((k) => ({ value: k, label: k })),
];

const draft = ref("");
const error = ref("");
watch(
  patch,
  (p) => {
    draft.value = p ? JSON.stringify(p, null, 2) : "";
    error.value = "";
  },
  { immediate: true },
);

function setSrc(next: string) {
  props.layer.values.src = next;
  // Fit the layer to a fresh one-shot (keeps longer layers as they are).
  const p = parseSynth(next);
  if (p && props.layer.timing && props.layer.timing.out - props.layer.timing.in < p.duration) {
    props.layer.timing = { ...props.layer.timing, out: props.layer.timing.in + p.duration };
  }
  history?.record();
}
function loadPreset(name: string) {
  const p = SYNTH_PRESETS[name];
  if (p) setSrc(synthSrc(p));
}
function applyDraft() {
  try {
    const p = JSON.parse(draft.value);
    if (!p || !Array.isArray(p.voices) || !(p.duration > 0)) throw new Error("needs duration > 0 and voices[]");
    error.value = "";
    setSrc(synthSrc(p));
  } catch (e) {
    error.value = String((e as Error).message ?? e);
  }
}
</script>

<template>
  <EditorInspectorSection title="Synth">
    <UiSelect model-value="none" :options="presetOptions" @update:model-value="$event !== 'none' && loadPreset($event as string)" />
    <template v-if="patch">
      <textarea
        v-model="draft"
        rows="10"
        spellcheck="false"
        class="resize-y bg-[var(--s-inset)] px-[6px] py-[4px] font-mono text-[11px] leading-[1.35] text-[var(--s-text)] shadow-[inset_0_0_0_1px_var(--s-edge)] outline-none focus:shadow-[inset_0_0_0_1px_var(--s-select)]"
        @keydown.stop
        @keydown.meta.enter.prevent="applyDraft"
        @blur="applyDraft"
      />
      <span v-if="error" class="text-[var(--s-danger,#e5484d)]">{{ error }}</span>
      <span v-else class="text-[var(--s-dim)] tabular-nums">{{ patch.voices.length }} voice{{ patch.voices.length === 1 ? "" : "s" }} · {{ patch.duration }} s · ⌘↩ to apply</span>
    </template>
  </EditorInspectorSection>
</template>
