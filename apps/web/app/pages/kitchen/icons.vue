<script setup lang="ts">
import { STUDIO_ICONS, type StudioIconName } from "~/utils/studio-icons";
const names = Object.keys(STUDIO_ICONS) as StudioIconName[];
</script>

<template>
  <KitchenPage title="Icons" description="Our own set, drawn for this UI: 12×12 grid, 1px strokes on whole pixels (crisp, Live-like), square line ends, filled glyphs for transport and triangles. <StudioIcon name=&quot;stopwatch&quot; />">
    <KitchenSection align="start">
      <div class="grid w-full grid-cols-6 gap-[6px]">
        <div v-for="name in names" :key="name" class="flex flex-col items-center gap-[8px] bg-[var(--s-inset)] py-[12px] shadow-[inset_0_0_0_1px_var(--s-edge)]">
          <StudioIcon :name="name" />
          <span class="text-[var(--s-dim)]">{{ name }}</span>
        </div>
      </div>
    </KitchenSection>
    <KitchenSection title="2× (check the pixel grid)" align="start">
      <div class="grid w-full grid-cols-8 gap-[6px]">
        <div v-for="name in names" :key="name" class="flex items-center justify-center bg-[var(--s-inset)] py-[10px] shadow-[inset_0_0_0_1px_var(--s-edge)]">
          <StudioIcon :name="name" class="!h-[24px] !w-[24px]" />
        </div>
      </div>
    </KitchenSection>
    <KitchenSection title="In controls">
      <StudioButton square aria-label="Animate"><StudioIcon name="stopwatch" /></StudioButton>
      <StudioButton square aria-label="Previous key"><StudioIcon name="key-prev" /></StudioButton>
      <StudioButton square aria-label="Key"><StudioIcon name="key-filled" /></StudioButton>
      <StudioButton square aria-label="Next key"><StudioIcon name="key-next" /></StudioButton>
      <StudioButton square aria-label="Snap" active><StudioIcon name="magnet" /></StudioButton>
      <StudioButton variant="ghost" square aria-label="Visible"><StudioIcon name="eye" /></StudioButton>
      <StudioButton variant="ghost" square aria-label="Lock"><StudioIcon name="unlock" /></StudioButton>
      <StudioButton><StudioIcon name="play" /> Preview</StudioButton>
    </KitchenSection>
  </KitchenPage>
</template>
