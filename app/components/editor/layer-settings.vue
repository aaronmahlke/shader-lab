<script setup lang="ts">
import type { LayerInstance, LayerTemplate, LayerUniformDef, ModulationAssignment, LFOSource } from "#shared/types/editor";
import type { GradientStop } from "#shared/types";
import type { MeshPoint } from "#shared/types/mesh";
import { cloneMeshPoints } from "#shared/editor/mesh-uniforms";
import { applyModulation } from "#shared/editor/modulation";

type Props = {
  layer: LayerInstance;
  template: LayerTemplate;
  assignments: ModulationAssignment[];
  lfos: LFOSource[];
  draggingLfoId: string | null;
  meshSelectedPointIndex?: number;
};

type Emits = {
  "assign-lfo": [paramName: string];
  "remove-assignment": [sourceId: string, paramName: string];
  "update-depth": [sourceId: string, paramName: string, depth: number];
  "update:meshSelectedPointIndex": [index: number];
};

const {
  layer,
  template,
  assignments,
  lfos,
  draggingLfoId,
  meshSelectedPointIndex = 0,
} = defineProps<Props>();
const emit = defineEmits<Emits>();

function getAssignment(paramName: string): ModulationAssignment | undefined {
  return assignments.find((a) => a.layerId === layer.id && a.paramName === paramName);
}

const lfoValues = inject<Ref<Record<string, number>>>("lfoValues", ref({}));

function getLiveValue(def: LayerUniformDef): number | undefined {
  const assignment = getAssignment(def.name);
  if (!assignment) return undefined;
  return lfoValues.value[assignment.sourceId];
}

function getModulatedFloat(paramName: string, fallback: number): number {
  const base = (layer.values[paramName] as number) ?? fallback;
  const assignment = getAssignment(paramName);
  if (!assignment) return base;
  const lfoValue = lfoValues.value[assignment.sourceId] ?? 0;
  return applyModulation(base, paramName, lfoValue, assignment.depth);
}

function getLfoColor(sourceId: string): string | undefined {
  return lfos.find((l) => l.id === sourceId)?.color;
}

function getModInfo(def: LayerUniformDef): { color: string; depth: number } | null {
  const assignment = getAssignment(def.name);
  if (!assignment) return null;
  const color = getLfoColor(assignment.sourceId);
  if (!color) return null;
  return { color, depth: assignment.depth };
}

