<script setup lang="ts">
/**
 * Comp settings → Props: which inner layer settings precomp layers using
 * this comp can set per instance (a card's image, a label, the pointer…).
 */
import { LAYER_TEMPLATES, type CompProp, type LayerInstance } from "@shader-lab/core";
import { propParamDefs } from "#shared/editor/prop-params";
import { layerStudioIcon } from "~/utils/layer-icons";

const props = defineProps<{ modelValue: CompProp[] }>();
const emit = defineEmits<{ "update:modelValue": [value: CompProp[]] }>();

const layers = inject<Ref<LayerInstance[]> | null>("editorLayers", null);

const layerOptions = computed(() =>
  (layers?.value ?? []).map((l) => ({
    value: l.id,
    label: l.name ?? LAYER_TEMPLATES[l.type]?.label ?? l.type,
    icon: layerStudioIcon(l.type),
  })),
);
const layerById = (id: string) => layers?.value.find((l) => l.id === id);
function paramOptions(layerId: string) {
  const l = layerById(layerId);
  return l ? propParamDefs(l).map((d) => ({ value: d.name, label: d.label })) : [];
}

function update(i: number, patch: Partial<CompProp>) {
  const next = props.modelValue.map((p, j) => (j === i ? { ...p, ...patch } : p));
  emit("update:modelValue", next);
}
function onLayer(i: number, layerId: string) {
  const first = paramOptions(layerId)[0]?.value ?? "";
  const p = props.modelValue[i]!;
  const l = layerById(layerId);
  const label = l ? propParamDefs(l).find((d) => d.name === first)?.label : "";
  update(i, { layerId, param: first, name: p.name || `${l?.name ?? "Layer"} ${label ?? ""}`.trim() });
}
function add() {
  emit("update:modelValue", [...props.modelValue, { id: crypto.randomUUID().slice(0, 8), name: "", layerId: "", param: "" }]);
}
function remove(i: number) {
  emit("update:modelValue", props.modelValue.filter((_, j) => j !== i));
}
</script>

<template>
  <EditorInspectorSection title="Props">
    <template #actions>
      <StudioButton variant="ghost" square aria-label="Add prop" title="Add prop" @click="add">
        <StudioIcon name="plus" />
      </StudioButton>
    </template>
    <p v-if="!modelValue.length" class="text-[var(--s-dim)]">
      Expose settings of this comp's layers; every precomp layer using it can set them per instance.
    </p>
    <div v-for="(p, i) in modelValue" :key="p.id" class="flex flex-col gap-[3px] bg-[var(--s-tile)] p-[6px]">
      <div class="flex items-center gap-[4px]">
        <input
          :value="p.name"
          placeholder="Prop name"
          spellcheck="false"
          class="h-[var(--s-ctl)] min-w-0 flex-1 bg-[var(--s-inset)] px-[5px] text-[var(--s-txt)] shadow-[inset_0_0_0_1px_var(--s-edge)] outline-none placeholder:text-[var(--s-dim)] focus:shadow-[inset_0_0_0_1px_var(--s-ring)]"
          @change="update(i, { name: ($event.target as HTMLInputElement).value })"
        />
        <StudioButton variant="ghost" square aria-label="Remove prop" title="Remove prop" @click="remove(i)">
          <StudioIcon name="trash" />
        </StudioButton>
      </div>
      <StudioRefField
        kind="layer"
        :model-value="p.layerId"
        :options="layerOptions"
        :clearable="false"
        placeholder="Pick a layer…"
        @update:model-value="onLayer(i, $event)"
      />
      <UiSelect
        v-if="p.layerId"
        :model-value="p.param"
        :options="paramOptions(p.layerId)"
        @update:model-value="update(i, { param: String($event) })"
      />
    </div>
  </EditorInspectorSection>
</template>
