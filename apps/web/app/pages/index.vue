<script setup lang="ts">
import { PlusIcon } from "@heroicons/vue/16/solid";
import { SparklesIcon } from "@heroicons/vue/24/outline";
useHead({ title: "Shader Lab" });

const { data: shaders, refresh: refreshShaders } = await useFetch("/api/shaders");

async function deleteShader(id: string) {
  await $fetch(`/api/shaders/${id}`, { method: "DELETE" });
  await refreshShaders();
}

async function duplicateShader(id: string) {
  const source = (shaders.value as any[])?.find((s) => s.id === id);
  if (!source) return;
  await $fetch("/api/shaders", {
    method: "POST",
    body: { name: `${source.name} Copy`, data: source.data },
  });
  await refreshShaders();
}

const isEmpty = computed(() => !(shaders.value as any[])?.length);
</script>

<template>
  <div class="min-h-dvh bg-base-0">
    <header class="sticky top-0 z-10 flex items-center justify-between border-b border-edge bg-base-0/80 px-6 py-4 backdrop-blur-xl">
      <h1 class="text-copy-sm text-primary select-none">Shader Lab</h1>
      <div class="flex items-center gap-3">
        <DashboardNewMenu />
        <DashboardUserMenu />
      </div>
    </header>

    <main class="mx-auto max-w-5xl px-6 py-8">
      <div
        v-if="isEmpty"
        class="flex flex-col items-center justify-center gap-4 py-24"
      >
        <div class="flex size-12 items-center justify-center rounded-2xl border border-edge bg-base-1">
          <SparklesIcon class="size-5 text-tertiary" aria-hidden="true" />
        </div>
        <div class="flex flex-col items-center gap-1">
          <p class="text-copy-sm text-primary">No compositions yet</p>
          <p class="text-copy-sm text-tertiary">Create your first one to get started.</p>
        </div>
        <UiButton
          variant="action"
          :icon-left="PlusIcon"
          @click="navigateTo({ path: '/shader', query: { preset: 'blank' } })"
        >
          New composition
        </UiButton>
      </div>

      <div
        v-else
        class="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
      >
        <DashboardShaderCard
          v-for="item in (shaders as any[])"
          :key="item.id"
          :id="item.id"
          :name="item.name"
          :thumbnail-url="item.thumbnailUrl"
          :updated-at="item.updatedAt"
          :data="item.data"
          @delete="deleteShader(item.id)"
          @duplicate="duplicateShader(item.id)"
        />
      </div>
    </main>
  </div>
</template>
