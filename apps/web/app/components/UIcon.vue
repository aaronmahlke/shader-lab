<script lang="ts">
// Shim for Nuxt UI's <UIcon>, used by the demos in components/stage/ that were
// ported from evlog. Renders fully offline: the lucide collection ships in the
// bundle and is registered once at module scope, so the DOM-capture pipeline
// never depends on a network fetch at render time.
import type { IconifyJSON } from "@iconify/vue";
import { Icon, addCollection } from "@iconify/vue";
import lucideIcons from "@iconify-json/lucide/icons.json";

addCollection(lucideIcons as IconifyJSON);
</script>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  /** Nuxt UI icon name, e.g. "i-lucide-play". Only lucide is bundled. */
  name: string;
}>();

// "i-lucide-play" -> "lucide:play"; class/style fall through to the svg.
const icon = computed(() => props.name.replace(/^i-lucide-/, "lucide:"));
</script>

<template>
  <Icon :icon="icon" />
</template>
