<script setup lang="ts">
const solo = ref(false);
const snap = ref(true);
</script>

<template>
  <KitchenPage title="Button" description="Three looks: inset (a dark field inside a tile, the default), tile (a grey box sitting on the dark frame, for the top bar), ghost (no background until hover). Active = the on state in orange.">
    <KitchenSection>
      <StudioButton>Fit</StudioButton>
      <StudioButton :active="solo" @click="solo = !solo">S</StudioButton>
      <StudioButton active>Export</StudioButton>
    </KitchenSection>

    <KitchenSection title="Inset" description="Controls inside tiles: inspector, timeline headers.">
      <StudioButton>Fit</StudioButton>
      <StudioButton :active="snap" @click="snap = !snap"><d-icon-magnet /> Snap</StudioButton>
      <StudioButton active>Export</StudioButton>
      <StudioButton disabled>Disabled</StudioButton>
    </KitchenSection>

    <KitchenSection title="Tile" description="Grey boxes directly on the dark frame: top bar, tab strip." on="frame">
      <StudioButton variant="tile" square aria-label="Back"><d-icon-arrow-left /></StudioButton>
      <StudioButton variant="tile">Atlasflow launch</StudioButton>
      <StudioButton variant="tile" aria-label="Preview"><d-icon-play-progress /></StudioButton>
      <StudioButton variant="tile" active>Export</StudioButton>
    </KitchenSection>

    <KitchenSection title="Ghost" description="Row actions that only show their background on hover.">
      <StudioButton variant="ghost" square aria-label="Visible"><d-icon-eye /></StudioButton>
      <StudioButton variant="ghost" square aria-label="Lock"><d-icon-lock-open /></StudioButton>
      <StudioButton variant="ghost" square aria-label="Delete"><d-icon-trash /></StudioButton>
      <StudioButton variant="ghost">Reset</StudioButton>
    </KitchenSection>

    <KitchenSection title="Icon only" description="Square, needs an aria-label.">
      <StudioButton square aria-label="Add"><d-icon-plus /></StudioButton>
      <StudioButton variant="tile" square aria-label="Add"><d-icon-plus /></StudioButton>
      <StudioButton variant="ghost" square aria-label="More"><d-icon-dots /></StudioButton>
    </KitchenSection>

    <KitchenSection title="Sizes" description="md 16px (default), sm 14px for dense rows.">
      <StudioButton>Medium</StudioButton>
      <StudioButton size="sm">Small</StudioButton>
      <StudioButton size="sm" active>S</StudioButton>
      <StudioButton size="sm" square aria-label="Add"><d-icon-plus /></StudioButton>
    </KitchenSection>
  </KitchenPage>
</template>
