<script setup lang="ts">
/** One kitchen page: title, description, examples, previous / next. */
const { title, description } = defineProps<{ title: string; description?: string }>();
const { previous, next } = useKitchen();
useHead({ title: () => `${title} · Studio kitchen` });
</script>

<template>
  <article class="mx-auto flex w-full max-w-[760px] flex-col gap-[24px] px-[24px] py-[28px]">
    <header class="flex flex-col gap-[8px]">
      <h1 class="text-[20px] font-semibold text-[var(--s-bright)]">{{ title }}</h1>
      <p v-if="description" class="leading-[1.5] text-[var(--s-dim)]">{{ description }}</p>
    </header>
    <slot />
    <nav class="mt-[12px] grid grid-cols-2 gap-[var(--s-gap)]">
      <NuxtLink v-if="previous" :to="`/kitchen/${previous.slug}`" class="flex flex-col gap-[4px] rounded-[var(--s-r)] bg-[var(--s-tile)] p-[10px] hover:bg-[var(--s-hover)]">
        <span class="text-[var(--s-dim)]">Previous</span><span class="text-[var(--s-bright)]">{{ previous.title }}</span>
      </NuxtLink>
      <NuxtLink v-if="next" :to="`/kitchen/${next.slug}`" class="col-start-2 flex flex-col gap-[4px] rounded-[var(--s-r)] bg-[var(--s-tile)] p-[10px] text-right hover:bg-[var(--s-hover)]">
        <span class="text-[var(--s-dim)]">Next</span><span class="text-[var(--s-bright)]">{{ next.title }}</span>
      </NuxtLink>
    </nav>
  </article>
</template>
