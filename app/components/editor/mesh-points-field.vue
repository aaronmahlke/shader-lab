<script setup lang="ts">
import { CollapsibleRoot, CollapsibleTrigger, CollapsibleContent } from "reka-ui";
import { ChevronRightIcon } from "@heroicons/vue/16/solid";
import type { LFOSource, ModulationAssignment } from "#shared/types/editor";
import type { MeshPoint } from "#shared/types/mesh";
import { MESH_MAX_POINTS } from "#shared/types/mesh";
import { meshParamName, type MeshPointField } from "#shared/editor/mesh-uniforms";

const model = defineModel<MeshPoint[]>({ required: true });
const selectedIndex = defineModel<number>("selectedIndex", { default: 0 });

const props = defineProps<{
  layerId: string;
  assignments: ModulationAssignment[];
  lfos: LFOSource[];
  draggingLfoId: string | null;
}>();

const emit = defineEmits<{
  "assign-lfo": [paramName: string];
  "remove-assignment": [sourceId: string, paramName: string];
  "update-depth": [sourceId: string, paramName: string, depth: number];
}>();

const labels = ["1", "2", "3", "4", "5", "6"];
const LFO_HOVER_OPEN_MS = 600;

const openSections = ref<Set<number>>(new Set([0]));
const hoverOpenTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const hoverOpenTarget = ref<number | null>(null);

const lfoValues = inject<Ref<Record<string, number>>>("lfoValues", ref({}));

function ensurePoints(points: MeshPoint[]): MeshPoint[] {
  const out = [...points];
  while (out.length < MESH_MAX_POINTS) {
    out.push({ x: 0.5, y: 0.5, color: "#808080", radius: 0.5 });
  }
  return out.slice(0, MESH_MAX_POINTS);
}

const points = computed({
  get: () => ensurePoints(model.value),
  set: (v) => {
    model.value = v;
  },
});

function updatePoint(index: number, patch: Partial<MeshPoint>) {
  const next = ensurePoints(model.value);
  next[index] = { ...next[index]!, ...patch };
  model.value = next;
}

function isSectionOpen(index: number) {
  return openSections.value.has(index);
}

function setSectionOpen(index: number, open: boolean) {
  const next = new Set(openSections.value);
  if (open) next.add(index);
  else next.delete(index);
  openSections.value = next;
}

function clearHoverOpenTimer() {
  if (!hoverOpenTimer.value) return;
  clearTimeout(hoverOpenTimer.value);
  hoverOpenTimer.value = null;
}

function onSectionPointerEnter(index: number) {
  if (!props.draggingLfoId || isSectionOpen(index)) return;

  clearHoverOpenTimer();
  hoverOpenTarget.value = index;
  hoverOpenTimer.value = setTimeout(() => {
    if (hoverOpenTarget.value === index) {
      setSectionOpen(index, true);
    }
  }, LFO_HOVER_OPEN_MS);
}

function onSectionPointerLeave(index: number) {
  if (hoverOpenTarget.value !== index) return;
  clearHoverOpenTimer();
  hoverOpenTarget.value = null;
}

watch(
  () => selectedIndex.value,
  (index) => {
    if (index >= 0) setSectionOpen(index, true);
  },
);

watch(
  () => props.draggingLfoId,
  (id) => {
    if (!id) {
      clearHoverOpenTimer();
      hoverOpenTarget.value = null;
    }
  },
);

onUnmounted(clearHoverOpenTimer);

function getAssignment(paramName: string): ModulationAssignment | undefined {
  return props.assignments.find(
    (a) => a.layerId === props.layerId && a.paramName === paramName,
  );
}

function getLfoColor(sourceId: string): string | undefined {
  return props.lfos.find((l) => l.id === sourceId)?.color;
}

function getLiveValue(paramName: string): number | undefined {
  const assignment = getAssignment(paramName);
  if (!assignment) return undefined;
  return lfoValues.value[assignment.sourceId];
}