function onDepthUpdate(def: LayerUniformDef, depth: number) {
  const assignment = getAssignment(def.name);
  if (!assignment) return;
  emit("update-depth", assignment.sourceId, def.name, depth);
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function randomizeUniforms(defs: LayerUniformDef[], target: Record<string, unknown>) {
  for (const def of defs) {
    if (def.type === "float" || def.type === "int") {
      const min = def.min ?? 0;
      const max = def.max ?? 1;
      const step = def.step ?? 0.01;
      const padding = (max - min) * 0.2;
      const raw = (min + padding) + Math.random() * (max - min - padding * 2);
      target[def.name] = Math.min(max, Math.max(min, Math.round(raw / step) * step));
    } else if (def.type === "color") {
      target[def.name] = hslToHex(Math.random() * 360, 40 + Math.random() * 50, 30 + Math.random() * 40);
    } else if (def.type === "bool") {
      target[def.name] = Math.random() > 0.5;
    } else if (def.type === "select" && def.options?.length) {
      target[def.name] = def.options[Math.floor(Math.random() * def.options.length)]!.value;
    } else if (def.type === "vec2") {
      const min = def.min ?? 0;
      const max = def.max ?? 1;
      const step = def.step ?? 0.01;
      const snap = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
      target[def.name] = [snap(min + Math.random() * (max - min)), snap(min + Math.random() * (max - min))];
    } else if (def.type === "meshPoints" && Array.isArray(def.default)) {
      target[def.name] = (def.default as MeshPoint[]).map((p) => ({
        x: Math.random(),
        y: Math.random(),
        color: hslToHex(Math.random() * 360, 45 + Math.random() * 35, 35 + Math.random() * 30),
        radius: 0.4 + Math.random() * 0.7,
      }));
    }
  }
}

function resetToDefaults() {
  for (const def of template.uniforms) {
    if (def.type === "gradient" && Array.isArray(def.default)) {
      layer.values[def.name] = (def.default as GradientStop[]).map((s) => ({ ...s }));
    } else if (def.type === "meshPoints" && Array.isArray(def.default)) {
      layer.values[def.name] = cloneMeshPoints(def.default as MeshPoint[]);
    } else {
      layer.values[def.name] = def.default;
    }
  }
}

function randomize() {
  randomizeUniforms(template.uniforms, layer.values);
}

defineExpose({ randomize, reset: resetToDefaults });

function getFloat(def: LayerUniformDef, target: Record<string, unknown>): number {
  return (target[def.name] as number) ?? (def.default as number);
}

function setFloat(def: LayerUniformDef, target: Record<string, unknown>, v: number) {
  target[def.name] = v;
}

function getColor(def: LayerUniformDef, target: Record<string, unknown>): string {
  return (target[def.name] as string) ?? (def.default as string);
}

function setColor(def: LayerUniformDef, target: Record<string, unknown>, v: string) {
  target[def.name] = v;
}

function getBool(def: LayerUniformDef, target: Record<string, unknown>): boolean {
  return (target[def.name] as boolean) ?? (def.default as boolean);
}

function setBool(def: LayerUniformDef, target: Record<string, unknown>, v: boolean) {
  target[def.name] = v;
}

function getGradient(def: LayerUniformDef, target: Record<string, unknown>): GradientStop[] {
  return (target[def.name] as GradientStop[]) ?? (def.default as GradientStop[]);
}

function setGradient(def: LayerUniformDef, target: Record<string, unknown>, v: GradientStop[]) {
  target[def.name] = v;
}

function getMeshPoints(def: LayerUniformDef, target: Record<string, unknown>): MeshPoint[] {
  return (target[def.name] as MeshPoint[]) ?? (def.default as MeshPoint[]);
}

function setMeshPoints(def: LayerUniformDef, target: Record<string, unknown>, v: MeshPoint[]) {
  target[def.name] = v;
}

function getSelect(def: LayerUniformDef, target: Record<string, unknown>): string | number {
  return (target[def.name] as string | number) ?? (def.default as string | number);
}

function setSelect(def: LayerUniformDef, target: Record<string, unknown>, v: string | number) {
  target[def.name] = v;
}

function getVec2(def: LayerUniformDef, target: Record<string, unknown>): [number, number] {
  return (target[def.name] as [number, number]) ?? (def.default as [number, number]);
}

function setVec2X(def: LayerUniformDef, target: Record<string, unknown>, x: number) {
  const c = getVec2(def, target);
  target[def.name] = [x, c[1]];
}

function setVec2Y(def: LayerUniformDef, target: Record<string, unknown>, y: number) {
  const c = getVec2(def, target);
  target[def.name] = [c[0], y];
}

function resetUniform(def: LayerUniformDef) {
  layer.values[def.name] = def.default;
}

const isDistortion = computed(() => layer.type === "distortion");
const isChromaticAberration = computed(() => layer.type === "chromaticAberration");
const currentWaveType = computed(() => (layer.values.waveType as number) ?? 0);
const currentCoordMode = computed(() => (layer.values.coordMode as number) ?? 0);
const currentCaMode = computed(() => (layer.values.mode as number) ?? 0);

function isUniformVisible(def: LayerUniformDef): boolean {
  if (isDistortion.value) {
    if (def.name === "sharpness" || def.name === "pulseWidth") return currentWaveType.value === 1;
    if (def.name === "skew") return currentWaveType.value === 2;
    if (def.name === "direction") return currentCoordMode.value === 0;
    if (def.name === "centerX" || def.name === "centerY") return currentCoordMode.value === 1;
    return true;
  }
  if (isChromaticAberration.value) {
    if (def.name === "angle") return currentCaMode.value === 1;
    if (def.name === "centerX" || def.name === "centerY" || def.name === "radialScale") {
      return currentCaMode.value === 0;
    }
  }
  return true;
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
    <div v-if="isDistortion" class="border-b border-neutral px-3 py-3">
      <EditorWavePreview
        :wave-type="currentWaveType"
        :freq="getModulatedFloat('freq', 3)"
        :amplitude="getModulatedFloat('amplitude', 0.5)"
        :sharpness="getModulatedFloat('sharpness', 6.7)"
        :pulse-width="getModulatedFloat('pulseWidth', 0)"
        :skew="getModulatedFloat('skew', 0)"
      />
    </div>

    <div class="flex flex-col gap-2.5 p-3">
      <template v-for="def in template.uniforms" :key="def.name">
        <template v-if="isUniformVisible(def)">
          <UiContextMenu v-if="def.type === 'float' || def.type === 'int'">
            <div @pointerup="draggingLfoId && emit('assign-lfo', def.name)">
              <UiSliderField
                :model-value="getFloat(def, layer.values)"
                :label="def.label"
                :min="def.min"
                :max="def.max"
                :step="def.step ?? (def.type === 'int' ? 1 : 0.01)"
                :mod-color="getModInfo(def)?.color"
                :mod-depth="getModInfo(def)?.depth"
                :mod-live-value="getLiveValue(def)"
                :is-drop-target="draggingLfoId !== null"
                @update:model-value="setFloat(def, layer.values, $event)"
                @update:mod-depth="onDepthUpdate(def, $event)"
              />
            </div>
            <template #menu>
              <UiContextMenuItem @click="resetUniform(def)">Reset to default</UiContextMenuItem>
              <template v-if="getAssignment(def.name)">
                <UiContextMenuSeparator />
                <UiContextMenuItem @click="emit('remove-assignment', getAssignment(def.name)!.sourceId, def.name)">
                  Remove {{ lfos.find(l => l.id === getAssignment(def.name)!.sourceId)?.label }}
                </UiContextMenuItem>
              </template>
            </template>
          </UiContextMenu>
          <UiColorField
            v-else-if="def.type === 'color'"
            :model-value="getColor(def, layer.values)"
            :label="def.label"
            @update:model-value="setColor(def, layer.values, $event)"
          />
          <UiToggle
            v-else-if="def.type === 'bool'"
            :model-value="getBool(def, layer.values)"
            :label="def.label"
            @update:model-value="setBool(def, layer.values, $event)"
          />
          <UiGradientField
            v-else-if="def.type === 'gradient'"
            :model-value="getGradient(def, layer.values)"
            :label="def.label"
            @update:model-value="setGradient(def, layer.values, $event)"
          />
          <EditorMeshPointsField
            v-else-if="def.type === 'meshPoints'"
            :model-value="getMeshPoints(def, layer.values)"
            :selected-index="meshSelectedPointIndex"
            :layer-id="layer.id"
            :assignments="assignments"
            :lfos="lfos"
            :dragging-lfo-id="draggingLfoId"
            @update:model-value="setMeshPoints(def, layer.values, $event)"
            @update:selected-index="emit('update:meshSelectedPointIndex', $event)"
            @assign-lfo="emit('assign-lfo', $event)"
            @remove-assignment="(sid, pname) => emit('remove-assignment', sid, pname)"
            @update-depth="(sid, pname, depth) => emit('update-depth', sid, pname, depth)"
          />
          <UiSelect
            v-else-if="def.type === 'select'"
            :model-value="getSelect(def, layer.values) as string | number"
            :options="def.options ?? []"
            :label="def.label"
            @update:model-value="setSelect(def, layer.values, $event as string | number)"
          />
          <div v-else-if="def.type === 'vec2'" class="flex flex-col gap-2.5">
            <UiSliderField
              :model-value="getVec2(def, layer.values)[0]"
              :label="`${def.label} X`"
              :min="def.min"
              :max="def.max"
              :step="def.step ?? 0.01"
              @update:model-value="setVec2X(def, layer.values, $event)"
            />
            <UiSliderField
              :model-value="getVec2(def, layer.values)[1]"
              :label="`${def.label} Y`"
              :min="def.min"
              :max="def.max"
              :step="def.step ?? 0.01"
              @update:model-value="setVec2Y(def, layer.values, $event)"
            />
          </div>
        </template>
      </template>
    </div>
  </div>
</template>
