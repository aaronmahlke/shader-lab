<script setup lang="ts">
import type { LayerInstance, LayerType, LFOSource, ModulationAssignment } from "#shared/types/editor";
import LAYER_TEMPLATES from "#shared/editor/layer-templates";
import { LFO_COLORS, nextLfoColor } from "#shared/editor/lfo-colors";
import { clonePresetPoints } from "#shared/editor/lfo-presets";
import { normalizeLfo } from "#shared/editor/lfo-wave";
import {
  cloneShaderPreset,
  getShaderPreset,
  DEFAULT_PRESET_ID,
} from "#shared/editor/shader-presets";
import { buildLayerValues } from "#shared/editor/build-layer-values";
import {
  normalizeCompositeLayers,
  offsetDuplicatedWave,
} from "#shared/editor/normalize-composite-layers";
import {
  WAVE_AMPLITUDE,
  WAVE_CYCLE_WIDTH,
  WAVE_POS_X,
  WAVE_POS_Y,
} from "#shared/editor/wave-position";
import { BAND_EDGE, BAND_Y } from "#shared/editor/band-position";
import { getHybridContext } from "#shared/editor/hybrid-pipeline";
import { cloneMeshPoints } from "#shared/editor/mesh-uniforms";
import { CubeIcon, ArrowPathIcon } from "@heroicons/vue/16/solid";
import type { MeshPoint } from "#shared/types/mesh";
import { MESH_MAX_POINTS } from "#shared/types/mesh";

useHead({ title: "Shader — Shader Lab" });

const route = useRoute();
const fromArtworkId = computed(() => route.query.fromArtwork as string | undefined);
const exportOpen = ref(false);
const layerSettingsRef = ref<{ randomize: () => void; reset: () => void } | null>(null);

const { data: fromArtworkRow } = await useFetch(
  () => (fromArtworkId.value ? `/api/artworks/${fromArtworkId.value}` : null),
  { watch: [fromArtworkId] },
);
const fromArtworkName = computed(() => {
  const row = fromArtworkRow.value as { name?: string } | null;
  return row?.name;
});
const canvasRef = ref<HTMLCanvasElement | null>(null);

// --- Load composition from server or preset ---

const routeId = route.params.id as string | undefined;
const presetId = (route.query.preset as string | undefined) ?? DEFAULT_PRESET_ID;
const initialDoc = cloneShaderPreset(
  routeId ? DEFAULT_PRESET_ID : (getShaderPreset(presetId) ? presetId : DEFAULT_PRESET_ID),
);

const shaderId = ref<string | null>(routeId ?? null);
const shaderName = ref(
  routeId ? "Untitled" : (getShaderPreset(presetId)?.name ?? "Untitled"),
);
const layers = ref<LayerInstance[]>(initialDoc.layers);
normalizeCompositeLayers(layers.value);
const lfos = ref<LFOSource[]>(initialDoc.lfos.map((lfo) => normalizeLfo(lfo)));
const assignments = ref<ModulationAssignment[]>(initialDoc.assignments);

if (routeId) {
  const { data } = await useFetch(`/api/shaders/${routeId}`);
  if (data.value) {
    const comp = data.value as {
      id: string;
      name: string;
      data: { layers: LayerInstance[]; lfos: LFOSource[]; assignments: ModulationAssignment[] };
    };
    shaderId.value = comp.id;
    shaderName.value = comp.name;
    layers.value = comp.data.layers;
    normalizeCompositeLayers(layers.value);
    lfos.value = comp.data.lfos.map((lfo) => normalizeLfo(lfo));
    assignments.value = comp.data.assignments;
  }
}

// --- Selection state ---

const selectedLayerId = ref<string | null>(
  layers.value.find((l) => l.enabled)?.id ?? layers.value[0]?.id ?? null,
);

const selectedLayer = computed(() => {
  if (!selectedLayerId.value) return null;
  return layers.value.find((l) => l.id === selectedLayerId.value) ?? null;
});

