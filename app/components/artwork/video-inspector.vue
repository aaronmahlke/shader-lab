<script setup lang="ts">
import type { ArtworkVideoLayer } from "#shared/types/artwork";
import { mediaScaleX, setUniformMediaScale } from "#shared/artwork/media-scale";

const { layer } = defineProps<{ layer: ArtworkVideoLayer }>();

const uniformScale = computed({
  get: () => mediaScaleX(layer),
  set: (v: number) => setUniformMediaScale(layer, v),
});

const borderRadius = computed({
  get: () => layer.borderRadius ?? 0,
  set: (v: number) => {
    layer.borderRadius = v;
  },
});

const loop = computed({
  get: () => layer.loop !== false,
  set: (v: boolean) => {
    layer.loop = v;
  },
});

const uploading = ref(false);

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  uploading.value = true;
  try {
    const form = new FormData();
    form.append("file", file);
    const { url } = await $fetch<{ url: string }>("/api/uploads/video", {
      method: "POST",
      body: form,
    });
    layer.src = url;
  } finally {
    uploading.value = false;
    input.value = "";
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <label class="flex flex-col gap-1">
      <span class="text-copy-sm text-tertiary">Video</span>
      <input
        type="file"
        accept="video/*"
        class="text-copy-sm text-secondary"
        :disabled="uploading"
        @change="onFileChange"
      />
    </label>
    <label class="flex items-center justify-between gap-2">
      <span class="text-copy-sm text-tertiary">Loop</span>
      <input
        v-model="loop"
        type="checkbox"
        class="size-4 rounded border-edge"
      >
    </label>
    <UiSliderField v-model="layer.x" label="X" :min="0" :max="1" :step="0.01" />
    <UiSliderField v-model="layer.y" label="Y" :min="0" :max="1" :step="0.01" />
    <UiSliderField v-model="uniformScale" label="Scale" :min="0.1" :max="3" :step="0.05" />
    <UiSliderField
      v-model="borderRadius"
      label="Corner radius"
      :min="0"
      :max="200"
      :step="1"
    />
    <UiSliderField v-model="layer.opacity" label="Opacity" :min="0" :max="1" :step="0.01" />
  </div>
</template>
