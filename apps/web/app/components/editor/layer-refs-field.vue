<script setup lang="ts">
import { CheckIcon } from "@heroicons/vue/16/solid";
import { LAYER_TEMPLATES, type LayerInstance } from "@shader-lab/core";
import { layerStudioIcon } from "~/utils/layer-icons";

/**
 * Pick layers from the current comp (cloner sources). Stores layer ids in
 * order of picking; cloners cycle through them in that order.
 */
const { label, ownerId } = defineProps<{
  label: string;
  /** The layer that owns this field (excluded from the list). */
  ownerId: string;
}>();

const model = defineModel<string[]>({ required: true });

const layers = inject<Ref<LayerInstance[]> | null>("editorLayers", null);
const history = useEditorHistory();

const EXCLUDED = new Set(["cloner", "effector", "camera", "light"]);

const candidates = computed(() =>
  (layers?.value ?? []).filter((l) => l.id !== ownerId && !EXCLUDED.has(l.type)),
);

function layerName(layer: LayerInstance): string {
  return layer.name ?? LAYER_TEMPLATES[layer.type]?.label ?? layer.type;
}

function toggle(id: string) {
  const current = model.value ?? [];
  model.value = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
  history?.record();
}
</script>

<template>
  <!-- Studio: checklist in a dark inset; picked layers show their order (cloners cycle in it). -->
  <div class="flex flex-col gap-[3px]">
    <span class="select-none">{{ label }}</span>
    <div class="flex max-h-48 flex-col overflow-y-auto bg-[var(--s-inset)] py-[2px] shadow-[inset_0_0_0_1px_var(--s-edge)]">
      <p v-if="candidates.length === 0" class="px-[6px] py-[4px] text-[var(--s-dim)]">
        Add a layer to clone first.
      </p>
      <button
        v-for="layer in candidates"
        :key="layer.id"
        type="button"
        class="flex h-[var(--s-row)] cursor-default items-center gap-[6px] px-[6px] text-left outline-none hover:bg-[var(--s-inset-hover)]"
        :class="model?.includes(layer.id) ? 'text-[var(--s-txt)]' : 'text-[var(--s-dim)]'"
        @click="toggle(layer.id)"
      >
        <span
          class="flex size-[11px] shrink-0 items-center justify-center"
          :class="model?.includes(layer.id) ? 'bg-[var(--s-accent)] text-[var(--s-on-txt)]' : 'shadow-[inset_0_0_0_1px_var(--s-edge)]'"
        >
          <CheckIcon v-if="model?.includes(layer.id)" class="size-[9px]" />
        </span>
        <StudioIcon v-if="layerStudioIcon(layer.type)" :name="layerStudioIcon(layer.type)!" />
        <span class="min-w-0 flex-1 truncate">{{ layerName(layer) }}</span>
        <span v-if="model?.includes(layer.id)" class="tabular-nums text-[var(--s-dim)]">
          {{ model.indexOf(layer.id) + 1 }}
        </span>
      </button>
    </div>
  </div>
</template>
