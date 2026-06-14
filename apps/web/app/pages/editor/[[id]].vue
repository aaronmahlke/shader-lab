<script setup lang="ts">
const route = useRoute();

await navigateTo({
  path: route.params.id ? `/shader/${route.params.id}` : "/shader",
  query: route.query,
}, { replace: true });
</script>

<template>
  <div />
</template>
