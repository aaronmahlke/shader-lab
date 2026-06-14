<script setup lang="ts">
import type {
  LayerInstance,
  LayerType,
  LFOSource,
  ModulationAssignment,
  PropertyTrack,
  CompositionSettings,
} from "@shader-lab/core";
import {
  LAYER_TEMPLATES,
  DEFAULT_COMPOSITION_SETTINGS,
  normalizeComposition,
  setTrackEnabled,
  upsertKeyframe,
  removeKeyframeAt,
  findPropertyTrack,
  evaluatePropertyTrack,
  hasKeyframeAt,
} from "@shader-lab/core";
import type { KeyframeSelection } from "#shared/editor/keyframe-selection";
import { useEventListener } from "@vueuse/core";
import { LFO_COLORS, nextLfoColor } from "#shared/editor/lfo-colors";
import { clonePresetPoints } from "#shared/editor/lfo-presets";
import { normalizeLfo } from "@shader-lab/core";
import {
  cloneShaderPreset,
  getShaderPreset,
  DEFAULT_PRESET_ID,
} from "#shared/editor/shader-presets";
import { buildLayerValues, offsetDuplicatedWave } from "@shader-lab/core";
import { ChevronRightIcon } from "@heroicons/vue/16/solid";
import {
  WAVE_AMPLITUDE,
  WAVE_CYCLE_WIDTH,
  WAVE_POS_X,
  WAVE_POS_Y,
} from "#shared/editor/wave-position";
import { BAND_EDGE, BAND_Y } from "#shared/editor/band-position";
import { cloneMeshPoints } from "@shader-lab/core";
import { CubeIcon, ArrowPathIcon } from "@heroicons/vue/16/solid";
import type { MeshPoint } from "@shader-lab/core";
import { MESH_MAX_POINTS } from "@shader-lab/core";

useHead({ title: "Shader — Shader Lab" });

const route = useRoute();
const exportOpen = ref(false);
const layerSettingsRef = ref<{ randomize: () => void; reset: () => void } | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const editorSplitRef = ref<HTMLElement | null>(null);
const { prefs: layoutPrefs, updatePrefs: updateLayoutPrefs } = useEditorLayoutPreferences();

const timelineHeight = ref(layoutPrefs.value.timelineHeight);

const timelineZoom = computed({
  get: () => layoutPrefs.value.timelinePxPerSecond,
  set: (pxPerSecond) => updateLayoutPrefs({ timelinePxPerSecond: pxPerSecond }),
});

const { onPointerDown: onTimelineResizePointerDown } = useVerticalPaneResize({
  height: timelineHeight,
  min: 120,
  getMax: () => Math.max(160, (editorSplitRef.value?.clientHeight ?? 600) - 120),
  onResizeEnd: () => updateLayoutPrefs({ timelineHeight: timelineHeight.value }),
});

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
const settings = ref<CompositionSettings>({
  ...DEFAULT_COMPOSITION_SETTINGS,
  ...initialDoc.settings,
});
const tracks = ref<PropertyTrack[]>(initialDoc.tracks ?? []);
normalizeComposition({
  version: 1,
  layers: layers.value,
  lfos: initialDoc.lfos,
  assignments: initialDoc.assignments,
  settings: settings.value,
  tracks: tracks.value,
});
const lfos = ref<LFOSource[]>(initialDoc.lfos.map((lfo) => normalizeLfo(lfo)));
const assignments = ref<ModulationAssignment[]>(initialDoc.assignments);

const currentTime = ref(0);
const playing = ref(false);
const selectedKeyframes = ref<KeyframeSelection[]>([]);

