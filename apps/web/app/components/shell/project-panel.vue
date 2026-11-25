<script setup lang="ts">
import type { CompositionMeta } from "#shared/types/project";
import { COMP_DRAG_TYPE, type CompDragPayload } from "#shared/editor/comp-drag";
import { STAGE_COMPONENT_ENTRIES } from "~/utils/stage-components";

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

const row = "mx-1.5 flex h-7 items-center gap-2 rounded-md px-1.5 text-xs transition-colors";
</script>

<template>
  <div class="flex h-full w-60 flex-col">
    <div class="flex h-9 shrink-0 items-center pr-1.5 pl-3">
      <span class="flex-1 text-xs font-medium text-neutral-subtle select-none">Project</span>
      <d-tooltip content="New composition" side="bottom">
        <d-button variant="ghost" size="sm" aria-label="New composition" :disabled="busy" @click="create()">
          <template #leading><d-icon-plus /></template>
        </d-button>
      </d-tooltip>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto pb-2">
      <d-context-menu v-for="comp in comps" :key="comp.id">
        <d-context-menu-trigger>
          <div
            :class="[row, 'cursor-grab', comp.id === activeCompId
              ? 'bg-tint text-neutral-strong'
              : 'text-neutral-subtle hover:bg-tint-subtle hover:text-neutral-strong']"
            draggable="true"
            :title="`${comp.name} — drag into the timeline to nest, double-click to open`"
            @dragstart="onCompDragStart(comp, $event)"
            @dblclick.capture.stop="openComp(comp)"
          >
            <d-icon-layers class="size-3.5 shrink-0 text-accent" />
            <UiEditableText
              :ref="(el: unknown) => (el ? editors.set(comp.id, el as EditableText) : editors.delete(comp.id))"
              fill
              :model-value="comp.name"
              @update:model-value="rename(comp, $event)"
            />
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

      <div
        v-for="entry in STAGE_COMPONENT_ENTRIES"
        :key="entry.name"
        :class="[row, 'cursor-default text-neutral-subtle hover:bg-tint-subtle hover:text-neutral-strong']"
        :title="`${entry.label} — double-click to add`"
        @dblclick="emit('add-component', entry.name)"
      >
        <d-icon-code class="size-3.5 shrink-0 text-warn" />
        <span class="min-w-0 flex-1 truncate">{{ entry.label }}</span>
        <span class="text-xs text-neutral-weak">.vue</span>
      </div>
    </div>
  </div>
</template>
