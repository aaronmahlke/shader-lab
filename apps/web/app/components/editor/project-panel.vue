<script setup lang="ts">
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  Square2StackIcon,
} from "@heroicons/vue/16/solid";
import type { CompositionMeta } from "#shared/types/project";
import { COMP_DRAG_TYPE, type CompDragPayload } from "#shared/editor/comp-drag";
import { removeOpenCompId } from "~/utils/open-comps";

const props = defineProps<{
  projectId: string;
  /** The composition currently open in the editor (comp id, not project id). */
  activeCompId: string | null;
}>();

// Shared with the comp tab strip and the inspector's Composition select; the
// page refreshes it on mount, so this panel only refreshes after mutations.
const { project, comps, refresh } = useProjectCompositions(() => props.projectId);

// --- Collapse (persisted; default OPEN) ---
// Read in onMounted so SSR and the first client render agree.

const COLLAPSED_KEY = "shader-lab:project-panel-collapsed";
const collapsed = ref(false);

onMounted(() => {
  try {
    collapsed.value = window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    // Privacy mode: stay open.
  }
});

function toggleCollapsed() {
  collapsed.value = !collapsed.value;
  try {
    window.localStorage.setItem(COLLAPSED_KEY, collapsed.value ? "1" : "0");
  } catch {
    // Not persisted, still toggles for this session.
  }
}

// --- Composition actions ---

const busy = ref(false);

function openComp(comp: CompositionMeta) {
  if (comp.id === props.activeCompId) return;
  // Navigation remounts the editor page; the tab strip adds the newly active
  // comp to the open set on mount, so no open-set write is needed here.
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
    await refresh();
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
  // Drop it from the open-tabs set so no dangling tab id survives a reload.
  removeOpenCompId(props.projectId, comp.id);
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

// --- Drag a comp into the timeline (AE-style: drop adds a composition layer) ---

function onCompDragStart(comp: CompositionMeta, e: DragEvent) {
  // While renaming, let the input keep drag-to-select-text behavior.
  if ((e.currentTarget as HTMLElement | null)?.querySelector("input")) {
    e.preventDefault();
    return;
  }
  if (!e.dataTransfer) return;
  e.dataTransfer.setData(
    COMP_DRAG_TYPE,
    JSON.stringify({ id: comp.id, name: comp.name } satisfies CompDragPayload),
  );
  e.dataTransfer.effectAllowed = "copy";
}

// --- Rename via context menu (same close-auto-focus pattern as the comp tabs) ---

type EditableText = { startEditing: () => void };

const renameQueuedId = ref<string | null>(null);
const editableRefs = new Map<string, EditableText>();

function setEditableRef(id: string, el: unknown) {
  if (el) editableRefs.set(id, el as EditableText);
  else editableRefs.delete(id);
}

function queueRename(id: string) {
  renameQueuedId.value = id;
}

function onMenuCloseAutoFocus(compId: string, event: Event) {
  event.preventDefault();
  if (renameQueuedId.value !== compId) return;
  renameQueuedId.value = null;
  editableRefs.get(compId)?.startEditing();
}
</script>

<template>
  <!-- Collapsed: a thin rail with just the expand toggle. -->
  <div
    v-if="collapsed"
    class="flex h-full w-7 flex-col items-center py-2"
  >
    <button
      type="button"
      class="flex size-6 items-center justify-center rounded-md text-neutral-subtle transition-colors hover:bg-control hover:text-neutral-strong"
      title="Expand project panel"
      @click="toggleCollapsed"
    >
      <ChevronRightIcon class="size-4" />
    </button>
  </div>

  <div v-else class="flex h-full w-[230px] flex-col">
    <!-- Header: project name + collapse toggle -->
    <div class="flex h-10 shrink-0 items-center gap-1 border-b border-neutral pr-1.5 pl-3">
      <span
        class="min-w-0 flex-1 truncate text-copy-xs text-neutral-subtle"
        :title="project?.name"
      >
        {{ project?.name ?? "Project" }}
      </span>
      <button
        type="button"
        class="flex size-6 shrink-0 items-center justify-center rounded-md text-neutral-subtle transition-colors hover:bg-control hover:text-neutral-strong"
        title="Collapse project panel"
        @click="toggleCollapsed"
      >
        <ChevronLeftIcon class="size-4" />
      </button>
    </div>

    <!-- Sections (assets will slot in below Compositions later) -->
    <div class="min-h-0 flex-1 overflow-y-auto">
      <section class="flex flex-col py-2">
        <div class="flex items-center gap-1 pr-1.5 pl-3 pb-1">
          <span class="flex-1 text-copy-2xs font-medium tracking-wide text-neutral-weak uppercase select-none">
            Compositions
          </span>
          <button
            type="button"
            class="flex size-6 shrink-0 items-center justify-center rounded-md text-neutral-subtle transition-colors hover:bg-control hover:text-neutral-strong"
            title="New composition"
            :disabled="busy"
            @click="createComp"
          >
            <PlusIcon class="size-4" />
          </button>
        </div>

        <UiContextMenu
          v-for="comp in comps"
          :key="comp.id"
          @close-auto-focus="onMenuCloseAutoFocus(comp.id, $event)"
        >
          <div
            class="mx-1.5 flex h-7 cursor-grab items-center gap-1.5 rounded-md px-1.5 text-copy-xs transition-colors"
            :class="comp.id === activeCompId
              ? 'bg-control text-neutral-strong'
              : 'text-neutral-subtle hover:bg-control/50 hover:text-neutral-strong'"
            :title="comp.name"
            draggable="true"
            @dragstart="onCompDragStart(comp, $event)"
            @click="openComp(comp)"
          >
            <Square2StackIcon class="size-3.5 shrink-0 text-neutral-weak" />
            <UiEditableText
              :ref="(el) => setEditableRef(comp.id, el)"
              fill
              :model-value="comp.name"
              @update:model-value="renameComp(comp, $event)"
            />
          </div>
          <template #menu>
            <UiContextMenuItem @click="openComp(comp)">Open</UiContextMenuItem>
            <UiContextMenuItem @click="queueRename(comp.id)">Rename</UiContextMenuItem>
            <UiContextMenuItem @click="duplicateComp(comp)">Duplicate</UiContextMenuItem>
            <template v-if="comps.length > 1">
              <UiContextMenuSeparator />
              <UiContextMenuItem @click="deleteComp(comp)">Delete</UiContextMenuItem>
            </template>
          </template>
        </UiContextMenu>
      </section>
    </div>
  </div>
</template>