const selectedTemplate = computed(() => {
  if (!selectedLayer.value) return null;
  return LAYER_TEMPLATES[selectedLayer.value.type] ?? null;
});

// --- LFO state ---

const selectedLfoId = ref<string | null>(null);
const draggingLfoId = ref<string | null>(null);

// --- Modulation Engine ---

const { lfoValues, lfoPhases, getModulatedValue, sampleLfosAtTime } = useModulationEngine(lfos, assignments);

const modFn = computed(() => getModulatedValue);

provide("lfoValues", lfoValues);

const selectedLfoCursorPosition = computed(() => {
  if (!selectedLfoId.value) return undefined;
  return lfoPhases.value[selectedLfoId.value];
});

// --- Layer Compiler + Renderer ---

const { passes } = useLayerCompiler(layers, modFn, lfos, assignments);
const {
  getCanvas,
  capture,
  pause,
  resume,
  configureRenderer,
  restoreRenderer,
  renderFrame,
} = useMultiPassRenderer(canvasRef, passes, {
  layers,
  getModulatedValue: modFn,
  sampleLfosAtTime,
});

const shaderExport = {
  capture: (w: number, h: number) =>
    capture(w, h, `${shaderId.value ?? "shader"}-${w}x${h}.png`),
  pause,
  resume,
  getCanvas,
  configureRenderer,
  restoreRenderer,
  renderFrame,
};

// --- Auto-Save ---

const shaderData = computed(() => ({
  version: 1 as const,
  layers: layers.value,
  lfos: lfos.value,
  assignments: assignments.value,
}));

useAutoSave(shaderId, shaderName, shaderData, { kind: "shader", getCanvas });

// --- Layer Management ---

let layerCounter = 100;

function addLayer(type: LayerType) {
  const template = LAYER_TEMPLATES[type];
  if (!template) return;

  const id = `${type}-${++layerCounter}`;
  const values = buildLayerValues(type);

  if (type === "waveFill") {
    offsetDuplicatedWave(
      values,
      layers.value.filter((l) => l.type === "waveFill").length,
    );
  }

  layers.value.unshift({ id, type, enabled: true, values });
  selectedLayerId.value = id;
}

function removeLayer(id: string) {
  const idx = layers.value.findIndex((l) => l.id === id);
  if (idx === -1) return;
  layers.value.splice(idx, 1);
  assignments.value = assignments.value.filter((a) => a.layerId !== id);
  if (selectedLayerId.value === id) {
    selectedLayerId.value = layers.value[Math.min(idx, layers.value.length - 1)]?.id ?? null;
  }
}

function duplicateLayer(id: string) {
  const source = layers.value.find((l) => l.id === id);
  if (!source) return;
  const newId = `${source.type}-${++layerCounter}`;
  const values = JSON.parse(JSON.stringify(source.values)) as Record<string, unknown>;
  if (source.type === "waveFill") {
    offsetDuplicatedWave(
      values,
      layers.value.filter((l) => l.type === "waveFill").length,
    );
  }
  const clone: LayerInstance = {
    id: newId,
    type: source.type,
    enabled: source.enabled,
    values,
  };
  const idx = layers.value.findIndex((l) => l.id === id);
  layers.value.splice(idx, 0, clone);
  selectedLayerId.value = newId;

  const clonedAssignments = assignments.value
    .filter((a) => a.layerId === id)
    .map((a) => ({ ...a, layerId: newId }));
  assignments.value.push(...clonedAssignments);
}

// --- LFO Management ---

function deleteLfo(id: string) {
  lfos.value = lfos.value.filter((l) => l.id !== id);
  assignments.value = assignments.value.filter((a) => a.sourceId !== id);
  if (selectedLfoId.value === id) selectedLfoId.value = null;
}

function duplicateLfo(id: string) {
  const source = lfos.value.find((l) => l.id === id);
  if (!source) return;
  const newId = `lfo-${Date.now()}`;
  const existingColors = lfos.value.map((l) => l.color);
  const clone: LFOSource = {
    ...source,
    id: newId,
    label: `${source.label}`,
    color: nextLfoColor(existingColors),
    points: source.points.map((p) => ({ ...p })),
  };
  lfos.value.push(clone);
  selectedLfoId.value = newId;
}

