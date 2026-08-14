<script setup lang="ts">
import type { LayerInstance, LayerTemplate, LayerUniformDef, ModulationAssignment, LFOSource, PropertyTrack } from "@shader-lab/core";
import type { GradientStop, MeshPoint } from "@shader-lab/core";
import {
  applyModulation,
  evaluatePropertyTrack,
  findPropertyTrack,
  hasKeyframeAt,
  isKeyframeableUniform,
  isPropertyTrackActive,
  universalUniformsFor,
} from "@shader-lab/core";
import {
  layerBoundsInCompUv,
  type LayerTransformValues,
} from "#shared/editor/layer-transform";
import { XMarkIcon } from "@heroicons/vue/16/solid";
import { stageComponentOptions } from "~/utils/stage-components";
import { mediaSrcFileName, uploadMediaFile, type MediaUploadKind } from "~/utils/media-upload";

type Props = {
  layer: LayerInstance;
  template: LayerTemplate;
  assignments: ModulationAssignment[];
  lfos: LFOSource[];
  draggingLfoId: string | null;
  meshSelectedPointIndex?: number;
  currentTime: number;
  tracks: PropertyTrack[];
  /** Composition width/height ratio — enables the align buttons. */
  compositionAspect?: number;
};

type Emits = {
  "assign-lfo": [paramName: string];
  "remove-assignment": [sourceId: string, paramName: string];
  "update-depth": [sourceId: string, paramName: string, depth: number];
  "update:meshSelectedPointIndex": [index: number];
  "toggle-stopwatch": [paramName: string];
  "toggle-keyframe": [paramName: string];
  "set-animated-value": [paramName: string, value: number];
};

// Reactive props destructure (must happen directly on defineProps: pulling
// fields out of a `props` variable captures one-time references, which left
// the whole inspector rendering a stale layer object after undo/redo
// replaced the layers array).
const {
  layer,
  template,
  assignments,
  lfos,
  draggingLfoId,
  meshSelectedPointIndex = 0,
  tracks,
  currentTime,
  compositionAspect,
} = defineProps<Props>();
const emit = defineEmits<Emits>();

const history = useEditorHistory();

/** Options for the component layer's picker (static per session: glob-derived). */
const componentPickerOptions = stageComponentOptions();

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
  const track = findPropertyTrack(tracks, layer.id, paramName);
  if (isPropertyTrackActive(track)) {
    const base = (layer.values[paramName] as number) ?? fallback;
    return evaluatePropertyTrack(track, currentTime, base);
  }
  const base = (layer.values[paramName] as number) ?? fallback;
  const assignment = getAssignment(paramName);
  if (!assignment) return base;
  const lfoValue = lfoValues.value[assignment.sourceId] ?? 0;
  return applyModulation(base, paramName, lfoValue, assignment.depth);
}

function isTrackEnabled(paramName: string): boolean {
  return isPropertyTrackActive(findPropertyTrack(tracks, layer.id, paramName));
}

