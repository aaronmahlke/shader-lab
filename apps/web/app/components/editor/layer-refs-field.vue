<script setup lang="ts">
import { CheckIcon } from "@heroicons/vue/16/solid";
import { LAYER_TEMPLATES, type LayerInstance } from "@shader-lab/core";

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
  <div class="flex flex-col gap-1">
    <span class="text-copy-xs text-neutral-subtle">{{ label }}</span>
    <div class="flex max-h-48 flex-col overflow-y-auto rounded-lg bg-control/40 p-0.5">
      <p v-if="candidates.length === 0" class="px-2 py-1.5 text-copy-xs text-neutral-subtle">
        Add a layer to clone first.
      </p>
      <button
        v-for="layer in candidates"
        :key="layer.id"
        type="button"
        class="flex h-7 items-center gap-2 rounded-md px-2 text-left text-copy-sm transition-colors hover:bg-control"
        :class="model?.includes(layer.id) ? 'text-neutral-strong' : 'text-neutral-subtle'"
        @click="toggle(layer.id)"
      >
        <span
          class="flex size-3.5 shrink-0 items-center justify-center rounded-sm ring-1 ring-inset"
          :class="model?.includes(layer.id) ? 'bg-accent ring-accent' : 'ring-white/20'"
        >
          <CheckIcon v-if="model?.includes(layer.id)" class="size-3 text-white" />
        </span>
        <span class="min-w-0 flex-1 truncate">{{ layerName(layer) }}</span>
        <span v-if="model?.includes(layer.id)" class="font-mono text-copy-xs text-neutral-subtle">
          {{ model.indexOf(layer.id) + 1 }}
        </span>
      </button>
    </div>
  </div>
</template>