function clearLfoAssignments(id: string) {
  assignments.value = assignments.value.filter((a) => a.sourceId !== id);
}

// --- Modulation Assignment Management ---

function assignLfo(paramName: string) {
  if (!draggingLfoId.value || !selectedLayer.value) return;
  assignments.value = assignments.value.filter(
    (a) => !(a.layerId === selectedLayer.value!.id && a.paramName === paramName),
  );
  const template = selectedTemplate.value;
  const def = template?.uniforms.find((u) => u.name === paramName);
  const range = ((def?.max ?? 1) - (def?.min ?? 0)) * 0.15;

  assignments.value.push({
    sourceId: draggingLfoId.value,
    layerId: selectedLayer.value.id,
    paramName,
    depth: range,
  });
  draggingLfoId.value = null;
}

function removeAssignment(sourceId: string, paramName: string) {
  if (!selectedLayer.value) return;
  assignments.value = assignments.value.filter(
    (a) => !(a.sourceId === sourceId && a.layerId === selectedLayer.value!.id && a.paramName === paramName),
  );
}

function updateDepth(sourceId: string, paramName: string, depth: number) {
  const assignment = assignments.value.find(
    (a) => a.sourceId === sourceId && a.layerId === selectedLayer.value?.id && a.paramName === paramName,
  );
  if (assignment) {
    assignment.depth = depth;
  }
}

// --- Drag LFO handling ---

const dragPos = ref({ x: -999, y: -999 });

const draggingLfo = computed(() => {
  if (!draggingLfoId.value) return null;
  return lfos.value.find((l) => l.id === draggingLfoId.value) ?? null;
});

