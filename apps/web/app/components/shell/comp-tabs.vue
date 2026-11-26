<script setup lang="ts">
import type { CompositionMeta } from "#shared/types/project";
import { loadOpenCompIds, saveOpenCompIds } from "~/utils/open-comps";

/**
 * Open comps as tabs in the top bar. A tab is a top-level comp; drilling into
 * a nested comp stays in its tab (the trail root stays highlighted) and the
 * tab remembers where you were, so switching back returns there.
 */
const props = defineProps<{
  projectId: string;
  /** The comp the editor shows right now. */
  activeCompId: string | null;
  activeCompName?: string;
  /** Root of the drill-in trail (= activeCompId when not drilled in). */
  rootCompId: string | null;
}>();

const route = useRoute();
const { comps, busy, create, duplicate, remove, rename, refresh } = useCompActions(
  () => props.projectId,
  () => props.activeCompId,
);

const openIds = ref<string[]>(props.rootCompId ? [props.rootCompId] : []);
const LOC_KEY = computed(() => `shader-lab:tab-loc:${props.projectId}`);

function loadLocations(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LOC_KEY.value) ?? "{}");
  } catch {
    return {};
  }
}

onMounted(() => {
  const stored = loadOpenCompIds(props.projectId);
  const root = props.rootCompId;
  if (root && !stored.includes(root)) stored.push(root);
  openIds.value = stored;
  saveOpenCompIds(props.projectId, stored);
  // Remember this tab's location (including any drill-in trail).
  if (root) {
    const locs = loadLocations();
    locs[root] = route.fullPath;
    try {
      localStorage.setItem(LOC_KEY.value, JSON.stringify(locs));
    } catch {}
  }
});

watch(comps, (list) => {
  if (list.length === 0) return;
  const valid = new Set(list.map((c) => c.id));
  const pruned = openIds.value.filter((id) => valid.has(id));
  if (pruned.length !== openIds.value.length) {
    openIds.value = pruned;
    saveOpenCompIds(props.projectId, pruned);
  }
});

const tabs = computed<CompositionMeta[]>(() => {
  const byId = new Map(comps.value.map((c) => [c.id, c]));
  return openIds.value
    .map((id) => byId.get(id) ?? (id === props.rootCompId
      ? { id, name: props.activeCompName ?? "Untitled", sortIndex: 0, thumbnailUrl: null, updatedAt: "" }
      : null))
    .filter((c): c is CompositionMeta => c !== null);
});

function openTab(comp: CompositionMeta) {
  if (comp.id === props.rootCompId && comp.id === props.activeCompId) return;
  const saved = loadLocations()[comp.id];
  navigateTo(comp.id === props.rootCompId || !saved ? `/shader/${comp.id}` : saved);
}

function closeTab(comp: CompositionMeta) {
  if (openIds.value.length <= 1) return;
  const index = openIds.value.indexOf(comp.id);
  const remaining = openIds.value.filter((id) => id !== comp.id);
  openIds.value = remaining;
  saveOpenCompIds(props.projectId, remaining);
  if (comp.id === props.rootCompId && remaining.length > 0) {
    navigateTo(`/shader/${remaining[Math.min(Math.max(index, 0), remaining.length - 1)]}`);
  }
}

// Rename starts after the context menu has closed (its focus restore would blur the input).
type EditableText = { startEditing: () => void };
const editors = new Map<string, EditableText>();
const renameQueued = ref<string | null>(null);
function onMenuCloseAutoFocus(id: string, e: Event) {
  e.preventDefault();
  if (renameQueued.value !== id) return;
  renameQueued.value = null;
  editors.get(id)?.startEditing();
}

defineExpose({ refresh });
</script>

<template>
  <div class="flex min-w-0 items-center gap-[2px] overflow-x-auto [scrollbar-width:none]" role="tablist">
    <UiContextMenu v-for="comp in tabs" :key="comp.id" @close-auto-focus="onMenuCloseAutoFocus(comp.id, $event)">
        <div
          role="tab"
          :aria-selected="comp.id === rootCompId"
          class="group flex h-[18px] shrink-0 cursor-default items-center gap-[2px] pl-[7px] whitespace-nowrap select-none"
          :class="[
            comp.id === rootCompId
              ? 'bg-[var(--s-raise)] text-[var(--s-bright)]'
              : 'bg-[var(--s-tile)] text-[var(--s-dim)] hover:bg-[var(--s-hover)] hover:text-[var(--s-txt)]',
            tabs.length > 1 ? 'pr-[3px]' : 'pr-[7px]',
          ]"
          @click="openTab(comp)"
          @pointerdown.middle.prevent="closeTab(comp)"
        >
          <UiEditableText
            :ref="(el: unknown) => (el ? editors.set(comp.id, el as EditableText) : editors.delete(comp.id))"
            :model-value="comp.name"
            class="!text-[length:var(--s-fs)]"
            @update:model-value="rename(comp, $event)"
          />
          <button
            v-if="tabs.length > 1"
            type="button"
            class="ml-[2px] flex size-[12px] cursor-default items-center justify-center hover:bg-[var(--s-hover)]"
            :class="comp.id === rootCompId ? 'opacity-70 hover:opacity-100' : 'opacity-0 group-hover:opacity-70 hover:!opacity-100'"
            :aria-label="`Close ${comp.name}`"
            @click.stop="closeTab(comp)"
          >
            <StudioIcon name="close" class="!size-[8px]" />
          </button>
        </div>
      <template #menu>
        <UiContextMenuItem @click="renameQueued = comp.id">Rename</UiContextMenuItem>
        <UiContextMenuItem @click="duplicate(comp)">Duplicate</UiContextMenuItem>
        <template v-if="comps.length > 1">
          <UiContextMenuSeparator />
          <UiContextMenuItem tone="danger" @click="remove(comp)">Delete</UiContextMenuItem>
        </template>
      </template>
    </UiContextMenu>
    <StudioButton variant="tile" square class="!h-[18px] !w-[18px]" aria-label="New composition" title="New composition" :disabled="busy" @click="create()">
      <StudioIcon name="plus" />
    </StudioButton>
  </div>
</template>
