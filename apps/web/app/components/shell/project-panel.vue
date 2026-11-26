<script setup lang="ts">
import type { CompositionMeta } from "#shared/types/project";
import { COMP_DRAG_TYPE, type CompDragPayload } from "#shared/editor/comp-drag";
import { stageComponentEntries } from "~/utils/stage-components";
import { COMPONENT_DRAG_TYPE } from "~/utils/ref-drag";

/**
 * Everything in the project as one list: comps and components are both
 * "things you can put in a comp". Drag a comp into the timeline to nest it;
 * double-click a comp to open it in its own tab, a component to add it.
 */
const props = defineProps<{ projectId: string; activeCompId: string | null; rootCompId: string | null }>();
const emit = defineEmits<{ "add-component": [name: string] }>();

const { comps, busy, create, duplicate, remove, rename } = useCompActions(
  () => props.projectId,
  () => props.activeCompId,
);

function openComp(comp: CompositionMeta) {
  if (comp.id === props.activeCompId) return;
  navigateTo(`/shader/${comp.id}`);
}

function onCompDragStart(comp: CompositionMeta, e: DragEvent) {
  if ((e.currentTarget as HTMLElement | null)?.querySelector("input")) {
    e.preventDefault();
    return;
  }
  if (!e.dataTransfer) return;
  e.dataTransfer.setData(COMP_DRAG_TYPE, JSON.stringify({ id: comp.id, name: comp.name } satisfies CompDragPayload));
  e.dataTransfer.effectAllowed = "copy";
}

type EditableText = { startEditing: () => void };
const editors = new Map<string, EditableText>();
const renameQueued = ref<string | null>(null);
function onMenuCloseAutoFocus(id: string, e: Event) {
  e.preventDefault();
  if (renameQueued.value !== id) return;
  renameQueued.value = null;
  editors.get(id)?.startEditing();
}

</script>

<template>
  <div class="flex h-full w-[220px] flex-col">
    <div class="flex h-[var(--s-row)] shrink-0 items-center justify-between bg-[var(--s-band)] pr-[2px] pl-[6px]">
      <span>Project</span>
      <StudioButton variant="ghost" square aria-label="New composition" title="New composition" :disabled="busy" @click="create()">
        <StudioIcon name="plus" />
      </StudioButton>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto py-[3px]">
      <div class="px-[6px] pt-[4px] pb-[3px] text-[var(--s-dim)]">Compositions</div>
      <d-context-menu v-for="comp in comps" :key="comp.id">
        <d-context-menu-trigger>
          <div
            draggable="true"
            :title="`${comp.name}: drag into the timeline to nest, double-click to open`"
            @dragstart="onCompDragStart(comp, $event)"
            @dblclick.capture.stop="openComp(comp)"
          >
            <StudioListRow :selected="comp.id === activeCompId">
              <template #icon><StudioIcon name="comp" /></template>
              <UiEditableText
                :ref="(el: unknown) => (el ? editors.set(comp.id, el as EditableText) : editors.delete(comp.id))"
                fill
                :model-value="comp.name"
                class="!text-[length:var(--s-fs)]"
                @update:model-value="rename(comp, $event)"
              />
            </StudioListRow>
          </div>
        </d-context-menu-trigger>
        <d-context-menu-content @close-auto-focus="onMenuCloseAutoFocus(comp.id, $event)">
          <d-context-menu-item @select="openComp(comp)">Open</d-context-menu-item>
          <d-context-menu-item @select="renameQueued = comp.id">Rename</d-context-menu-item>
          <d-context-menu-item @select="duplicate(comp)">Duplicate</d-context-menu-item>
          <template v-if="comps.length > 1">
            <d-context-menu-separator />
            <d-context-menu-item tone="danger" @select="remove(comp)">Delete</d-context-menu-item>
          </template>
        </d-context-menu-content>
      </d-context-menu>

      <div class="px-[6px] pt-[10px] pb-[3px] text-[var(--s-dim)]">Components</div>
      <div
        v-for="entry in stageComponentEntries()"
        :key="entry.name"
        draggable="true"
        :title="`${entry.label}: double-click to add, drag onto a Component field`"
        @dragstart="$event.dataTransfer?.setData(COMPONENT_DRAG_TYPE, entry.name)"
        @dblclick="emit('add-component', entry.name)"
      >
        <StudioListRow>
          <template #icon><StudioIcon name="component" /></template>
          {{ entry.label }}
          <template #meta>{{ entry.project ? "project" : "app" }}</template>
        </StudioListRow>
      </div>
    </div>
  </div>
</template>
