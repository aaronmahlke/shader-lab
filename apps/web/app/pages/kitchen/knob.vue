<script setup lang="ts">
const rate = ref(0.5);
const depth = ref(0.62);
const phase = ref(0);
const pan = ref(-0.3);
</script>

<template>
  <KitchenPage title="Knob" description="For dense device panels (LFOs, effects). Drag up/down, Shift fine, double-click resets. Label above, value below. Prefer value boxes in the inspector; knobs where space is tight.">
    <KitchenSection>
      <StudioKnob v-model="rate" label="Rate" :min="0" :max="4" unit="Hz" :default-value="1" />
    </KitchenSection>
    <KitchenSection title="Group">
      <StudioKnob v-model="rate" label="Rate" :min="0" :max="4" unit="Hz" :default-value="1" />
      <StudioKnob v-model="depth" label="Depth" :min="0" :max="1" :default-value="0.5" />
      <StudioKnob v-model="phase" label="Phase" :min="0" :max="360" :step="1" :precision="0" unit="°" />
    </KitchenSection>
    <KitchenSection title="Bipolar" description="Fills from the middle (0).">
      <StudioKnob v-model="pan" label="Pan" :min="-1" :max="1" bipolar :default-value="0" />
    </KitchenSection>
  </KitchenPage>
</template>
