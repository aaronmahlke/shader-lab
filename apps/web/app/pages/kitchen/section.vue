<script setup lang="ts">
const fx = ref(true);
const lfo = ref(false);
const open = ref(true);
const blur = ref(4);
const quality = ref("high");
const wave = ref("sine");
const rate = ref(0.5);
const depth = ref(0.62);
</script>

<template>
  <KitchenPage title="Section" description="Inspector sections look like Ableton devices: a header band with title and actions over the content. The LED turns the thing on and off (effects, LFOs). Can collapse.">
    <KitchenSection align="start">
      <div class="w-[260px] overflow-hidden rounded-[var(--s-r)]">
        <StudioSection title="Transform">
          <div class="grid grid-cols-2 gap-[5px_6px]">
            <StudioField label="Position X"><StudioValue :model-value="0.12" /></StudioField>
            <StudioField label="Position Y"><StudioValue :model-value="-0.04" /></StudioField>
          </div>
        </StudioSection>
      </div>
    </KitchenSection>

    <KitchenSection title="With LED + actions" align="start">
      <div class="w-[260px] overflow-hidden rounded-[var(--s-r)]">
        <StudioSection v-model:enabled="fx" title="Blur">
          <template #actions><StudioButton variant="ghost" size="sm" square aria-label="More"><d-icon-dots /></StudioButton></template>
          <div class="grid grid-cols-2 gap-[5px_6px]">
            <StudioField label="Amount"><StudioValue v-model="blur" :min="0" :max="20" :step="0.1" :precision="1" /></StudioField>
            <StudioField label="Quality"><StudioSegmented v-model="quality" :options="[{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }]" /></StudioField>
          </div>
        </StudioSection>
      </div>
    </KitchenSection>

    <KitchenSection title="Collapsible" align="start">
      <div class="w-[260px] overflow-hidden rounded-[var(--s-r)]">
        <StudioSection v-model:enabled="lfo" v-model:open="open" title="LFO 1" collapsible>
          <template #actions><StudioSegmented v-model="wave" size="sm" :options="[{ value: 'sine', label: 'Sine' }, { value: 'saw', label: 'Saw' }]" /></template>
          <div class="flex gap-[6px]">
            <StudioKnob v-model="rate" label="Rate" :min="0" :max="4" unit="Hz" />
            <StudioKnob v-model="depth" label="Depth" :min="0" :max="1" />
          </div>
        </StudioSection>
      </div>
    </KitchenSection>
  </KitchenPage>
</template>
