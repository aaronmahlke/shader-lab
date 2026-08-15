<script setup lang="ts">
import { PlusIcon } from "@heroicons/vue/16/solid";
import type { CompositionMeta, ProjectWithCompositions } from "#shared/types/project";

const props = defineProps<{
  projectId: string;
  /** The composition currently open in the editor (comp id, not project id). */
  activeCompId: string | null;
}>();

const { data: project, refresh } = useFetch<ProjectWithCompositions>(
  () => `/api/projects/${props.projectId}`,
);

// useFetch caches by key across page remounts (every comp switch remounts the
// editor page); refetch on mount so tabs never show a stale list.
onMounted(() => {
  refresh();
});

const comps = computed<CompositionMeta[]>(() => project.value?.compositions ?? []);

const busy = ref(false);

function openComp(comp: CompositionMeta) {
  if (comp.id === props.activeCompId) return;
  navigateTo(`/shader/${comp.id}`);
}

async function createComp() {
  if (busy.value) return;
  busy.value = true;
  try {
    const created = await $fetch<CompositionMeta>(
      `/api/projects/${props.projectId}/compositions`,
      { method: "POST", body: { name: `Comp ${comps.value.length + 1}` } },
    );
    await refresh();
    await navigateTo(`/shader/${created.id}`);
  } catch (e) {
    console.error("Failed to create composition:", e);
  } finally {
    busy.value = false;
  }
}

async function duplicateComp(comp: CompositionMeta) {
  if (busy.value) return;
  busy.value = true;
  try {
    const created = await $fetch<CompositionMeta>(
      `/api/projects/${props.projectId}/compositions`,
      { method: "POST", body: { duplicateOf: comp.id } },
    );
    await navigateTo(`/shader/${created.id}`);
  } catch (e) {
    console.error("Failed to duplicate composition:", e);
  } finally {
    busy.value = false;
  }
}

async function deleteComp(comp: CompositionMeta) {
  try {
    await $fetch(`/api/projects/${props.projectId}/compositions/${comp.id}`, {
      method: "DELETE",
    });
  } catch (e) {
    // 400 = last remaining composition; the menu hides Delete then, but guard anyway.
    console.warn("Failed to delete composition:", e);
    return;
  }
  const next = comps.value.find((c) => c.id !== comp.id);
  await refresh();
  if (comp.id === props.activeCompId && next) {
    await navigateTo(`/shader/${next.id}`);
  }
}

async function renameComp(comp: CompositionMeta, name: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed === comp.name) return;
  try {
    await $fetch(`/api/projects/${props.projectId}/compositions/${comp.id}`, {
      method: "PATCH",
      body: { name: trimmed },
    });
  } catch (e) {
    console.error("Failed to rename composition:", e);
  }
  await refresh();
}

// --- Rename via context menu (same close-auto-focus pattern as the dashboard card) ---

type EditableText = { startEditing: () => void };

const renameQueuedId = ref<string | null>(null);
const editableRefs = new Map<string, EditableText>();

function setEditableRef(id: string, el: unknown) {
  if (el) editableRefs.set(id, el as EditableText);
  else editableRefs.delete(id);
}

function queueRename(id: string) {
  // Editing starts in onMenuCloseAutoFocus, after the menu has fully closed.
  // Starting earlier lets the menu's focus restore blur the input immediately.
  renameQueuedId.value = id;
}

function onMenuCloseAutoFocus(compId: string, event: Event) {
  event.preventDefault();
  if (renameQueuedId.value !== compId) return;
  renameQueuedId.value = null;
  editableRefs.get(compId)?.startEditing();
}

// The page creates comps too (pre-compose); let it refresh the tab list.
defineExpose({ refresh });
</script>

<template>
  <div
    v-if="comps.length > 0"
    class="flex h-9 max-w-full items-center gap-0.5 overflow-x-auto rounded-xl border border-neutral bg-layer-1/90 p-1 backdrop-blur"
  >
    <UiContextMenu
      v-for="comp in comps"
      :key="comp.id"
      @close-auto-focus="onMenuCloseAutoFocus(comp.id, $event)"
    >
      <button
        type="button"
        class="flex h-7 shrink-0 items-center rounded-lg px-2.5 text-copy-xs whitespace-nowrap transition-colors"
        :class="comp.id === activeCompId
          ? 'bg-control text-neutral-strong'
          : 'text-neutral-subtle hover:bg-control/50 hover:text-neutral-strong'"
        :title="comp.name"
        @click="openComp(comp)"
      >
        <UiEditableText
          :ref="(el) => setEditableRef(comp.id, el)"
          :model-value="comp.name"
          @update:model-value="renameComp(comp, $event)"
        />
      </button>
      <template #menu>
        <UiContextMenuItem @click="queueRename(comp.id)">Rename</UiContextMenuItem>
        <UiContextMenuItem @click="duplicateComp(comp)">Duplicate</UiContextMenuItem>
        <template v-if="comps.length > 1">
          <UiContextMenuSeparator />
          <UiContextMenuItem @click="deleteComp(comp)">Delete</UiContextMenuItem>
        </template>
      </template>
    </UiContextMenu>
    <button
      type="button"
      class="flex size-7 shrink-0 items-center justify-center rounded-lg text-neutral-subtle transition-colors hover:bg-control hover:text-neutral-strong"
      title="New composition"
      :disabled="busy"
      @click="createComp"
    >
      <PlusIcon class="size-4" />
    </button>
  </div>
</template>