function getModInfo(paramName: string): { color: string; depth: number } | null {
  const assignment = getAssignment(paramName);
  if (!assignment) return null;
  const color = getLfoColor(assignment.sourceId);
  if (!color) return null;
  return { color, depth: assignment.depth };
}

function onDepthUpdate(paramName: string, depth: number) {
  const assignment = getAssignment(paramName);
  if (!assignment) return;
  emit("update-depth", assignment.sourceId, paramName, depth);
}

type SliderSpec = {
  field: MeshPointField;
  label: string;
  min: number;
  max: number;
  step: number;
};

const sliderSpecs: SliderSpec[] = [
  { field: "x", label: "X", min: 0, max: 1, step: 0.01 },
  { field: "y", label: "Y", min: 0, max: 1, step: 0.01 },
  { field: "radius", label: "Radius", min: 0.15, max: 1.5, step: 0.01 },
];
</script>

<template>
  <div class="-mx-3 flex flex-col border-t border-neutral">
    <CollapsibleRoot
      v-for="(pt, i) in points"
      :key="i"
      :open="isSectionOpen(i)"
      @update:open="setSectionOpen(i, $event)"
    >
      <CollapsibleTrigger
        class="flex w-full cursor-default items-center gap-2 border-b border-neutral px-3 py-2 text-copy-sm text-secondary transition-colors select-none hover:text-primary"
        :class="[
          isSectionOpen(i) && 'text-primary',
          draggingLfoId && !isSectionOpen(i) && hoverOpenTarget === i && 'bg-surface-1 text-primary',
        ]"
        @pointerenter="onSectionPointerEnter(i)"
        @pointerleave="onSectionPointerLeave(i)"
      >
        <ChevronRightIcon
          :class="[
            'size-4 shrink-0 text-tertiary transition-transform duration-150 ease-out-expo',
            isSectionOpen(i) && 'rotate-90',
          ]"
        />
        <span class="select-none">Point {{ labels[i] }}</span>
        <span
          class="ml-auto size-3 shrink-0 rounded-full border border-edge-subtle"
          :style="{ backgroundColor: pt.color }"
        />
      </CollapsibleTrigger>

      <CollapsibleContent
        class="overflow-hidden border-b border-neutral data-[state=closed]:animate-collapse data-[state=open]:animate-expand"
      >
        <div class="flex flex-col gap-2.5 px-3 py-3">
          <UiColorField
            :model-value="pt.color"
            label="Color"
            @update:model-value="updatePoint(i, { color: $event })"
          />

          <UiContextMenu
            v-for="spec in sliderSpecs"
            :key="spec.field"
          >
            <div @pointerup="draggingLfoId && emit('assign-lfo', meshParamName(i, spec.field))">
              <UiSliderField
                :model-value="pt[spec.field]"
                :label="spec.label"
                :min="spec.min"
                :max="spec.max"
                :step="spec.step"
                :mod-color="getModInfo(meshParamName(i, spec.field))?.color"
                :mod-depth="getModInfo(meshParamName(i, spec.field))?.depth"
                :mod-live-value="getLiveValue(meshParamName(i, spec.field))"
                :is-drop-target="draggingLfoId !== null"
                @update:model-value="updatePoint(i, { [spec.field]: $event })"
                @update:mod-depth="onDepthUpdate(meshParamName(i, spec.field), $event)"
              />
            </div>
            <template #menu>
              <template v-if="getAssignment(meshParamName(i, spec.field))">
                <UiContextMenuItem
                  @click="emit('remove-assignment', getAssignment(meshParamName(i, spec.field))!.sourceId, meshParamName(i, spec.field))"
                >
                  <span
                    class="size-2 rounded-full"
                    :style="{ backgroundColor: getLfoColor(getAssignment(meshParamName(i, spec.field))!.sourceId) }"
                  />
                  Remove {{ lfos.find(l => l.id === getAssignment(meshParamName(i, spec.field))!.sourceId)?.label }}
                </UiContextMenuItem>
              </template>
            </template>
          </UiContextMenu>
        </div>
      </CollapsibleContent>
    </CollapsibleRoot>
  </div>
</template>
