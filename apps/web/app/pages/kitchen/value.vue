<script setup lang="ts">
const scale = ref(100);
const opacity = ref(100);
const blur = ref(4);
const rot = ref(0);
const x = ref(0.12);
const y = ref(-0.04);
</script>

<template>
  <KitchenPage title="Value box" description="The main number control. Drag up/down or left/right to change, hold Shift for fine steps, click to type, double-click to reset, arrow keys step when focused. With min and max it shows a teal fill bar (a slider inside the box).">
    <KitchenSection>
      <div class="w-[160px]"><StudioValue v-model="opacity" :min="0" :max="100" :step="1" :precision="0" unit="%" :default-value="100" /></div>
    </KitchenSection>

    <KitchenSection title="With range" description="min + max → fill bar.">
      <div class="grid w-full grid-cols-3 gap-[6px]">
        <StudioField label="Scale"><StudioValue v-model="scale" :min="0" :max="400" :step="1" :precision="0" unit="%" :default-value="100" /></StudioField>
        <StudioField label="Opacity"><StudioValue v-model="opacity" :min="0" :max="100" :step="1" :precision="0" unit="%" :default-value="100" /></StudioField>
        <StudioField label="Blur"><StudioValue v-model="blur" :min="0" :max="20" :step="0.1" :precision="1" :default-value="0" /></StudioField>
      </div>
    </KitchenSection>

    <KitchenSection title="Unbounded" description="No range → no fill, `step` per pixel.">
      <div class="w-[120px]"><StudioField label="Rotation"><StudioValue v-model="rot" :step="1" :precision="0" unit="°" :default-value="0" /></StudioField></div>
    </KitchenSection>

    <KitchenSection title="With inner label" description="X / Y pairs.">
      <div class="grid w-[240px] grid-cols-2 gap-[4px]">
        <StudioValue v-model="x" label="X" :default-value="0" />
        <StudioValue v-model="y" label="Y" :default-value="0" />
      </div>
    </KitchenSection>

    <KitchenSection title="Left aligned" description="In rows with a label on the left.">
      <div class="flex w-[300px] flex-col gap-[3px]">
        <StudioField label="Opacity" inline><StudioValue v-model="opacity" :min="0" :max="100" :step="1" :precision="0" unit="%" align="left" /></StudioField>
        <StudioField label="Position X" inline><StudioValue v-model="x" align="left" /></StudioField>
      </div>
    </KitchenSection>

    <KitchenSection title="States" description="Hover lightens. Focused (clicked, or Tab) gets a light-grey outline, like Live. Typing shows the same outline.">
      <div class="grid w-[300px] grid-cols-2 gap-[6px]">
        <StudioValue v-model="opacity" :min="0" :max="100" :step="1" :precision="0" unit="%" />
        <StudioValue v-model="rot" :step="1" :precision="0" unit="°" />
      </div>
    </KitchenSection>
  </KitchenPage>
</template>
