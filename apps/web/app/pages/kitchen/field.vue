<script setup lang="ts">
const opacity = ref(80);
const blend = ref("normal");
</script>

<template>
  <KitchenPage title="Field" description="A label with its control. Default: label above (Ableton devices, two per row). inline: label on the left (84px column).">
    <KitchenSection align="start">
      <div class="grid w-[260px] grid-cols-2 gap-[5px_6px]">
        <StudioField label="Opacity"><StudioValue v-model="opacity" :min="0" :max="100" :step="1" :precision="0" unit="%" /></StudioField>
        <StudioField label="Blend"><StudioSelect v-model="blend" :options="[{ value: 'normal', label: 'Normal' }, { value: 'add', label: 'Add' }]" /></StudioField>
      </div>
    </KitchenSection>
    <KitchenSection title="Inline" align="start">
      <div class="flex w-[280px] flex-col gap-[3px]">
        <StudioField label="Opacity" inline><StudioValue v-model="opacity" :min="0" :max="100" :step="1" :precision="0" unit="%" /></StudioField>
        <StudioField label="Blend" inline><StudioSelect v-model="blend" :options="[{ value: 'normal', label: 'Normal' }, { value: 'add', label: 'Add' }]" /></StudioField>
      </div>
    </KitchenSection>
  </KitchenPage>
</template>
