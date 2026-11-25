<script setup lang="ts">
const groups = [
  { title: "Surfaces", description: "Dark frame, grey tiles on it, dark insets for fields. Hierarchy comes from these steps, not shadows.", tokens: [
    ["frame", "--s-frame", "App background and the gaps between tiles"],
    ["tile", "--s-tile", "Panels"],
    ["band", "--s-band", "Section headers, menus"],
    ["raise", "--s-raise", "Active tab, raised cells"],
    ["inset", "--s-inset", "Fields, value boxes, timeline lanes"],
    ["edge", "--s-edge", "1px outline around insets"],
    ["hover", "--s-hover", "Hover on tile-colored controls"],
    ["inset-hover", "--s-inset-hover", "Hover on dark insets and rows"],
  ] },
  { title: "Text", description: "Light grey, not white. One size.", tokens: [
    ["bright", "--s-bright", "Selected, emphasis, typing"],
    ["txt", "--s-txt", "Default"],
    ["dim", "--s-dim", "Labels, meta"],
    ["off", "--s-off", "Disabled"],
  ] },
  { title: "Focus + selection", description: "Strong, like Live: selected things go bright cyan with black text; focused controls get a light-grey outline.", tokens: [
    ["select", "--s-select", "Selected rows, focused items (notes, keys)"],
    ["select-txt", "--s-select-txt", "Text on the selection"],
    ["ring", "--s-ring", "Focus outline on controls"],
  ] },
  { title: "Meaning", description: "Color only where it means something.", tokens: [
    ["accent", "--s-accent", "On: active toggles, main action, LEDs"],
    ["fill", "--s-fill", "Value bars"],
    ["value", "--s-value", "Numbers in rows"],
    ["danger", "--s-danger", "Destructive"],
  ] },
] as const;
</script>

<template>
  <KitchenPage title="Colors" description="Our own palette with Ableton's structure. Tokens live in studio.css, scoped to [data-ui=studio].">
    <KitchenSection v-for="g in groups" :key="g.title" :title="g.title" :description="g.description" align="start">
      <div class="grid w-full grid-cols-2 gap-[10px]">
        <div v-for="[name, v, use] in g.tokens" :key="name" class="flex items-center gap-[10px]">
          <span class="size-[28px] shrink-0 rounded-[var(--s-r-ctl)] shadow-[inset_0_0_0_1px_#ffffff14]" :style="{ background: `var(${v})` }" />
          <div class="flex min-w-0 flex-col gap-[3px]">
            <span class="text-[var(--s-bright)]">{{ name }} <span class="text-[var(--s-dim)]">{{ v }}</span></span>
            <span class="truncate text-[var(--s-dim)]">{{ use }}</span>
          </div>
        </div>
      </div>
    </KitchenSection>
  </KitchenPage>
</template>
