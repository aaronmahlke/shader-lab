<script setup lang="ts">
/**
 * Object field (Unity-style reference slot): shows the picked layer / comp /
 * component with its icon. Click to search and pick, drag one onto it
 * (timeline layer rows, project panel comps / components), × to clear.
 */
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from "reka-ui";
import type { StudioIconName } from "~/utils/studio-icons";
import { COMP_DRAG_TYPE, readCompDragPayload } from "#shared/editor/comp-drag";
import { COMPONENT_DRAG_TYPE, REF_DROP_EVENT, refDrag, refDropTarget, type RefDragPayload } from "~/utils/ref-drag";

export type RefOption = { value: string; label: string; icon?: StudioIconName; meta?: string };

const {
  options,
  kind,
  label,
  placeholder = "None",
  clearable = true,
} = defineProps<{
  options: RefOption[];
  kind: RefDragPayload["kind"];
  label?: string;
  placeholder?: string;
  clearable?: boolean;
}>();

const model = defineModel<string>({ default: "" });

const current = computed(() => options.find((o) => o.value === model.value) ?? null);
const open = ref(false);
const query = ref("");
const active = ref(0);
const searchEl = ref<HTMLInputElement | null>(null);
const root = ref<HTMLElement | null>(null);

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
});
watch(filtered, () => (active.value = Math.max(0, filtered.value.findIndex((o) => o.value === model.value))));
watch(open, (o) => {
  if (!o) return;
  query.value = "";
  active.value = Math.max(0, options.findIndex((x) => x.value === model.value));
  nextTick(() => searchEl.value?.focus());
});

function pick(value: string) {
  model.value = value;
  open.value = false;
}

function onKey(e: KeyboardEvent) {
  if (e.key === "ArrowDown") active.value = Math.min(filtered.value.length - 1, active.value + 1);
  else if (e.key === "ArrowUp") active.value = Math.max(0, active.value - 1);
  else if (e.key === "Enter") {
    const o = filtered.value[active.value];
    if (o) pick(o.value);
  } else return;
  e.preventDefault();
}

// --- Drops -------------------------------------------------------------------

/** First dragged id that's a valid option here. */
function accept(payload: RefDragPayload | null): string | null {
  if (!payload || payload.kind !== kind) return null;
  return payload.ids.find((id) => options.some((o) => o.value === id)) ?? null;
}

/** Pointer drags (timeline layers): highlighted while hovering, picked on release. */
const pointerHover = computed(() => !!root.value && refDropTarget.value === root.value && !!accept(refDrag.value));
function onRefDrop(e: Event) {
  const id = accept((e as CustomEvent<RefDragPayload>).detail);
  if (id) model.value = id;
}
onMounted(() => root.value?.addEventListener(REF_DROP_EVENT, onRefDrop));
onBeforeUnmount(() => root.value?.removeEventListener(REF_DROP_EVENT, onRefDrop));

