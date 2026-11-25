<script setup lang="ts">
const search = ref("");
const name = ref("Deploy card");
</script>

<template>
  <KitchenPage title="Input" description="Text field: a dark inset. The edge turns orange while typing.">
    <KitchenSection>
      <div class="w-[260px]"><StudioInput v-model="search" placeholder="Search (⌘F)"><template #leading><d-icon-magnifier /></template></StudioInput></div>
    </KitchenSection>
    <KitchenSection title="Plain">
      <div class="w-[260px]"><StudioInput v-model="name" placeholder="Layer name" /></div>
    </KitchenSection>
    <KitchenSection title="Small">
      <div class="w-[200px]"><StudioInput size="sm" placeholder="Small" /></div>
    </KitchenSection>
  </KitchenPage>
</template>
