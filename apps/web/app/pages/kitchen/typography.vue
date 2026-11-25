<template>
  <KitchenPage title="Typography" description="One size everywhere: 12px, weight 500. Numbers use tabular figures (same font, even digit widths). Smaller only if there's really no room.">
    <KitchenSection>
      <div class="flex flex-col items-start gap-[8px]">
        <span class="text-[var(--s-bright)]">Bright: selected row, typing, emphasis</span>
        <span>Default: names, labels above controls</span>
        <span class="text-[var(--s-dim)]">Dim: meta, section labels, hints</span>
        <span class="text-[var(--s-off)]">Disabled</span>
      </div>
    </KitchenSection>
    <KitchenSection title="Numbers" description="tabular-nums keeps columns of values from jumping while they change.">
      <span class="s-num text-[var(--s-value)]">0.12, −0.04</span>
      <span class="s-num text-[var(--s-value)]">100 %</span>
      <span class="s-num">1.24 s</span>
      <span class="s-num">1920 × 1080</span>
    </KitchenSection>
  </KitchenPage>
</template>
