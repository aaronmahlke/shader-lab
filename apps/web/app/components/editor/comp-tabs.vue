<script setup lang="ts">
import { PlusIcon, XMarkIcon } from "@heroicons/vue/16/solid";
import type { CompositionMeta } from "#shared/types/project";
import { loadOpenCompIds, saveOpenCompIds } from "~/utils/open-comps";

const props = defineProps<{
  projectId: string;
  /** The composition currently open in the editor (comp id, not project id). */
  activeCompId: string | null;
  /** Name of the active comp, so its tab renders before the project fetch lands. */
  activeCompName?: string;
}>();

// Shared with the project panel and the inspector's Composition select; the
// page refreshes it on mount, tabs/panel refresh it after mutations.
const { comps, refresh } = useProjectCompositions(() => props.projectId);

// --- Open set (AE-style: tabs show OPEN comps, not all comps) ---
// Starts with just the active comp so SSR + first client render agree; the
// stored set merges in onMounted (localStorage is client-only).

const openIds = ref<string[]>(props.activeCompId ? [props.activeCompId] : []);

function persistOpenIds() {
  saveOpenCompIds(props.projectId, openIds.value);
}

onMounted(() => {
  const stored = loadOpenCompIds(props.projectId);
  const active = props.activeCompId;
  // Navigating to a comp (panel row, dashboard, nested-layer double-click…)
  // remounts the page, so "active is always in the set" lives right here.
  if (active && !stored.includes(active)) stored.push(active);
  openIds.value = stored;
  persistOpenIds();
});

// Prune comps that no longer exist (deleted elsewhere, e.g. project panel).
// Only once the project list is actually loaded — an empty list just means
// the fetch hasn't landed yet.
watch(comps, (list) => {
  if (list.length === 0) return;
  const valid = new Set(list.map((c) => c.id));
  const pruned = openIds.value.filter((id) => valid.has(id));
  if (pruned.length !== openIds.value.length) {
    openIds.value = pruned;
    persistOpenIds();
  }
});

/** Open tabs in stored order, resolved to comp metadata. */
const openTabs = computed<CompositionMeta[]>(() => {
  const byId = new Map(comps.value.map((c) => [c.id, c]));
  return openIds.value
    .map((id) => {
      const comp = byId.get(id);
      if (comp) return comp;
      // Project list not loaded yet: still render the active tab by name.
      if (id === props.activeCompId) {
        return { id, name: props.activeCompName ?? "Untitled", sortIndex: 0, thumbnailUrl: null, updatedAt: "" };
      }
      return null;
    })
    .filter((c): c is CompositionMeta => c !== null);
});

const busy = ref(false);

function openComp(comp: CompositionMeta) {
  if (comp.id === props.activeCompId) return;
  navigateTo(`/shader/${comp.id}`);
}

function closeTab(comp: CompositionMeta) {
  if (openIds.value.length <= 1) return;
  const index = openIds.value.indexOf(comp.id);
  const remaining = openIds.value.filter((id) => id !== comp.id);
  openIds.value = remaining;
  persistOpenIds();
  if (comp.id === props.activeCompId && remaining.length > 0) {
    // Nearest remaining tab: the one that took the closed tab's slot, else
    // the new last one.
    const next = remaining[Math.min(Math.max(index, 0), remaining.length - 1)]!;
    navigateTo(`/shader/${next}`);
  }
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
  const remaining = openIds.value.filter((id) => id !== comp.id);
  openIds.value = remaining;
  persistOpenIds();
  await refresh();
  if (comp.id === props.activeCompId) {
    const next = remaining[0] ?? comps.value.find((c) => c.id !== comp.id)?.id;
    if (next) await navigateTo(`/shader/${next}`);
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
    class="flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-neutral bg-layer-2 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
  >
    <UiContextMenu
      v-for="comp in openTabs"
      :key="comp.id"
      @close-auto-focus="onMenuCloseAutoFocus(comp.id, $event)"
    >
      <div
        role="tab"
        :aria-selected="comp.id === activeCompId"
        class="group flex h-6 shrink-0 cursor-default items-center gap-0.5 rounded-md pl-2.5 text-copy-xs whitespace-nowrap transition-colors"
        :class="[
          comp.id === activeCompId
            ? 'bg-control text-neutral-strong'
            : 'text-neutral-subtle hover:bg-control/50 hover:text-neutral-strong',
          openTabs.length > 1 ? 'pr-0.5' : 'pr-2.5',
        ]"
        :title="comp.name"
        @click="openComp(comp)"
        @pointerdown.middle.prevent="closeTab(comp)"
      >
        <UiEditableText
          :ref="(el) => setEditableRef(comp.id, el)"
          :model-value="comp.name"
          @update:model-value="renameComp(comp, $event)"
        />
        <!-- Browser-tab-style close: space is reserved, the icon fades in on
             hover (always visible on the active tab). Hidden entirely when
             it's the last open tab. -->
        <button
          v-if="openTabs.length > 1"
          type="button"
          class="flex size-5 items-center justify-center rounded transition-opacity hover:bg-white/10"
          :class="comp.id === activeCompId ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'"
          :title="`Close ${comp.name}`"
          @click.stop="closeTab(comp)"
        >
          <XMarkIcon class="size-3.5" />
        </button>
      </div>
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
      class="flex size-6 shrink-0 items-center justify-center rounded-md text-neutral-subtle transition-colors hover:bg-control hover:text-neutral-strong"
      title="New composition"
      :disabled="busy"
      @click="createComp"
    >
      <PlusIcon class="size-4" />
    </button>
  </div>
</template>
