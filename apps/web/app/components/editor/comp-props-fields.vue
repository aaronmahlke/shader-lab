<script setup lang="ts">
/**
 * A precomp layer's props: one field per prop the nested comp exposes.
 * Unset = the comp's own value (shown as the placeholder / current value);
 * setting one stores it on this layer only (`values.props[propId]`).
 */
import { compPropsOf, hostPropValues, type CompositionConfig, type LayerInstance } from "@shader-lab/core";
import { propKind, propParamDef } from "#shared/editor/prop-params";
import { uploadMediaFile } from "~/utils/media-upload";
import { stageComponentOptions } from "~/utils/stage-components";

const { layer } = defineProps<{ layer: LayerInstance }>();

const resolveComposition = inject<((id: string) => CompositionConfig | null) | null>("editorResolveComposition", null);
const editorLayers = inject<Ref<LayerInstance[]> | null>("editorLayers", null);
const editorProjectId = inject<Ref<string | null> | null>("editorProjectId", null);
const history = useEditorHistory();

const config = computed(() => {
  const id = layer.values.compRefId;
  return typeof id === "string" && id ? (resolveComposition?.(id) ?? null) : null;
});

const rows = computed(() =>
  compPropsOf(config.value).map((p) => {
    const inner = config.value?.layers.find((l) => l.id === p.layerId);
    const def = propParamDef(inner, p.param);
    return { prop: p, inner, def, kind: propKind(inner, def) };
  }).filter((r) => r.kind),
);

const values = computed(() => hostPropValues(layer));
function valueOf(id: string, inner: LayerInstance | undefined, param: string): unknown {
  return values.value[id] ?? inner?.values[param];
}
function isSet(id: string) {
  return values.value[id] !== undefined;
}
function set(id: string, v: unknown) {
  layer.values.props = { ...values.value, [id]: v };
  history?.record();
}
function reset(id: string) {
  const next = { ...values.value };
  delete next[id];
  layer.values.props = next;
  history?.record();
}

const pointerOptions = computed(() =>
  (editorLayers?.value ?? []).filter((l) => l.type === "pointer").map((l) => ({ value: l.id, label: l.name ?? "Pointer", icon: "cursor" as const })),
);
const componentOptions = computed(() => stageComponentOptions().map((o) => ({ ...o, value: String(o.value), icon: "component" as const })));

const uploading = ref<string | null>(null);
async function upload(id: string, kind: "image" | "video" | "audio", e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = "";
  if (!file) return;
  uploading.value = id;
  try {
    set(id, await uploadMediaFile(kind, file, editorProjectId?.value));
  } finally {
    uploading.value = null;
  }
}
const fileName = (v: unknown) => (typeof v === "string" && v ? decodeURIComponent(v.split("/").pop() ?? v) : "None");
</script>

<template>
  <EditorInspectorSection v-if="rows.length" title="Props">
    <div v-for="r in rows" :key="r.prop.id" class="flex flex-col gap-[3px]">
      <div class="flex items-center justify-between">
        <span class="truncate select-none" :class="isSet(r.prop.id) ? 'text-[var(--s-txt)]' : 'text-[var(--s-dim)]'">
          {{ r.prop.name || r.def?.label }}
        </span>
        <button
          v-if="isSet(r.prop.id)"
          type="button"
          class="cursor-default text-[var(--s-dim)] outline-none hover:text-[var(--s-txt)]"
          title="Reset to the comp's value"
          @click="reset(r.prop.id)"
        >
          Reset
        </button>
      </div>

      <!-- media: file name + upload -->
      <div v-if="r.kind === 'image' || r.kind === 'video' || r.kind === 'audio'" class="flex items-center gap-[4px]">
        <span class="h-[var(--s-ctl)] min-w-0 flex-1 truncate bg-[var(--s-inset)] px-[5px] leading-[var(--s-ctl)] shadow-[inset_0_0_0_1px_var(--s-edge)]">
          {{ fileName(valueOf(r.prop.id, r.inner, r.prop.param)) }}
        </span>
        <label class="flex h-[var(--s-ctl)] cursor-default items-center bg-[var(--s-tile)] px-[7px] hover:bg-[var(--s-hover)]">
          {{ uploading === r.prop.id ? "Uploading…" : "Replace…" }}
          <input type="file" class="hidden" :accept="`${r.kind}/*`" @change="upload(r.prop.id, r.kind as 'image', $event)" />
        </label>
      </div>

      <StudioRefField
        v-else-if="r.kind === 'pointer'"
        kind="layer"
        :model-value="(values[r.prop.id] as string) ?? ''"
        :options="pointerOptions"
        placeholder="None (inner pointer)"
        @update:model-value="$event ? set(r.prop.id, $event) : reset(r.prop.id)"
      />

      <StudioRefField
        v-else-if="r.kind === 'component'"
        kind="component"
        :model-value="String(valueOf(r.prop.id, r.inner, r.prop.param) ?? '')"
        :options="componentOptions"
        :clearable="false"
        @update:model-value="set(r.prop.id, $event)"
      />

      <textarea
        v-else-if="r.kind === 'text'"
        :value="String(valueOf(r.prop.id, r.inner, r.prop.param) ?? '')"
        rows="2"
        spellcheck="false"
        class="w-full resize-y bg-[var(--s-inset)] px-[5px] py-[3px] text-[var(--s-txt)] shadow-[inset_0_0_0_1px_var(--s-edge)] outline-none focus:shadow-[inset_0_0_0_1px_var(--s-ring)]"
        @change="set(r.prop.id, ($event.target as HTMLTextAreaElement).value)"
      />

      <UiSliderField
        v-else-if="r.kind === 'number'"
        :model-value="Number(valueOf(r.prop.id, r.inner, r.prop.param) ?? r.def?.default ?? 0)"
        :min="r.def?.min"
        :max="r.def?.max"
        :step="r.def?.step ?? 0.01"
        @update:model-value="set(r.prop.id, $event)"
      />

      <UiColorField
        v-else-if="r.kind === 'color'"
        :model-value="String(valueOf(r.prop.id, r.inner, r.prop.param) ?? r.def?.default ?? '#ffffff')"
        @update:model-value="set(r.prop.id, $event)"
      />

      <UiSelect
        v-else-if="r.kind === 'select'"
        :model-value="valueOf(r.prop.id, r.inner, r.prop.param) as string | number"
        :options="r.def?.options ?? []"
        @update:model-value="set(r.prop.id, $event)"
      />

      <UiToggle
        v-else-if="r.kind === 'bool'"
        :model-value="!!valueOf(r.prop.id, r.inner, r.prop.param)"
        @update:model-value="set(r.prop.id, $event)"
      />
    </div>
  </EditorInspectorSection>
</template>
