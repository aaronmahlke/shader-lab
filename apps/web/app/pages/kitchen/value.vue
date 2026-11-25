<script setup lang="ts">
const scale = ref(100);
const opacity = ref(100);
const blur = ref(4);
const rot = ref(0);
const x = ref(0.12);
const y = ref(-0.04);

// LFO demo: two sines driving the "live" outputs
const lfoA = ref(0);
const lfoB = ref(0);
const depthA = ref(30);
const depthB = ref(-15);
const blurMod = ref(6);
const opMod = ref(50);
const scaleMod = ref(150);
const blurDepth = ref(8);
let raf = 0;
onMounted(() => {
  const tick = (t: number) => {
    lfoA.value = Math.sin(t / 600);
    lfoB.value = (Math.sin(t / 230) + 1) / 2;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
});
onBeforeUnmount(() => cancelAnimationFrame(raf));
function setDepth(id: string, d: number) {
  if (id === "a") depthA.value = d;
  if (id === "b") depthB.value = d;
  if (id === "blur") blurDepth.value = d;
}
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
    <KitchenSection title="Modulated (LFO)" description="Each LFO draws a 2px strip in its color from the base to base + depth. The bright line is the actual value right now. ⌥-drag changes the first LFO's depth.">
      <div class="grid w-full grid-cols-2 gap-[6px]">
        <StudioField label="Opacity · 1 LFO">
          <StudioValue v-model="opMod" :min="0" :max="100" :step="1" :precision="0" unit="%" :mods="[{ id: 'a', color: '#5fd0a8', depth: depthA, live: lfoA }]" @update:depth="setDepth" />
        </StudioField>
        <StudioField label="Scale · 2 LFOs">
          <StudioValue v-model="scaleMod" :min="0" :max="400" :step="1" :precision="0" unit="%" :mods="[{ id: 'a', color: '#5fd0a8', depth: depthA * 3, live: lfoA }, { id: 'b', color: '#c98bff', depth: depthB * 4, live: lfoB }]" @update:depth="setDepth" />
        </StudioField>
        <StudioField label="Blur · unipolar (0..1)">
          <StudioValue v-model="blurMod" :min="0" :max="20" :step="0.1" :precision="1" :mods="[{ id: 'blur', color: '#ffb35c', depth: blurDepth, live: lfoB }]" @update:depth="setDepth" />
        </StudioField>
        <StudioField label="Range only (not playing)">
          <StudioValue v-model="opMod" :min="0" :max="100" :step="1" :precision="0" unit="%" :mods="[{ id: 'a', color: '#5fd0a8', depth: depthA }]" @update:depth="setDepth" />
        </StudioField>
      </div>
    </KitchenSection>
  </KitchenPage>
</template>
