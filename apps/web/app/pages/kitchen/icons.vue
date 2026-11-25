<script setup lang="ts">
import { DIconPlus, DIconXmark, DIconArrowLeft, DIconMagnifier, DIconMagnet, DIconPlayProgress, DIconEye, DIconEyeSlash, DIconLock, DIconLockOpen, DIconTrash, DIconDots, DIconLayers, DIconCode, DIconImage, DIconWaveformLines, DIconFilm, DIconFolder, DIconText, DIconCursorDefault, DIconLink, DIconSliders, DIconGear, DIconUndo, DIconRedo, DIconCopy, DIconScissors, DIconTarget } from "#components";
const used = [
  ["plus", DIconPlus],
  ["xmark", DIconXmark],
  ["arrow-left", DIconArrowLeft],
  ["magnifier", DIconMagnifier],
  ["magnet", DIconMagnet],
  ["play-progress", DIconPlayProgress],
  ["eye", DIconEye],
  ["eye-slash", DIconEyeSlash],
  ["lock", DIconLock],
  ["lock-open", DIconLockOpen],
  ["trash", DIconTrash],
  ["dots", DIconDots],
  ["layers", DIconLayers],
  ["code", DIconCode],
  ["image", DIconImage],
  ["waveform-lines", DIconWaveformLines],
  ["film", DIconFilm],
  ["folder", DIconFolder],
  ["text", DIconText],
  ["cursor-default", DIconCursorDefault],
  ["link", DIconLink],
  ["sliders", DIconSliders],
  ["gear", DIconGear],
  ["undo", DIconUndo],
  ["redo", DIconRedo],
  ["copy", DIconCopy],
  ["scissors", DIconScissors],
  ["target", DIconTarget],
] as const;
</script>

<template>
  <KitchenPage title="Icons" description="Thin outline icons from Dokedu UI's Nucleo set (d-icon-*), shown at 12px in controls. No Unicode symbols.">
    <KitchenSection align="start">
      <div class="grid w-full grid-cols-6 gap-[6px]">
        <div v-for="[name, icon] in used" :key="name" class="flex flex-col items-center gap-[6px] rounded-[var(--s-r-ctl)] bg-[var(--s-inset)] py-[10px] shadow-[inset_0_0_0_1px_var(--s-edge)]">
          <component :is="icon" class="size-[14px]" />
          <span class="text-[var(--s-dim)]">{{ name }}</span>
        </div>
      </div>
    </KitchenSection>
    <KitchenSection title="In controls" description="12px inside 16px buttons.">
      <StudioButton square aria-label="Add"><d-icon-plus /></StudioButton>
      <StudioButton square aria-label="Snap"><d-icon-magnet /></StudioButton>
      <StudioButton variant="ghost" square aria-label="Visible"><d-icon-eye /></StudioButton>
      <StudioButton variant="ghost" square aria-label="Lock"><d-icon-lock-open /></StudioButton>
      <StudioButton><d-icon-scissors /> Split</StudioButton>
    </KitchenSection>
  </KitchenPage>
</template>
