<script setup lang="ts">
const mode = ref<"2d" | "3d">("2d");
const monitor = ref("auto");
const mb = ref(true);
const wave = ref("sine");
const quality = ref("high");
</script>

<template>
  <KitchenPage title="Segmented" description="Word toggles side by side, 2px apart. Exactly one is on (orange). For short choices: 2D | 3D, On | Off, wave shapes.">
    <KitchenSection>
      <StudioSegmented v-model="mode" :options="[{ value: '2d', label: '2D' }, { value: '3d', label: '3D' }]" />
    </KitchenSection>
    <KitchenSection title="Three options">
      <StudioSegmented v-model="monitor" :options="[{ value: 'in', label: 'In' }, { value: 'auto', label: 'Auto' }, { value: 'off', label: 'Off' }]" />
    </KitchenSection>
    <KitchenSection title="On / Off" description="A boolean setting.">
      <StudioSegmented v-model="mb" :options="[{ value: true, label: 'On' }, { value: false, label: 'Off' }]" />
    </KitchenSection>
    <KitchenSection title="Disabled option">
      <StudioSegmented v-model="wave" :options="[{ value: 'sine', label: 'Sine' }, { value: 'saw', label: 'Saw' }, { value: 'square', label: 'Square' }, { value: 'noise', label: 'Noise', disabled: true }]" />
    </KitchenSection>
  </KitchenPage>
</template>
