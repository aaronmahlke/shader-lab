<script setup lang="ts">
import { createComposition, type CompositionConfig } from "@shader-lab/core";

type Props = {
  config: CompositionConfig;
  autoplay?: boolean;
};

const { config, autoplay = true } = defineProps<Props>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
let composition: ReturnType<typeof createComposition> | null = null;

onMounted(() => {
  if (!canvasRef.value) return;
  composition = createComposition(canvasRef.value, config);
  if (autoplay) composition.play();
});

onUnmounted(() => {
  composition?.destroy();
});

watch(() => config, (newConfig) => {
  composition?.updateConfig(newConfig);
}, { deep: true });

defineExpose({
  play: () => composition?.play(),
  pause: () => composition?.pause(),
});
</script>

<template>
  <canvas ref="canvasRef" class="size-full" />
</template>
