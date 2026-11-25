<script setup lang="ts">
const tab = ref("intro");
const tabs = ref([
  { id: "intro", label: "01 Intro" },
  { id: "deploy", label: "02 Deploy" },
  { id: "logo", label: "03 Logo" },
]);
const tab2 = ref("a");
</script>

<template>
  <KitchenPage title="Tabs" description="Comp tabs: grey boxes on the dark frame. Active is raised. × or middle-click closes, + adds.">
    <KitchenSection on="frame">
      <StudioTabs
        v-model="tab"
        :tabs="tabs"
        closable
        @close="(id) => (tabs = tabs.filter((t) => t.id !== id))"
        @add="tabs.push({ id: `c${tabs.length}`, label: `Comp ${tabs.length + 1}` })"
      />
    </KitchenSection>
    <KitchenSection title="Not closable" on="frame">
      <StudioTabs v-model="tab2" :tabs="[{ id: 'a', label: 'Layers' }, { id: 'b', label: 'Graph' }]" />
    </KitchenSection>
  </KitchenPage>
</template>
