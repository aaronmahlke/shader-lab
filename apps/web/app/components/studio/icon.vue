<script setup lang="ts">
/** <StudioIcon name="stopwatch" />: icons from utils/studio-icons.ts */
import { STUDIO_ICONS, type Glyph, type StudioIconName } from "~/utils/studio-icons";

const { name } = defineProps<{ name: StudioIconName }>();
const glyph = computed<Glyph>(() => STUDIO_ICONS[name]);
</script>


<template>
  <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true" class="shrink-0">
    <path
      :d="glyph.d"
      :fill="glyph.fill ? 'currentColor' : 'none'"
      :stroke="glyph.fill ? 'none' : 'currentColor'"
      stroke-width="1"
      stroke-linecap="square"
      stroke-linejoin="miter"
    />
    <path
      v-for="(e, i) in glyph.extra ?? []"
      :key="i"
      :d="e.d"
      :fill="e.fill ? 'currentColor' : 'none'"
      :stroke="e.fill ? 'none' : 'currentColor'"
      stroke-width="1"
      stroke-linecap="square"
    />
  </svg>
</template>
