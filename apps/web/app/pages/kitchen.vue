<script setup lang="ts">
/** Studio kitchen shell: grouped sidebar + the component page. Public dev tool. */
const { groups, slug } = useKitchen();
const route = useRoute();
if (route.path === "/kitchen" || route.path === "/kitchen/") await navigateTo("/kitchen/colors", { replace: true });
</script>

<template>
  <div data-ui="studio" class="flex h-dvh overflow-hidden bg-[var(--s-frame)]">
    <nav class="flex w-[180px] shrink-0 flex-col overflow-y-auto p-[6px] pr-0">
      <div class="flex h-[30px] items-center gap-[8px] px-[8px] text-[var(--s-bright)]">
        <span class="flex h-[12px] w-[15px] gap-[2px]"><i class="flex-1 bg-[var(--s-accent)]" /><i class="flex-1 bg-[var(--s-accent)]" /></span>
        Studio kitchen
      </div>
      <template v-for="group in groups" :key="group.label">
        <div class="px-[8px] pt-[12px] pb-[4px] text-[var(--s-dim)]">{{ group.label }}</div>
        <NuxtLink
          v-for="page in group.pages"
          :key="page.slug"
          :to="`/kitchen/${page.slug}`"
          class="flex h-[var(--s-row)] cursor-default items-center rounded-[var(--s-r-ctl)] px-[8px]"
          :class="slug === page.slug ? 'bg-[var(--s-select)] text-[var(--s-select-txt)]' : 'text-[var(--s-txt)] hover:bg-[var(--s-inset-hover)]'"
        >{{ page.title }}</NuxtLink>
      </template>
    </nav>
    <main class="m-[6px] min-w-0 flex-1 overflow-y-auto rounded-[var(--s-r)] bg-[#232326]">
      <NuxtPage />
    </main>
  </div>
</template>
