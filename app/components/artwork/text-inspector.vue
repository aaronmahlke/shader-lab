<script setup lang="ts">
import type { ArtworkTextLayer } from "#shared/types/artwork";
import { TEXT_FONT_FAMILIES } from "#shared/artwork/text-layer";
import { ArtworkTextEditKey } from "~/composables/use-artwork-text-edit";
import { getTextRuns, setLayerRuns } from "#shared/artwork/text-layer";

const { layer } = defineProps<{ layer: ArtworkTextLayer }>();

const textEdit = inject(ArtworkTextEditKey, null);

const canFormat = computed(() =>
  textEdit ? textEdit.canFormatLayer(layer.id) : false,
);

function onContentInput(value: string) {
  setLayerRuns(layer, [{ text: value }]);
}

const flatContent = computed({
  get: () => getTextRuns(layer).map((r) => r.text).join(""),
  set: onContentInput,
});

const fontWeight = computed({
  get: () => layer.fontWeight ?? 400,
  set: (v: number) => {
    layer.fontWeight = v;
  },
});

const lineHeight = computed({
  get: () => layer.lineHeight ?? 1.25,
  set: (v: number) => {
    layer.lineHeight = v;
  },
});

const letterSpacing = computed({
  get: () => layer.letterSpacing ?? 0,
  set: (v: number) => {
    layer.letterSpacing = v;
  },
});

function syncTextareaSelection(e: Event) {
  const el = e.target as HTMLTextAreaElement;
  textEdit?.updateSelection(el.selectionStart, el.selectionEnd);
}
</script>

<template>
  <div
    class="flex flex-col gap-3"
    data-keeps-text-edit
  >
    <p class="text-copy-sm text-tertiary">
      Double-click text on the canvas to edit inline. Select words, then use the toolbar for bold, italic, or color.
    </p>

    <ArtworkTextStyleToolbar
      v-if="textEdit"
      :layer="layer"
      :has-selection="canFormat"
      @bold="textEdit.toggleBold(layer)"
      @italic="textEdit.toggleItalic(layer)"
      @underline="textEdit.toggleUnderline(layer)"
      @color="canFormat ? textEdit.setSelectionColor($event, layer) : (layer.color = $event)"
    />

    <label class="flex flex-col gap-1">
      <span class="text-copy-sm text-tertiary">Content</span>
      <textarea
        v-model="flatContent"
        rows="3"
        class="rounded-lg border border-edge bg-surface-1 px-2 py-1.5 text-copy-sm text-primary"
        @select="syncTextareaSelection"
        @mouseup="syncTextareaSelection"
        @keyup="syncTextareaSelection"
      />
    </label>

    <label class="flex flex-col gap-1">
      <span class="text-copy-sm text-tertiary">Font</span>
      <select
        v-model="layer.fontFamily"
        class="h-8 rounded-lg border border-edge bg-surface-1 px-2 text-copy-sm text-primary"
      >
        <option
          v-for="f in TEXT_FONT_FAMILIES"
          :key="f.id"
          :value="f.id"
        >
          {{ f.label }}
        </option>
      </select>
    </label>

    <div class="flex gap-1">
      <UiButton
        v-for="align in (['left', 'center', 'right'] as const)"
        :key="align"
        variant="option"
        size="sm"
        :active="layer.align === align"
        class="flex-1 capitalize"
        @click="layer.align = align"
      >
        {{ align }}
      </UiButton>
    </div>

    <UiSliderField v-model="layer.fontSize" label="Size" :min="12" :max="120" :step="1" />
    <UiSliderField v-model="fontWeight" label="Weight" :min="300" :max="800" :step="100" />
    <UiSliderField
      v-model="lineHeight"
      label="Line height"
      :min="1"
      :max="2"
      :step="0.05"
    />
    <UiSliderField
      v-model="letterSpacing"
      label="Letter spacing"
      :min="-2"
      :max="20"
      :step="0.5"
    />
    <UiSliderField v-model="layer.x" label="X" :min="0" :max="1" :step="0.01" />
    <UiSliderField v-model="layer.y" label="Y" :min="0" :max="1" :step="0.01" />
    <UiSliderField v-model="layer.opacity" label="Opacity" :min="0" :max="1" :step="0.01" />
    <UiColorField v-model="layer.color" label="Fill color" />
  </div>
</template>
