<script setup lang="ts">
const sel = ref("intro");
</script>

<template>
  <KitchenPage title="List row" description="19px rows for the project panel and lists. Icon, name, trailing meta. Selected rows are bright cyan with black text.">
    <KitchenSection align="start">
      <div class="w-[280px] rounded-[var(--s-r)] bg-[var(--s-tile)] py-[4px] shadow-[inset_0_0_0_1px_#ffffff0d]">
        <StudioListRow :selected="sel === 'intro'" @click="sel = 'intro'"><template #icon><d-icon-layers /></template>01 Intro<template #meta>comp</template></StudioListRow>
        <StudioListRow :selected="sel === 'deploy'" @click="sel = 'deploy'"><template #icon><d-icon-layers /></template>02 Deploy<template #meta>comp</template></StudioListRow>
        <StudioListRow :selected="sel === 'card'" @click="sel = 'card'"><template #icon><d-icon-code /></template>DeployCard<template #meta>vue</template></StudioListRow>
      </div>
    </KitchenSection>
    <KitchenSection title="Nested" description="12px indent per level." align="start">
      <div class="w-[280px] rounded-[var(--s-r)] bg-[var(--s-tile)] py-[4px] shadow-[inset_0_0_0_1px_#ffffff0d]">
        <StudioListRow><template #icon><d-icon-folder /></template>assets</StudioListRow>
        <StudioListRow :depth="1" :selected="sel === 'logo'" @click="sel = 'logo'"><template #icon><d-icon-image /></template>logo.svg<template #meta>svg</template></StudioListRow>
        <StudioListRow :depth="1" :selected="sel === 'track'" @click="sel = 'track'"><template #icon><d-icon-waveform-lines /></template>track.wav<template #meta>wav</template></StudioListRow>
      </div>
    </KitchenSection>
    <KitchenSection title="Selected" description="Bright cyan highlight with black text (Live's selection color #b9dce9)." align="start">
      <div class="w-[280px] bg-[var(--s-tile)] py-[4px]">
        <StudioListRow><template #icon><d-icon-sliders /></template>Instruments</StudioListRow>
        <StudioListRow selected><template #icon><d-icon-waveform-lines /></template>Audio Effects</StudioListRow>
        <StudioListRow><template #icon><d-icon-sliders /></template>MIDI Effects</StudioListRow>
      </div>
    </KitchenSection>
  </KitchenPage>
</template>
