<script setup lang="ts">
import { PlusIcon } from "@heroicons/vue/16/solid";
import { SparklesIcon } from "@heroicons/vue/24/outline";
import type { ProjectWithCompositions, ShaderDoc } from "#shared/types/project";
useHead({ title: "Shader Lab" });

const { data: projects, refresh: refreshProjects } =
  await useFetch<ProjectWithCompositions[]>("/api/projects");

async function deleteProject(id: string) {
  await $fetch(`/api/projects/${id}`, { method: "DELETE" });
  await refreshProjects();
}

async function renameProject(id: string, name: string) {
  await $fetch(`/api/projects/${id}`, { method: "PATCH", body: { name } });
  await refreshProjects();
}

async function duplicateProject(project: ProjectWithCompositions) {
  const [first, ...rest] = project.compositions;
  if (!first) return;
  // The project list carries no data payloads; pull each comp through the
  // legacy adapter and rebuild the project (POST /api/shaders creates
  // project + first comp, the rest are appended).
  const firstDoc = await $fetch<ShaderDoc>(`/api/shaders/${first.id}`);
  const created = await $fetch<ShaderDoc>("/api/shaders", {
    method: "POST",
    body: { name: `${project.name} Copy`, data: firstDoc.data },
  });
  if (first.name !== "Comp 1") {
    await $fetch(`/api/projects/${created.projectId}/compositions/${created.id}`, {
      method: "PATCH",
      body: { name: first.name },
    });
  }
  for (const comp of rest) {
    const doc = await $fetch<ShaderDoc>(`/api/shaders/${comp.id}`);
    await $fetch(`/api/projects/${created.projectId}/compositions`, {
      method: "POST",
      body: { name: comp.name, data: doc.data },
    });
  }
  await refreshProjects();
}

const isEmpty = computed(() => !projects.value?.length);
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
          v-for="project in projects ?? []"
          :key="project.id"
          :id="project.compositions[0]?.id ?? project.id"
          :name="project.name"
          :thumbnail-url="project.compositions[0]?.thumbnailUrl ?? null"
          :updated-at="project.updatedAt"
          :comp-count="project.compositions.length"
          @delete="deleteProject(project.id)"
          @duplicate="duplicateProject(project)"
          @rename="renameProject(project.id, $event)"
        />
      </div>
    </main>
  </div>
</template>