function isKeyedAtPlayhead(paramName: string): boolean {
  return hasKeyframeAt(findPropertyTrack(tracks, layer.id, paramName), currentTime);
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

/** Universal transform/opacity params shown for every layer (generators get the full set). */
const universalDefs = universalUniformsFor(layer);

// --- Universal rows (Figma-style: X/Y pairs share one labeled row) ---

type UniversalField = { def: LayerUniformDef; label: string };
type UniversalRow = {
  key: string;
  /** Rendered as a select instead of slider fields. */
  select?: LayerUniformDef;
  /** Group label above paired fields (e.g. "Position"). */
  label?: string;
  fields: UniversalField[];
};

const PAIRED_UNIVERSALS = [
  { label: "Position", x: "layerPositionX", y: "layerPositionY" },
  { label: "Anchor", x: "layerAnchorX", y: "layerAnchorY" },
];

/** Position X/Y and Anchor X/Y collapse into one two-column row each. */
const universalRows: UniversalRow[] = (() => {
  const rows: UniversalRow[] = [];
  const grouped = new Set<string>();
  for (const def of universalDefs) {
    if (grouped.has(def.name)) continue;
    const pair = PAIRED_UNIVERSALS.find((p) => p.x === def.name);
    const yDef = pair ? universalDefs.find((d) => d.name === pair.y) : undefined;
    if (pair && yDef) {
      grouped.add(pair.y);
      rows.push({
        key: pair.label,
        label: pair.label,
        fields: [
          { def, label: "X" },
          { def: yDef, label: "Y" },
        ],
      });
      continue;
    }
    if (def.type === "select") {
      rows.push({ key: def.name, select: def, fields: [] });
      continue;
    }
    rows.push({ key: def.name, fields: [{ def, label: def.label }] });
  }
  return rows;
})();

// --- Alignment (Figma-style, relative to the composition frame) ---

const isGenerator = computed(() => template.category === "generator");

function universalDef(name: string): LayerUniformDef {
  return universalDefs.find((def) => def.name === name)!;
}

function currentTransform(): LayerTransformValues {
  const get = (name: string) => {
    const def = universalDef(name);
    return getFloat(def, layer.values);
  };
  return {
    positionX: get("layerPositionX"),
    positionY: get("layerPositionY"),
    scale: get("layerScale"),
    rotation: get("layerRotation"),
    anchorX: get("layerAnchorX"),
    anchorY: get("layerAnchorY"),
  };
}

type AlignEdge = "left" | "centerX" | "right" | "top" | "centerY" | "bottom";

/** Move the layer's transformed bounds flush to the frame (comp UV is y-up). */
function alignLayer(edge: AlignEdge) {
  const aspect = compositionAspect;
  if (!aspect) return;
  const v = currentTransform();
  const bounds = layerBoundsInCompUv(v, aspect);

  let def: LayerUniformDef;
  let next: number;
  switch (edge) {
    case "left":
      def = universalDef("layerPositionX");
      next = v.positionX - bounds.minX;
      break;
    case "centerX":
      def = universalDef("layerPositionX");
      next = v.positionX + (0.5 - bounds.centerX);
      break;
    case "right":
      def = universalDef("layerPositionX");
      next = v.positionX + (1 - bounds.maxX);
      break;
    case "bottom":
      def = universalDef("layerPositionY");
      next = v.positionY - bounds.minY;
      break;
    case "centerY":
      def = universalDef("layerPositionY");
      next = v.positionY + (0.5 - bounds.centerY);
      break;
    case "top":
      def = universalDef("layerPositionY");
      next = v.positionY + (1 - bounds.maxY);
      break;
  }

  setFloat(def, layer.values, Number(next.toFixed(4)));
  history?.record();
}

/** Icon geometry, Figma-style: the alignment edge plus two object bars (14x14). */
type IconLine = { x1: number; y1: number; x2: number; y2: number };
const ALIGNMENTS: {
  id: AlignEdge;
  label: string;
  edge: IconLine;
  bars: IconLine[];
}[] = [
  {
    id: "left",
    label: "Align left",
    edge: { x1: 2.5, y1: 2, x2: 2.5, y2: 12 },
    bars: [
      { x1: 5.5, y1: 5, x2: 12, y2: 5 },
      { x1: 5.5, y1: 9, x2: 9.5, y2: 9 },
    ],
  },
  {
    id: "centerX",
    label: "Align horizontal centers",
    edge: { x1: 7, y1: 1.5, x2: 7, y2: 12.5 },
    bars: [
      { x1: 2.5, y1: 5, x2: 11.5, y2: 5 },
      { x1: 4.5, y1: 9, x2: 9.5, y2: 9 },
    ],
  },
  {
    id: "right",
    label: "Align right",
    edge: { x1: 11.5, y1: 2, x2: 11.5, y2: 12 },
    bars: [
      { x1: 2, y1: 5, x2: 8.5, y2: 5 },
      { x1: 4.5, y1: 9, x2: 8.5, y2: 9 },
    ],
  },
  {
    id: "top",
    label: "Align top",
    edge: { x1: 2, y1: 2.5, x2: 12, y2: 2.5 },
    bars: [
      { x1: 5, y1: 5.5, x2: 5, y2: 12 },
      { x1: 9, y1: 5.5, x2: 9, y2: 9.5 },
    ],
  },
  {
    id: "centerY",
    label: "Align vertical centers",
    edge: { x1: 1.5, y1: 7, x2: 12.5, y2: 7 },
    bars: [
      { x1: 5, y1: 2.5, x2: 5, y2: 11.5 },
      { x1: 9, y1: 4.5, x2: 9, y2: 9.5 },
    ],
  },
  {
    id: "bottom",
    label: "Align bottom",
    edge: { x1: 2, y1: 11.5, x2: 12, y2: 11.5 },
    bars: [
      { x1: 5, y1: 2, x2: 5, y2: 8.5 },
      { x1: 9, y1: 4.5, x2: 9, y2: 8.5 },
    ],
  },
];

function getFloat(def: LayerUniformDef, target: Record<string, unknown>): number {
  if (isTrackEnabled(def.name)) {
    return getModulatedFloat(def.name, def.default as number);
  }
  return (target[def.name] as number) ?? (def.default as number);
}

function setFloat(def: LayerUniformDef, target: Record<string, unknown>, v: number) {
  if (isTrackEnabled(def.name)) {
    emit("set-animated-value", def.name, v);
    return;
  }
  target[def.name] = v;
}

function getText(def: LayerUniformDef, target: Record<string, unknown>): string {
  return (target[def.name] as string) ?? (def.default as string);
}

function setText(def: LayerUniformDef, target: Record<string, unknown>, v: string) {
  target[def.name] = v;
  history?.record();
}

function getColor(def: LayerUniformDef, target: Record<string, unknown>): string {
  return (target[def.name] as string) ?? (def.default as string);
}

function setColor(def: LayerUniformDef, target: Record<string, unknown>, v: string) {
  target[def.name] = v;
  history?.record();
}

function getBool(def: LayerUniformDef, target: Record<string, unknown>): boolean {
  return (target[def.name] as boolean) ?? (def.default as boolean);
}

function setBool(def: LayerUniformDef, target: Record<string, unknown>, v: boolean) {
  target[def.name] = v;
  history?.record();
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
  selectPreview = null; // committed value wins; a trailing highlight-end must not revert it
  target[def.name] = v;
  history?.record();
}

// Transient hover preview for select dropdowns (e.g. blend modes): mutate the
// value without recording history, and restore the original if the dropdown
// closes without a selection. Rendering picks up the mutation immediately.
let selectPreview: { def: LayerUniformDef; target: Record<string, unknown>; original: unknown } | null = null;

function previewSelect(def: LayerUniformDef, target: Record<string, unknown>, v: string | number) {
  if (selectPreview?.def !== def) selectPreview = { def, target, original: target[def.name] };
  target[def.name] = v;
}

function endSelectPreview(def: LayerUniformDef) {
  if (selectPreview?.def !== def) return;
  if (selectPreview.original === undefined) delete selectPreview.target[def.name];
  else selectPreview.target[def.name] = selectPreview.original;
  selectPreview = null;
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
  history?.record();
}

// --- Media (image/video) source upload ---

const isMediaLayer = computed(() => layer.type === "image" || layer.type === "video");
const mediaKind = computed<MediaUploadKind>(() =>
  layer.type === "video" ? "video" : "image",
);

const mediaFileInput = ref<HTMLInputElement | null>(null);
const mediaUploading = ref(false);
const mediaUploadError = ref("");

function openMediaPicker() {
  if (mediaUploading.value) return;
  mediaUploadError.value = "";
  mediaFileInput.value?.click();
}

async function uploadMediaTo(def: LayerUniformDef, file: File) {
  const kind = mediaKind.value;
  if (!file.type.startsWith(`${kind}/`)) {
    mediaUploadError.value = `Pick a ${kind} file.`;
    return;
  }
  mediaUploading.value = true;
  mediaUploadError.value = "";
  try {
    const url = await uploadMediaFile(kind, file);
    // Same update path as the componentName special case: records history so
    // undo and auto-save both see the new src.
    setText(def, layer.values, url);
  } catch {
    mediaUploadError.value = "Upload failed. Try again.";
  } finally {
    mediaUploading.value = false;
  }
}

async function onMediaFileChange(def: LayerUniformDef, event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  // Reset so re-picking the same file fires change again.
  input.value = "";
  if (!file) return;
  await uploadMediaTo(def, file);
}

async function onMediaDrop(def: LayerUniformDef, event: DragEvent) {
  if (mediaUploading.value) return;
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  await uploadMediaTo(def, file);
}

function clearMediaSrc(def: LayerUniformDef) {
  mediaUploadError.value = "";
  setText(def, layer.values, "");
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

    <div class="flex flex-col gap-2.5 border-b border-neutral p-3">
      <span class="text-copy-sm text-secondary select-none">
        Transform
      </span>
      <div
        v-if="isGenerator && compositionAspect"
        class="flex items-center justify-between rounded-lg bg-control/40 p-0.5"
      >
        <UiTooltip
          v-for="align in ALIGNMENTS"
          :key="align.id"
          :label="align.label"
          side="top"
        >
          <button
            type="button"
            class="flex h-7 flex-1 items-center justify-center rounded-md text-neutral-subtle transition-colors hover:bg-control hover:text-neutral-strong"
            @click="alignLayer(align.id)"
          >
            <svg viewBox="0 0 14 14" class="size-3.5">
              <line
                :x1="align.edge.x1"
                :y1="align.edge.y1"
                :x2="align.edge.x2"
                :y2="align.edge.y2"
                class="stroke-current opacity-60"
                stroke-width="1.2"
                stroke-linecap="round"
              />
              <line
                v-for="(bar, i) in align.bars"
                :key="i"
                :x1="bar.x1"
                :y1="bar.y1"
                :x2="bar.x2"
                :y2="bar.y2"
                class="stroke-current"
                stroke-width="2"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </UiTooltip>
      </div>
      <template v-for="row in universalRows" :key="`universal-${row.key}`">
        <UiSelect
          v-if="row.select"
          :model-value="getSelect(row.select, layer.values) as string | number"
          :options="row.select.options ?? []"
          :label="row.select.label"
          @update:model-value="setSelect(row.select, layer.values, $event as string | number)"
          @select="setSelect(row.select, layer.values, $event)"
          @highlight="previewSelect(row.select, layer.values, $event)"
          @highlight-end="endSelectPreview(row.select)"
        />
        <div v-else class="flex flex-col gap-1">
          <span v-if="row.label" class="text-copy-sm text-secondary select-none">
            {{ row.label }}
          </span>
          <div class="grid gap-1.5" :class="row.fields.length > 1 ? 'grid-cols-2' : 'grid-cols-1'">
            <UiContextMenu v-for="field in row.fields" :key="field.def.name">
              <div @pointerup="draggingLfoId && emit('assign-lfo', field.def.name)">
                <UiSliderField
                  :model-value="getFloat(field.def, layer.values)"
                  :label="field.label"
                  :min="field.def.min"
                  :max="field.def.max"
                  :step="field.def.step ?? 0.01"
                  :mod-color="isTrackEnabled(field.def.name) ? undefined : getModInfo(field.def)?.color"
                  :mod-depth="isTrackEnabled(field.def.name) ? undefined : getModInfo(field.def)?.depth"
                  :mod-live-value="isTrackEnabled(field.def.name) ? undefined : getLiveValue(field.def)"
                  :is-drop-target="draggingLfoId !== null && !isTrackEnabled(field.def.name)"
                  :animatable="isKeyframeableUniform(field.def)"
                  :track-enabled="isTrackEnabled(field.def.name)"
                  :keyed-at-playhead="isKeyedAtPlayhead(field.def.name)"
                  @update:model-value="setFloat(field.def, layer.values, $event)"
                  @update:mod-depth="onDepthUpdate(field.def, $event)"
                  @toggle-track="emit('toggle-stopwatch', field.def.name)"
                  @toggle-keyframe="emit('toggle-keyframe', field.def.name)"
                />
              </div>
              <template #menu>
                <UiContextMenuItem @click="resetUniform(field.def)">Reset to default</UiContextMenuItem>
                <template v-if="getAssignment(field.def.name)">
                  <UiContextMenuSeparator />
                  <UiContextMenuItem @click="emit('remove-assignment', getAssignment(field.def.name)!.sourceId, field.def.name)">
                    Remove {{ lfos.find(l => l.id === getAssignment(field.def.name)!.sourceId)?.label }}
                  </UiContextMenuItem>
                </template>
              </template>
            </UiContextMenu>
          </div>
        </div>
      </template>
    </div>

    <div class="flex flex-col gap-2.5 p-3">
      <template v-for="def in template.uniforms" :key="def.name">
        <template v-if="isUniformVisible(def)">
          <UiSelect
            v-if="layer.type === 'component' && def.name === 'componentName'"
            :model-value="getText(def, layer.values)"
            :options="componentPickerOptions"
            :label="def.label"
            @update:model-value="setText(def, layer.values, String($event))"
          />
          <div
            v-else-if="isMediaLayer && def.name === 'src'"
            class="flex flex-col gap-1"
          >
            <span class="text-copy-xs text-neutral-subtle">{{ def.label }}</span>
            <input
              ref="mediaFileInput"
              type="file"
              class="hidden"
              :accept="mediaKind === 'video' ? 'video/*' : 'image/*'"
              @change="onMediaFileChange(def, $event)"
            >
            <div
              v-if="getText(def, layer.values)"
              class="flex items-center gap-1.5"
              @dragover.prevent
              @drop.prevent="onMediaDrop(def, $event)"
            >
              <span
                class="h-7 min-w-0 flex-1 truncate rounded-lg bg-control px-2.5 leading-7 text-copy-sm text-neutral-strong"
                :title="getText(def, layer.values)"
              >
                {{ mediaSrcFileName(getText(def, layer.values)) }}
              </span>
              <UiButton
                variant="secondary"
                size="sm"
                :loading="mediaUploading"
                :disabled="mediaUploading"
                class="shrink-0"
                @click="openMediaPicker"
              >
                {{ mediaUploading ? "Uploading…" : "Replace" }}
              </UiButton>
              <UiButton
                variant="ghost"
                size="sm"
                :disabled="mediaUploading"
                :icon-left="XMarkIcon"
                title="Remove"
                class="shrink-0"
                @click="clearMediaSrc(def)"
              />
            </div>
            <button
              v-else
              type="button"
              :disabled="mediaUploading"
              class="flex h-16 w-full items-center justify-center rounded-lg border border-dashed border-neutral bg-control/40 text-copy-sm text-neutral-subtle transition-colors hover:bg-control hover:text-neutral-strong disabled:cursor-not-allowed disabled:opacity-60"
              @click="openMediaPicker"
              @dragover.prevent
              @drop.prevent="onMediaDrop(def, $event)"
            >
              {{ mediaUploading ? "Uploading…" : mediaKind === "video" ? "Upload video" : "Upload image" }}
            </button>
            <span v-if="mediaUploadError" class="text-copy-xs text-red-400">
              {{ mediaUploadError }}
            </span>
          </div>
          <UiContextMenu v-else-if="def.type === 'float' || def.type === 'int'">
            <div @pointerup="draggingLfoId && emit('assign-lfo', def.name)">
              <UiSliderField
                :model-value="getFloat(def, layer.values)"
                :label="def.label"
                :min="def.min"
                :max="def.max"
                :step="def.step ?? (def.type === 'int' ? 1 : 0.01)"
                :mod-color="isTrackEnabled(def.name) ? undefined : getModInfo(def)?.color"
                :mod-depth="isTrackEnabled(def.name) ? undefined : getModInfo(def)?.depth"
                :mod-live-value="isTrackEnabled(def.name) ? undefined : getLiveValue(def)"
                :is-drop-target="draggingLfoId !== null && !isTrackEnabled(def.name)"
                :animatable="isKeyframeableUniform(def)"
                :track-enabled="isTrackEnabled(def.name)"
                :keyed-at-playhead="isKeyedAtPlayhead(def.name)"
                @update:model-value="setFloat(def, layer.values, $event)"
                @update:mod-depth="onDepthUpdate(def, $event)"
                @toggle-track="emit('toggle-stopwatch', def.name)"
                @toggle-keyframe="emit('toggle-keyframe', def.name)"
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
          <div v-else-if="def.type === 'text'" class="flex flex-col gap-1">
            <span class="text-copy-xs text-neutral-subtle">{{ def.label }}</span>
            <textarea
              :value="getText(def, layer.values)"
              rows="2"
              spellcheck="false"
              class="w-full resize-y rounded-lg bg-control px-2.5 py-2 font-sans text-copy-sm text-neutral-strong outline-none focus:ring-1 focus:ring-accent/50"
              @change="setText(def, layer.values, ($event.target as HTMLTextAreaElement).value)"
            />
          </div>
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
            @select="setSelect(def, layer.values, $event)"
            @highlight="previewSelect(def, layer.values, $event)"
            @highlight-end="endSelectPreview(def)"
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
