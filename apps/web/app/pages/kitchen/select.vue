<script setup lang="ts">
const blend = ref("normal");
const fps = ref(60);
const parent = ref<string>();
const blendOptions = [
  { value: "normal", label: "Normal" },
  { value: "add", label: "Add" },
  { value: "screen", label: "Screen" },
  { value: "multiply", label: "Multiply" },
  { value: "overlay", label: "Overlay", disabled: true },
];
const fpsOptions = [24, 25, 30, 50, 60].map((v) => ({ value: v, label: `${v} fps` }));
const parentOptions = [
  { value: "headline", label: "Headline" },
  { value: "card", label: "Deploy card" },
];
</script>

<template>
  <KitchenPage title="Select" description="Dropdown: inset trigger with a solid triangle, flat grey menu, selected item in orange. Keyboard and focus from reka-ui.">
    <KitchenSection>
      <div class="w-[140px]"><StudioSelect v-model="blend" :options="blendOptions" /></div>
    </KitchenSection>
    <KitchenSection title="Placeholder" description="No value yet.">
      <div class="w-[140px]"><StudioSelect v-model="parent" :options="parentOptions" placeholder="None" /></div>
    </KitchenSection>
    <KitchenSection title="Tile" description="On the dark frame (top bar)." on="frame">
      <div class="w-[90px]"><StudioSelect v-model="fps" variant="tile" :options="fpsOptions" /></div>
    </KitchenSection>
    <KitchenSection title="Small">
      <div class="w-[100px]"><StudioSelect v-model="fps" size="sm" :options="fpsOptions" /></div>
    </KitchenSection>
  </KitchenPage>
</template>