if (routeId) {
  const { data } = await useFetch(`/api/shaders/${routeId}`);
  if (data.value) {
    const comp = data.value as {
      id: string;
      name: string;
      data: {
        layers: LayerInstance[];
        lfos: LFOSource[];
        assignments: ModulationAssignment[];
        settings?: CompositionSettings;
        tracks?: PropertyTrack[];
      };
    };
    shaderId.value = comp.id;
    shaderName.value = comp.name;
    layers.value = comp.data.layers;
    settings.value = { ...DEFAULT_COMPOSITION_SETTINGS, ...comp.data.settings };
    tracks.value = comp.data.tracks ?? [];
    normalizeComposition({
      version: 1,
      layers: layers.value,
      lfos: comp.data.lfos,
      assignments: comp.data.assignments,
      settings: settings.value,
      tracks: tracks.value,
    });
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

const { lfoValues, getModulatedValue, modFn, sampleLfosAtTime } = useModulationEngine(
  lfos,
  assignments,
  { clockTime: currentTime, tracks },
);

provide("lfoValues", lfoValues);

// --- Playback ---

let playbackId: number | null = null;
let lastPlaybackMs = 0;
let playbackClock = 0;

function playbackTick(now: number) {
  if (!playing.value) return;
  const delta = lastPlaybackMs === 0 ? 0 : (now - lastPlaybackMs) / 1000;
  lastPlaybackMs = now;

  playbackClock += delta;
  const fps = settings.value.fps;
  const step = 1 / fps;
  const frame = Math.floor(playbackClock / step);
  const maxFrame = Math.floor(settings.value.duration * fps);

  if (frame >= maxFrame) {
    playbackClock = 0;
    currentTime.value = 0;
  } else {
    currentTime.value = frame * step;
  }

  playbackId = requestAnimationFrame(playbackTick);
}

watch(playing, (isPlaying) => {
  if (isPlaying) {
    playbackClock = currentTime.value;
    lastPlaybackMs = 0;
    playbackId = requestAnimationFrame(playbackTick);
  } else if (playbackId !== null) {
    cancelAnimationFrame(playbackId);
    playbackId = null;
  }
});

onBeforeUnmount(() => {
  if (playbackId !== null) cancelAnimationFrame(playbackId);
});

useEventListener(window, "keydown", (e: KeyboardEvent) => {
  if (e.code !== "Space" || e.repeat) return;
  const target = e.target as HTMLElement | null;
  if (
    target?.closest("input, textarea, select, [contenteditable='true']")
  ) {
    return;
  }
  e.preventDefault();
  playing.value = !playing.value;
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
  tracks,
  getModulatedValue: modFn,
  sampleLfosAtTime,
  compositionTime: currentTime,
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
  settings: settings.value,
  tracks: tracks.value,
}));

useAutoSave(shaderId, shaderName, shaderData, { getCanvas });

// --- Keyframe / track helpers ---

function paramValue(layerId: string, paramName: string, fallback: number): number {
  const layer = layers.value.find((l) => l.id === layerId);
  if (!layer) return fallback;
  const track = findPropertyTrack(tracks.value, layerId, paramName);
  const base = (layer.values[paramName] as number) ?? fallback;
  return evaluatePropertyTrack(track, currentTime.value, base);
}

function toggleStopwatch(layerId: string, paramName: string) {
  const track = findPropertyTrack(tracks.value, layerId, paramName);
  if (track?.enabled) {
    tracks.value = setTrackEnabled(tracks.value, layerId, paramName, false);
    selectedKeyframes.value = selectedKeyframes.value.filter(
      (k) => !(k.layerId === layerId && k.paramName === paramName),
    );
    return;
  }
  const layer = layers.value.find((l) => l.id === layerId);
  const template = layer ? LAYER_TEMPLATES[layer.type] : null;
  const def = template?.uniforms.find((u) => u.name === paramName);
  const fallback = (def?.default as number) ?? 0;
  const value = paramValue(layerId, paramName, fallback);
  tracks.value = setTrackEnabled(
    tracks.value,
    layerId,
    paramName,
    true,
    value,
    currentTime.value,
  );
}

function setAnimatedValue(layerId: string, paramName: string, value: number) {
  tracks.value = upsertKeyframe(
    tracks.value,
    layerId,
    paramName,
    currentTime.value,
    value,
  );
}

function toggleKeyframeAtPlayhead(layerId: string, paramName: string) {
  const track = findPropertyTrack(tracks.value, layerId, paramName);
  if (!track?.enabled) return;

  if (hasKeyframeAt(track, currentTime.value)) {
    tracks.value = removeKeyframeAt(
      tracks.value,
      layerId,
      paramName,
      currentTime.value,
    );
    selectedKeyframes.value = selectedKeyframes.value.filter(
      (k) =>
        !(
          k.layerId === layerId &&
          k.paramName === paramName &&
          Math.abs(k.time - currentTime.value) < 1e-6
        ),
    );
    return;
  }

  const layer = layers.value.find((l) => l.id === layerId);
  const template = layer ? LAYER_TEMPLATES[layer.type] : null;
  const def = template?.uniforms.find((u) => u.name === paramName);
  const fallback = (def?.default as number) ?? 0;
  const value = paramValue(layerId, paramName, fallback);
  tracks.value = upsertKeyframe(
    tracks.value,
    layerId,
    paramName,
    currentTime.value,
    value,
  );
}


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
    <div ref="editorSplitRef" class="flex h-full min-h-0 flex-col">
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

      <div
        class="group flex h-1.5 shrink-0 cursor-ns-resize touch-none items-center justify-center border-t border-neutral bg-layer-1 select-none hover:bg-layer-2 active:bg-layer-2"
        title="Drag to resize timeline"
        @pointerdown="onTimelineResizePointerDown"
      >
        <div class="h-0.5 w-10 rounded-full bg-neutral-subtle transition-colors group-hover:bg-neutral-strong" />
      </div>

      <div class="shrink-0 overflow-hidden" :style="{ height: `${timelineHeight}px` }">
        <EditorTimeline
          v-model:layers="layers"
          v-model:tracks="tracks"
          v-model:selected-layer-id="selectedLayerId"
          v-model:selected-keyframes="selectedKeyframes"
          v-model:current-time="currentTime"
          v-model:playing="playing"
          v-model:px-per-second="timelineZoom"
          :settings="settings"
          @toggle-stopwatch="toggleStopwatch"
          @duplicate-layer="duplicateLayer"
          @remove-layer="removeLayer"
        />
      </div>
    </div>

    <template #right>
      <div class="flex h-full min-h-0 flex-col">
        <div class="flex shrink-0 items-center gap-2 border-b border-neutral px-2 py-2">
          <UiHover>
            <NuxtLink
              to="/"
              class="flex size-8 items-center justify-center text-neutral-subtle outline-none group-hover/h:text-neutral-strong"
              title="Shader Lab"
            >
              <ChevronRightIcon class="size-4 rotate-180" />
            </NuxtLink>
          </UiHover>
          <UiEditableText
            v-model="shaderName"
            fill
            class="min-w-0 flex-1 text-copy-sm text-neutral-strong"
          />
          <UiButton variant="filled" size="sm" @click="exportOpen = true">
            Export
          </UiButton>
        </div>

        <div class="flex shrink-0 items-center gap-0.5 border-b border-neutral px-3 py-2">
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

        <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
          <EditorLayerSettings
            v-if="selectedLayer && selectedTemplate"
            ref="layerSettingsRef"
            :key="selectedLayer.id"
            class="min-h-0 flex-1"
            :layer="selectedLayer"
          :template="selectedTemplate"
          :assignments="selectedLayerAssignments"
          :lfos="lfos"
          :dragging-lfo-id="draggingLfoId"
          :mesh-selected-point-index="meshSelectedPointIndex"
          :current-time="currentTime"
          :tracks="tracks"
          @update:mesh-selected-point-index="meshSelectedPointIndex = $event"
          @assign-lfo="assignLfo"
          @remove-assignment="removeAssignment"
          @update-depth="updateDepth"
          @toggle-stopwatch="toggleStopwatch(selectedLayer.id, $event)"
          @toggle-keyframe="toggleKeyframeAtPlayhead(selectedLayer.id, $event)"
          @set-animated-value="(param, value) => setAnimatedValue(selectedLayer!.id, param, value)"
          />
          <div
            v-else
            class="flex flex-1 items-center justify-center p-6 text-center"
          >
            <p class="text-copy-sm text-neutral-subtle">
              Select a layer to edit its properties.
            </p>
          </div>

          <EditorLfoList
            v-model:lfos="lfos"
            v-model:selected-lfo-id="selectedLfoId"
            class="max-h-48 shrink-0 border-t border-neutral"
            @drag-start="onDragStart"
            @duplicate-lfo="duplicateLfo"
            @clear-assignments="clearLfoAssignments"
            @delete-lfo="deleteLfo"
          />
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
    :composition-duration="settings.duration"
  />
</template>