function onDragStart(lfoId: string, x: number, y: number) {
  draggingLfoId.value = lfoId;
  dragPos.value = { x, y };

  function onMove(e: PointerEvent) {
    dragPos.value = { x: e.clientX, y: e.clientY };
  }

  function onUp() {
    setTimeout(() => {
      draggingLfoId.value = null;
      dragPos.value = { x: -999, y: -999 };
    }, 50);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

// --- Selected layer assignments ---

const selectedLayerAssignments = computed(() => {
  if (!selectedLayer.value) return [];
  return assignments.value.filter((a) => a.layerId === selectedLayer.value!.id);
});

const waveFillTemplate = LAYER_TEMPLATES.waveFill;
const wavePosXDef = waveFillTemplate.uniforms.find((u) => u.name === WAVE_POS_X)!;
const wavePosYDef = waveFillTemplate.uniforms.find((u) => u.name === WAVE_POS_Y)!;
const waveAmpDef = waveFillTemplate.uniforms.find((u) => u.name === WAVE_AMPLITUDE)!;
const waveWidthDef = waveFillTemplate.uniforms.find((u) => u.name === WAVE_CYCLE_WIDTH)!;

const showWavePositionGizmo = computed(
  () => selectedLayer.value?.type === "waveFill" && selectedLayer.value.enabled,
);

function getWaveFloat(
  layer: LayerInstance,
  key: typeof WAVE_POS_X | typeof WAVE_POS_Y | typeof WAVE_AMPLITUDE | typeof WAVE_CYCLE_WIDTH,
  fallback: number,
) {
  return (layer.values[key] as number) ?? fallback;
}

function setWaveFloat(
  layer: LayerInstance,
  key: typeof WAVE_POS_X | typeof WAVE_POS_Y | typeof WAVE_AMPLITUDE | typeof WAVE_CYCLE_WIDTH,
  value: number,
) {
  layer.values[key] = value;
}

const meshTemplate = LAYER_TEMPLATES.mesh;
const meshPointsDef = meshTemplate.uniforms.find((u) => u.type === "meshPoints")!;

const meshSelectedPointIndex = ref(0);

watch(selectedLayerId, () => {
  meshSelectedPointIndex.value = 0;
});

const showMeshPointsGizmo = computed(
  () => selectedLayer.value?.type === "mesh" && selectedLayer.value.enabled,
);

function getMeshPoints(layer: LayerInstance): MeshPoint[] {
  const raw = layer.values[meshPointsDef.name] as MeshPoint[] | undefined;
  const base = raw?.length
    ? cloneMeshPoints(raw)
    : cloneMeshPoints(meshPointsDef.default as MeshPoint[]);
  while (base.length < MESH_MAX_POINTS) {
    base.push({ x: 0.5, y: 0.5, color: "#808080", radius: 0.5 });
  }
  return base.slice(0, MESH_MAX_POINTS);
}

function setMeshPoints(layer: LayerInstance, points: MeshPoint[]) {
  layer.values[meshPointsDef.name] = points;
}

const bandFillTemplate = LAYER_TEMPLATES.bandFill;
const bandYDef = bandFillTemplate.uniforms.find((u) => u.name === BAND_Y)!;
const bandEdgeDef = bandFillTemplate.uniforms.find((u) => u.name === BAND_EDGE)!;
const hybridEdgeWidth = computed(() => getHybridContext(layers.value).edgeWidth);

const showBandPositionGizmo = computed(
  () => selectedLayer.value?.type === "bandFill" && selectedLayer.value.enabled,
);

function getBandFloat(
  layer: LayerInstance,
  key: typeof BAND_Y | typeof BAND_EDGE,
  fallback: number,
) {
  return (layer.values[key] as number) ?? fallback;
}

function setBandFloat(
  layer: LayerInstance,
  key: typeof BAND_Y | typeof BAND_EDGE,
  value: number,
) {
  layer.values[key] = value;
}
</script>

<template>
  <EditorFrame>
    <template #left>
      <EditorLayerStack
        v-model:layers="layers"
        v-model:selected-layer-id="selectedLayerId"
        v-model:shader-name="shaderName"
        v-model:lfos="lfos"
        v-model:selected-lfo-id="selectedLfoId"
        :home-to="fromArtworkId ? `/artwork/${fromArtworkId}` : '/'"
        :lfo-cursor-position="selectedLfoCursorPosition"
        @duplicate-layer="duplicateLayer"
        @remove-layer="removeLayer"
        @drag-start="onDragStart"
        @duplicate-lfo="duplicateLfo"
        @clear-assignments="clearLfoAssignments"
        @delete-lfo="deleteLfo"
      />
    </template>

    <div class="relative min-h-0 min-w-0 flex-1">
      <ClientOnly>
        <div class="size-full min-h-0 select-none">
          <div class="absolute inset-0 overflow-hidden">
            <canvas
              ref="canvasRef"
              class="pointer-events-none size-full"
            />
            <EditorWavePositionGizmo
              v-if="showWavePositionGizmo && selectedLayer"
              :cycle-x="getWaveFloat(selectedLayer, WAVE_POS_X, wavePosXDef.default as number)"
              :center-y="getWaveFloat(selectedLayer, WAVE_POS_Y, wavePosYDef.default as number)"
              :amplitude="getWaveFloat(selectedLayer, WAVE_AMPLITUDE, waveAmpDef.default as number)"
              :cycle-width="getWaveFloat(selectedLayer, WAVE_CYCLE_WIDTH, waveWidthDef.default as number)"
              :x-min="wavePosXDef.min ?? -1"
              :x-max="wavePosXDef.max ?? 2"
              :y-min="wavePosYDef.min ?? -1"
              :y-max="wavePosYDef.max ?? 2"
              :amp-min="waveAmpDef.min ?? 0"
              :amp-max="waveAmpDef.max ?? 0.4"
              :width-min="waveWidthDef.min ?? 0.08"
              :width-max="waveWidthDef.max ?? 2"
              @update:cycle-x="setWaveFloat(selectedLayer, WAVE_POS_X, $event)"
              @update:center-y="setWaveFloat(selectedLayer, WAVE_POS_Y, $event)"
              @update:amplitude="setWaveFloat(selectedLayer, WAVE_AMPLITUDE, $event)"
              @update:cycle-width="setWaveFloat(selectedLayer, WAVE_CYCLE_WIDTH, $event)"
            />
            <EditorMeshPointsGizmo
              v-if="showMeshPointsGizmo && selectedLayer"
              :points="getMeshPoints(selectedLayer)"
              :selected-index="meshSelectedPointIndex"
              :radius-min="0.15"
              :radius-max="1.5"
              @update:points="setMeshPoints(selectedLayer, $event)"
              @update:selected-index="meshSelectedPointIndex = $event"
            />
            <EditorBandPositionGizmo
              v-if="showBandPositionGizmo && selectedLayer"
              :band-y="getBandFloat(selectedLayer, BAND_Y, bandYDef.default as number)"
              :edge="getBandFloat(selectedLayer, BAND_EDGE, bandEdgeDef.default as number)"
              :global-edge-width="hybridEdgeWidth"
              :y-min="bandYDef.min ?? 0"
              :y-max="bandYDef.max ?? 1"
              :edge-min="bandEdgeDef.min ?? 0.02"
              :edge-max="bandEdgeDef.max ?? 1"
              @update:band-y="setBandFloat(selectedLayer, BAND_Y, $event)"
              @update:edge="setBandFloat(selectedLayer, BAND_EDGE, $event)"
            />
          </div>
        </div>
      </ClientOnly>

      <div class="pointer-events-none absolute inset-x-0 top-3 z-50 flex justify-center">
        <EditorLayerAddBar class="pointer-events-auto" @select="addLayer" />
      </div>
    </div>

    <template #right>
      <div class="flex h-full min-h-0 flex-col">
        <div class="flex shrink-0 items-center justify-between border-b border-neutral px-3 py-2.5">
          <div class="flex items-center gap-0.5">
            <UiButton
              v-if="selectedLayer && selectedTemplate"
              variant="ghost"
              size="sm"
              :icon-left="CubeIcon"
              title="Randomize"
              @click="layerSettingsRef?.randomize()"
            />
            <UiButton
              v-if="selectedLayer && selectedTemplate"
              variant="ghost"
              size="sm"
              :icon-left="ArrowPathIcon"
              title="Reset to defaults"
              @click="layerSettingsRef?.reset()"
            />
          </div>
          <UiButton variant="filled" size="sm" @click="exportOpen = true">
            Export
          </UiButton>
        </div>
        <EditorLayerSettings
          v-if="selectedLayer && selectedTemplate"
          ref="layerSettingsRef"
          :key="selectedLayer.id"
          :layer="selectedLayer"
          :template="selectedTemplate"
          :assignments="selectedLayerAssignments"
          :lfos="lfos"
          :dragging-lfo-id="draggingLfoId"
          :mesh-selected-point-index="meshSelectedPointIndex"
          @update:mesh-selected-point-index="meshSelectedPointIndex = $event"
          @assign-lfo="assignLfo"
          @remove-assignment="removeAssignment"
          @update-depth="updateDepth"
        />
        <div
          v-else
          class="flex flex-1 items-center justify-center p-6 text-center"
        >
          <p class="text-copy-sm text-neutral-subtle">
            Select a layer to edit its settings.
          </p>
        </div>
      </div>
    </template>
  </EditorFrame>

  <div
    v-if="draggingLfo"
    class="pointer-events-none fixed z-50 flex w-max items-center gap-2 whitespace-nowrap rounded-lg border border-neutral bg-layer-1 px-2.5 py-1.5 text-copy-sm text-neutral-strong shadow-panel"
    :style="{
      left: `${dragPos.x}px`,
      top: `${dragPos.y}px`,
      transform: 'translate(-50%, -50%)',
    }"
  >
    <UiLfoSineIcon class="h-1.5 w-4 shrink-0" :style="{ color: draggingLfo.color }" />
    <span>{{ draggingLfo.label }}</span>
  </div>

  <ControlsExportDialog
    v-model:open="exportOpen"
    :experiment-id="shaderId ?? 'shader'"
    :shader="shaderExport"
  />
</template>
