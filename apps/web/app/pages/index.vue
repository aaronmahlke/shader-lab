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

// Desktop app: real folders (native pickers). Hosted: unchanged.
const desktop = useDesktop();

async function openFromDesktop(action: "openProject" | "newProject") {
  const compId = await desktop.value?.[action]();
  if (compId) await navigateTo(`/shader/${compId}`);
}

// Local mode (browser or desktop): import a zipped project — button or drop.
const { data: localInfo } = await useFetch<{ local: boolean }>("/api/local/info");
const isLocal = computed(() => !!localInfo.value?.local);
const zipInput = ref<HTMLInputElement | null>(null);
const importing = ref(false);
const importError = ref("");
const zipDragging = ref(false);

async function importZip(file: File | undefined) {
  if (!file || importing.value) return;
  if (!/\.zip$/i.test(file.name)) {
    importError.value = "Pick a .zip file.";
    return;
  }
  importing.value = true;
  importError.value = "";
  try {
    const body = new FormData();
    body.append("file", file);
    const res = await $fetch<{ firstCompositionId: string | null }>("/api/local/import", { method: "POST", body });
    await refreshProjects();
    if (res.firstCompositionId) await navigateTo(`/shader/${res.firstCompositionId}`);
  } catch (err) {
    importError.value = (err as { data?: { statusMessage?: string } }).data?.statusMessage ?? "Import failed.";
  } finally {
    importing.value = false;
  }
}

function hasFiles(e: DragEvent) {
  return !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
}
function onDragOver(e: DragEvent) {
  if (!isLocal.value || !hasFiles(e)) return;
  e.preventDefault();
  zipDragging.value = true;
}
function onDrop(e: DragEvent) {
  if (!isLocal.value || !hasFiles(e)) return;
  e.preventDefault();
  zipDragging.value = false;
  void importZip([...(e.dataTransfer?.files ?? [])].find((f) => /\.zip$/i.test(f.name)) ?? e.dataTransfer?.files[0]);
}
</script>

<template>
  <div
    class="relative min-h-dvh bg-base-0"
    @dragover="onDragOver"
    @dragleave.self="zipDragging = false"
    @drop="onDrop"
  >
    <div
      v-if="zipDragging || importing"
      class="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/60 text-copy-sm text-primary"
    >
      {{ importing ? "Importing project…" : "Drop a project .zip to import it" }}
    </div>
    <input
      ref="zipInput"
      type="file"
      accept=".zip,application/zip"
      class="hidden"
      @change="importZip(($event.target as HTMLInputElement).files?.[0]); ($event.target as HTMLInputElement).value = ''"
    />
    <header class="sticky top-0 z-10 flex items-center justify-between border-b border-edge bg-base-0/80 px-6 py-4 backdrop-blur-xl">
      <h1 class="text-copy-sm text-primary select-none">Shader Lab</h1>
      <div class="flex items-center gap-3">
        <span v-if="importError" class="text-copy-sm text-danger">{{ importError }}</span>
        <UiButton v-if="isLocal" variant="ghost" :disabled="importing" @click="zipInput?.click()">Import zip…</UiButton>
        <template v-if="desktop">
          <UiButton variant="ghost" @click="openFromDesktop('openProject')">Open…</UiButton>
          <UiButton variant="action" :icon-left="PlusIcon" @click="openFromDesktop('newProject')">
            New project
          </UiButton>
        </template>
        <template v-else>
          <DashboardNewMenu />
          <DashboardUserMenu />
        </template>
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
          <p class="text-copy-sm text-primary">{{ desktop ? "No projects yet" : "No compositions yet" }}</p>
          <p class="text-copy-sm text-tertiary">
            {{ desktop ? "Create a project folder or open an existing one." : "Create your first one to get started." }}
          </p>
        </div>
        <UiButton
          variant="action"
          :icon-left="PlusIcon"
          @click="desktop ? openFromDesktop('newProject') : navigateTo({ path: '/shader', query: { preset: 'blank' } })"
        >
          {{ desktop ? "New project" : "New composition" }}
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
