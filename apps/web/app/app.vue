<script setup lang="ts">
import { TooltipProvider } from "reka-ui";

useHead({
  htmlAttrs: { class: "dark" },
  bodyAttrs: { class: "bg-base-0 text-ui text-primary antialiased" },
});
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <NuxtPage />
  </TooltipProvider>
</template>