/** Native drags (project panel). */
const nativeHover = ref(false);
const nativeType = computed(() => (kind === "comp" ? COMP_DRAG_TYPE : kind === "component" ? COMPONENT_DRAG_TYPE : null));
function onDragOver(e: DragEvent) {
  if (!nativeType.value || ![...(e.dataTransfer?.types ?? [])].includes(nativeType.value)) return;
  e.preventDefault();
  e.stopPropagation();
  nativeHover.value = true;
}
function onDrop(e: DragEvent) {
  nativeHover.value = false;
  if (!nativeType.value) return;
  let id: string | null = null;
  if (kind === "comp") id = readCompDragPayload(e.dataTransfer)?.id ?? null;
  else id = e.dataTransfer?.getData(COMPONENT_DRAG_TYPE) || null;
  if (!id) return;
  e.preventDefault();
  e.stopPropagation();
  const ok = accept({ kind, ids: [id] } as RefDragPayload);
  if (ok) model.value = ok;
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-[3px]">
    <span v-if="label" class="truncate select-none">{{ label }}</span>
    <PopoverRoot v-model:open="open">
      <div
        ref="root"
        data-ref-drop
        class="flex h-[var(--s-ctl)] min-w-0 items-center bg-[var(--s-inset)] text-[var(--s-txt)] shadow-[inset_0_0_0_1px_var(--s-edge)]"
        :class="(pointerHover || nativeHover) && '!shadow-[inset_0_0_0_1px_var(--s-ring)] !bg-[var(--s-inset-hover)]'"
        @dragover="onDragOver"
        @dragleave="nativeHover = false"
        @drop="onDrop"
      >
        <PopoverTrigger
          class="flex h-full min-w-0 flex-1 cursor-default items-center gap-[5px] px-[5px] text-left outline-none select-none hover:bg-[var(--s-inset-hover)] focus-visible:shadow-[inset_0_0_0_1px_var(--s-ring)] data-[state=open]:shadow-[inset_0_0_0_1px_var(--s-ring)]"
        >
          <StudioIcon v-if="current?.icon" :name="current.icon" class="text-[var(--s-dim)]" />
          <span class="min-w-0 flex-1 truncate" :class="!current && 'text-[var(--s-dim)]'">
            {{ current?.label ?? placeholder }}
          </span>
          <StudioIcon name="search" class="text-[var(--s-dim)]" />
        </PopoverTrigger>
        <button
          v-if="clearable && current"
          type="button"
          class="flex h-full w-[16px] shrink-0 cursor-default items-center justify-center text-[var(--s-dim)] outline-none hover:text-[var(--s-txt)]"
          aria-label="Clear"
          title="Clear"
          @click="model = ''"
        >
          <StudioIcon name="close" />
        </button>
      </div>
      <PopoverPortal>
        <PopoverContent
          side="bottom"
          align="start"
          :side-offset="2"
          :collision-padding="8"
          data-ui="studio"
          class="z-[1000] flex max-h-[280px] w-[var(--reka-popover-trigger-width)] min-w-[200px] flex-col rounded-[var(--s-r-ctl)] bg-[var(--s-band)] p-[2px] shadow-[0_0_0_1px_var(--s-edge),0_6px_16px_#0008] outline-none"
          @open-auto-focus.prevent
        >
          <div class="flex h-[var(--s-ctl)] shrink-0 items-center gap-[5px] bg-[var(--s-inset)] px-[5px] shadow-[inset_0_0_0_1px_var(--s-edge)]">
            <StudioIcon name="search" class="text-[var(--s-dim)]" />
            <input
              ref="searchEl"
              v-model="query"
              class="min-w-0 flex-1 bg-transparent text-[var(--s-txt)] outline-none placeholder:text-[var(--s-dim)]"
              placeholder="Search…"
              spellcheck="false"
              @keydown="onKey"
            />
          </div>
          <div class="mt-[2px] min-h-0 overflow-y-auto">
            <div
              v-if="clearable"
              class="flex h-[var(--s-row)] cursor-default items-center rounded-[1px] px-[6px] text-[var(--s-dim)] select-none hover:bg-[var(--s-select)] hover:text-[var(--s-select-txt)]"
              @click="pick('')"
            >
              {{ placeholder }}
            </div>
            <div
              v-for="(opt, i) in filtered"
              :key="opt.value"
              class="flex h-[var(--s-row)] cursor-default items-center gap-[5px] rounded-[1px] px-[6px] select-none"
              :class="i === active
                ? 'bg-[var(--s-select)] text-[var(--s-select-txt)]'
                : opt.value === model ? 'text-[var(--s-accent)]' : 'text-[var(--s-txt)]'"
              @pointerenter="active = i"
              @click="pick(opt.value)"
            >
              <StudioIcon v-if="opt.icon" :name="opt.icon" />
              <span class="min-w-0 flex-1 truncate">{{ opt.label }}</span>
              <span v-if="opt.meta" class="shrink-0 opacity-60">{{ opt.meta }}</span>
            </div>
            <div v-if="!filtered.length" class="px-[6px] py-[4px] text-[var(--s-dim)] select-none">No matches</div>
          </div>
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>
  </div>
</template>
