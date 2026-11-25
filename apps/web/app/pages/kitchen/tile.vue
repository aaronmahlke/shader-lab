<template>
  <KitchenPage title="Tile" description="Panels are grey tiles on the dark frame with 6px gaps. Areas inside one tile are split by 2px frame lines (split='col' / 'row').">
    <KitchenSection on="frame" align="start">
      <div class="grid h-[200px] w-full grid-cols-[220px_1fr_160px] gap-[var(--s-gap)]">
        <StudioTile split="col" class="!grid-flow-row !grid-cols-[76px_1fr]">
          <div class="pt-[4px]">
            <StudioListRow selected>All</StudioListRow>
            <StudioListRow>Comps</StudioListRow>
            <StudioListRow>Assets</StudioListRow>
          </div>
          <div class="pt-[4px]">
            <StudioListRow><template #icon><d-icon-layers /></template>01 Intro</StudioListRow>
            <StudioListRow><template #icon><d-icon-layers /></template>02 Deploy</StudioListRow>
          </div>
        </StudioTile>
        <StudioTile class="grid place-items-center text-[var(--s-dim)]">Canvas</StudioTile>
        <StudioTile class="grid place-items-center text-[var(--s-dim)]">Inspector</StudioTile>
      </div>
    </KitchenSection>
    <KitchenSection title="Split rows" on="frame" align="start">
      <StudioTile split="row" class="h-[120px] w-[260px]">
        <div class="flex items-center px-[6px]"><StudioInput placeholder="Search"><template #leading><d-icon-magnifier /></template></StudioInput></div>
        <div class="grid place-items-center text-[var(--s-dim)]">Content</div>
      </StudioTile>
    </KitchenSection>
  </KitchenPage>
</template>
