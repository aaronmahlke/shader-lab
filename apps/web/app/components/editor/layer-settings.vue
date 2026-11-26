<script setup lang="ts">
import { layerStudioIcon } from "~/utils/layer-icons";
import { BUILT_IN_CURSORS, builtInCursor, cursorAnchor } from "#shared/editor/cursors";
import type { LayerInstance, LayerTemplate, LayerUniformDef, ModulationAssignment, LFOSource, PropertyTrack } from "@shader-lab/core";
import type { GradientStop, MeshPoint } from "@shader-lab/core";
import {
  isZeroBaseDisabled,
  linkTrackLayerId,
  ATTACH_POINTS,
  attachPointsFor,
  canParent,
  LAYER_TEMPLATES,
  upsertKeyframe,
  evaluatePropertyTrack,
  findPropertyTrack,
  hasKeyframeAt,
  isKeyframeableUniform,
  isLayer3D,
  isPropertyTrackActive,
  supports3D,
  universalUniformsFor,
} from "@shader-lab/core";
import {
  layerBoundsInCompUv,
  type LayerTransformValues,
} from "#shared/editor/layer-transform";
import { linkedParams } from "#shared/editor/position-group";
import { ArrowRightCircleIcon, EyeIcon, EyeSlashIcon, XMarkIcon } from "@heroicons/vue/16/solid";
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
  /** Parent layer (null = none) and optional attach point on it (e.g. "textEnd"). */
  "set-parent": [parentId: string | null, point: string | null];
  "update:meshSelectedPointIndex": [index: number];
  "toggle-stopwatch": [paramName: string];
  "toggle-keyframe": [paramName: string];
  "set-animated-value": [paramName: string, value: number];
  /** Make this setting a comp prop (settable per precomp instance). */
  "expose-prop": [paramName: string, label: string];
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

/** Same mutation + history path the timeline eye button uses (`enabled` is a
 * top-level layer field the inspector may mutate directly, like `values`). */
function toggleLayerEnabled() {
  layer.enabled = !layer.enabled;
  history?.record();
}

/** Options for the component layer's picker (static per session: glob-derived). */
const componentPickerOptions = computed(() => stageComponentOptions());

/**
 * Options for the composition layer's `compRefId` select: the project's other
 * comps (id → name), provided by the editor page (excludes the open comp).
 */
const compRefOptions = inject<Ref<{ value: string; label: string }[]>>(
  "compRefOptions",
  ref([]),
);

/** AE-style "enter the precomp": navigate to the referenced composition. */
function openReferencedComposition() {
  const compId = layer.values.compRefId;
  if (typeof compId === "string" && compId) navigateTo(`/shader/${compId}`);
}

function getAssignment(paramName: string): ModulationAssignment | undefined {
  return assignments.find((a) => a.layerId === layer.id && a.paramName === paramName);
}

const lfoValues = inject<Ref<Record<string, number>>>("lfoValues", ref({}));

function getLiveValue(def: LayerUniformDef): number | undefined {
  const assignment = getAssignment(def.name);
  if (!assignment) return undefined;
  return lfoValues.value[assignment.sourceId];
}

/** Link amount at the playhead (keyframed `link:<key>` depth track, else the static depth). */
function linkDepth(assignment: ModulationAssignment): number {
  const track = findPropertyTrack(tracks, linkTrackLayerId(assignment), "depth");
  return evaluatePropertyTrack(track, currentTime, assignment.depth);
}

function linkOn(assignment: ModulationAssignment): boolean {
  const track = findPropertyTrack(tracks, linkTrackLayerId(assignment), "enabled");
  return evaluatePropertyTrack(track, currentTime, assignment.enabled === false ? 0 : 1) >= 0.5;
}

/** Keyframes set the base, links stack on top (same as the renderer). */
function getModulatedFloat(paramName: string, fallback: number): number {
  const track = findPropertyTrack(tracks, layer.id, paramName);
  const staticBase = (layer.values[paramName] as number) ?? fallback;
  const base = isPropertyTrackActive(track)
    ? evaluatePropertyTrack(track, currentTime, staticBase)
    : staticBase;
  const links = assignments.filter((a) => a.layerId === layer.id && a.paramName === paramName);
  if (links.length === 0) return base;
  if (isZeroBaseDisabled(paramName, base)) return 0;
  let value = base;
  for (const link of links) {
    if (!linkOn(link)) continue;
    value += (lfoValues.value[link.sourceId] ?? 0) * linkDepth(link);
  }
  return value;
}

/** Animated? Linked position axes count as one property (AE). */
function isTrackEnabled(paramName: string): boolean {
  return linkedParams(layer, paramName).some((p) =>
    isPropertyTrackActive(findPropertyTrack(tracks, layer.id, p)),
  );
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
  return { color, depth: linkDepth(assignment) };
}

const editorTracks = inject<Ref<PropertyTrack[]> | null>("editorTracks", null);
const editorSettings = inject<Ref<{ width: number; height: number }> | null>("editorSettings", null);

/** Animated amount (stopwatch on in the timeline): key the playhead instead of the static depth. */
function onDepthUpdate(def: LayerUniformDef, depth: number) {
  const assignment = getAssignment(def.name);
  if (!assignment) return;
  const owner = linkTrackLayerId(assignment);
  if (editorTracks && isPropertyTrackActive(findPropertyTrack(tracks, owner, "depth"))) {
    editorTracks.value = upsertKeyframe(editorTracks.value, owner, "depth", currentTime, depth);
    return;
  }
  emit("update-depth", assignment.sourceId, def.name, depth);
}

/** Universal transform/opacity params shown for every layer (generators get the full set).
 * Computed: the def list changes when the layer's 3D switch flips. */
const universalDefs = computed(() => universalUniformsFor(layer));

/** Same direct-mutation + history path as toggleLayerEnabled (`is3D` is a top-level layer field). */
function setLayer3D(value: boolean) {
  layer.is3D = value;
  history?.record();
}

// --- Universal rows (Figma-style: X/Y[/Z] groups share one labeled row) ---

type UniversalField = { def: LayerUniformDef; label: string };
type UniversalRow = {
  key: string;
  /** Rendered as a select instead of slider fields. */
  select?: LayerUniformDef;
  /** Group label above paired fields (e.g. "Position"). */
  label?: string;
  fields: UniversalField[];
};

/** Members render in listed order once every member def exists on the layer. */
type UniversalGroup = { key: string; label: string; members: Array<{ name: string; label: string }> };

const UNIVERSAL_GROUPS_2D: UniversalGroup[] = [
  {
    key: "position",
    label: "Position",
    members: [
      { name: "layerPositionX", label: "X" },
      { name: "layerPositionY", label: "Y" },
    ],
  },
  {
    key: "anchor",
    label: "Anchor",
    members: [
      { name: "layerAnchorX", label: "X" },
      { name: "layerAnchorY", label: "Y" },
    ],
  },
];

/**
 * 3D layout: X/Y pairs with a full-width Z row underneath (three narrow
 * columns collide with the in-track value display at inspector width).
 */
const UNIVERSAL_GROUPS_3D: UniversalGroup[] = [
  UNIVERSAL_GROUPS_2D[0]!,
  {
    key: "positionZ",
    label: "",
    members: [{ name: "layerPositionZ", label: "Z" }],
  },
  {
    key: "rotation",
    label: "Rotation",
    members: [
      { name: "layerRotationX", label: "X" },
      { name: "layerRotationY", label: "Y" },
    ],
  },
  {
    key: "rotationZ",
    label: "",
    members: [{ name: "layerRotation", label: "Z" }],
  },
  UNIVERSAL_GROUPS_2D[1]!,
];

const APPEARANCE_UNIVERSALS = new Set(["layerOpacity", "layerBlur", "layerBlendMode", "layerAcceptsLight"]);

/** Position X/Y(/Z), Rotation X/Y/Z (3D) and Anchor X/Y collapse into one multi-column row each. */
const universalRows = computed<UniversalRow[]>(() => {
  const defs = universalDefs.value;
  const groups = isLayer3D(layer) ? UNIVERSAL_GROUPS_3D : UNIVERSAL_GROUPS_2D;
  const rows: UniversalRow[] = [];
  const grouped = new Set<string>();
  for (const def of defs) {
    if (grouped.has(def.name)) continue;
    const group = groups.find((g) => g.members.some((m) => m.name === def.name));
    if (group) {
      const fields: UniversalField[] = [];
      for (const member of group.members) {
        const memberDef = defs.find((d) => d.name === member.name);
        if (memberDef) fields.push({ def: memberDef, label: member.label });
      }
      if (fields.length === group.members.length) {
        for (const member of group.members) grouped.add(member.name);
        rows.push({ key: group.key, label: group.label, fields });
        continue;
      }
    }
    if (def.type === "select") {
      rows.push({ key: def.name, select: def, fields: [] });
      continue;
    }
    rows.push({ key: def.name, fields: [{ def, label: def.label }] });
  }
  return rows;
});

const transformRows = computed(() =>
  universalRows.value.filter(
    (row) => !APPEARANCE_UNIVERSALS.has(row.select?.name ?? row.fields[0]?.def.name ?? ""),
  ),
);
const appearanceRows = computed(() =>
  universalRows.value.filter(
    (row) => APPEARANCE_UNIVERSALS.has(row.select?.name ?? row.fields[0]?.def.name ?? ""),
  ),
);

// --- Alignment (Figma-style, relative to the composition frame) ---

const isGenerator = computed(() => template.category === "generator");

// --- Parenting ---

const editorLayers = inject<Ref<LayerInstance[]> | null>("editorLayers", null);
const editorProjectId = inject<Ref<string | null> | null>("editorProjectId", null);
const NO_PARENT = "__none__";
const ANCHOR_POINT = "__anchor__";

const parentOptions = computed(() => {
  const all = editorLayers?.value ?? [];
  return all
    .filter((l) => l.id !== layer.id && canParent(all, layer.id, l.id))
    .map((l) => ({ label: l.name ?? LAYER_TEMPLATES[l.type]?.label ?? l.type, value: l.id, icon: layerStudioIcon(l.type) }));
});

const parentLayer = computed(() =>
  layer.parent ? editorLayers?.value.find((l) => l.id === layer.parent) : undefined,
);

const attachOptions = computed(() => {
  if (!parentLayer.value) return [];
  const points = attachPointsFor(parentLayer.value);
  if (points.length === 0) return [];
  return [
    { label: "Layer", value: ANCHOR_POINT },
    ...points.map((p) => ({ label: ATTACH_POINTS[p].label, value: p })),
  ];
});

function onParentChange(value: string | number) {
  const id = String(value);
  emit("set-parent", id === NO_PARENT ? null : id, null);
}

function onAttachChange(value: string | number) {
  const point = String(value);
  emit("set-parent", layer.parent ?? null, point === ANCHOR_POINT ? null : point);
}

function universalDef(name: string): LayerUniformDef {
  return universalDefs.value.find((def) => def.name === name)!;
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
  // No-op while a gesture is active (stop/color drags); records discrete edits.
  history?.record();
}

function getMeshPoints(def: LayerUniformDef, target: Record<string, unknown>): MeshPoint[] {
  return (target[def.name] as MeshPoint[]) ?? (def.default as MeshPoint[]);
}

function setMeshPoints(def: LayerUniformDef, target: Record<string, unknown>, v: MeshPoint[]) {
  target[def.name] = v;
  history?.record();
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
  history?.record();
}

function setVec2Y(def: LayerUniformDef, target: Record<string, unknown>, y: number) {
  const c = getVec2(def, target);
  target[def.name] = [c[0], y];
  history?.record();
}

function resetUniform(def: LayerUniformDef) {
  layer.values[def.name] = def.default;
  history?.record();
}

// --- Media (image/video) source upload ---

const isMediaLayer = computed(() => layer.type === "image" || layer.type === "video" || layer.type === "audio");
const mediaKind = computed<MediaUploadKind>(() =>
  layer.type === "video" ? "video" : layer.type === "audio" ? "audio" : "image",
);
/** Audio layers have no picture: no Transform / Appearance sections. */
const isAudio = computed(() => layer.type === "audio");

// Pointer: components pick one (same comp); cursor images pick a built-in graphic.
const pointerOptions = computed(() =>
  (editorLayers?.value ?? [])
    .filter((l) => l.type === "pointer")
    .map((l) => ({ label: l.name ?? "Pointer", value: l.id, icon: "cursor" as const })),
);
const componentRefOptions = computed(() =>
  componentPickerOptions.value.map((o) => ({ ...o, value: String(o.value), icon: "component" as const })),
);
const compRefFieldOptions = computed(() => compRefOptions.value.map((o) => ({ ...o, icon: "comp" as const })));
const CURSOR_OPTIONS = BUILT_IN_CURSORS.map((c) => ({ label: c.label, value: c.src }));
const isBuiltInCursor = computed(
  () => layer.type === "image" && typeof layer.values.src === "string" && layer.values.src.startsWith("/cursors/"),
);
/** Old (v1) cursors: centered art; show which one in the picker. */
const cursorPickerValue = computed(() => {
  const src = String(layer.values.src ?? "");
  return builtInCursor(src)?.src ?? src.replace("/cursors/", "/cursors/v2/");
});

/**
 * Switch the built-in cursor: real size, anchor on the new tip, and position
 * (static + keys) shifted so the tip stays exactly where it was.
 */
function pickCursor(src: string) {
  const next = builtInCursor(src);
  if (!next) return;
  const comp = editorSettings?.value ?? { width: 1920, height: 1080 };
  const a = cursorAnchor(next, comp);
  const oldX = Number(layer.values.layerAnchorX ?? 0.5);
  const oldY = Number(layer.values.layerAnchorY ?? 0.5);
  const dx = oldX - a.x;
  const dy = oldY - a.y;
  layer.values.src = next.src;
  layer.values.layerScale = 100;
  layer.values.layerAnchorX = a.x;
  layer.values.layerAnchorY = a.y;
  layer.values.layerPositionX = Number(layer.values.layerPositionX ?? 0) + dx;
  layer.values.layerPositionY = Number(layer.values.layerPositionY ?? 0) + dy;
  for (const t of editorTracks?.value ?? []) {
    if (t.layerId !== layer.id) continue;
    if (t.paramName === "layerPositionX") for (const k of t.keys) k.value += dx;
    if (t.paramName === "layerPositionY") for (const k of t.keys) k.value += dy;
    if (t.paramName === "layerScale") t.enabled = false;
  }
  history?.record();
}

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
    const url = await uploadMediaFile(kind, file, editorProjectId?.value);
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

const CLONER_GRID_PARAMS = new Set(["countX", "countY", "countZ", "spacingX", "spacingY", "spacingZ"]);
const CLONER_RING_PARAMS = new Set(["radialCount", "radialRadius", "radialPlane"]);

function isUniformVisible(def: LayerUniformDef): boolean {
  if (layer.type === "cloner") {
    const ring = Number(layer.values.layout ?? 0) === 1;
    if (CLONER_GRID_PARAMS.has(def.name)) return !ring;
    if (CLONER_RING_PARAMS.has(def.name)) return ring;
    if (def.name === "seed") return Number(layer.values.order ?? 0) === 1 || Number(layer.values.staggerOrder ?? 0) === 4;
    if (def.name === "staggerOrder") return Number(layer.values.stagger ?? 0) > 0;
    return true;
  }
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

    <EditorInspectorSection v-if="!isAudio" title="Transform">
      <template v-if="supports3D(layer)" #actions>
        <UiToggle
          label="3D"
          :model-value="!!layer.is3D"
          title="3D layer"
          @update:model-value="setLayer3D"
        />
      </template>
      <div v-if="isGenerator" class="flex gap-1.5">
        <StudioRefField
          class="min-w-0 flex-1"
          kind="layer"
          :model-value="layer.parent ?? ''"
          :options="parentOptions"
          label="Parent"
          @update:model-value="onParentChange($event || NO_PARENT)"
        />
        <UiSelect
          v-if="attachOptions.length"
          class="min-w-0 flex-1"
          :model-value="layer.parentPoint ?? ANCHOR_POINT"
          :options="attachOptions"
          label="Attach to"
          @update:model-value="onAttachChange"
        />
      </div>
      <div
        v-if="isGenerator && compositionAspect"
        class="flex items-center gap-[2px]"
      >
        <UiTooltip
          v-for="align in ALIGNMENTS"
          :key="align.id"
          :label="align.label"
          side="top"
        >
          <button
            type="button"
            class="flex h-[var(--s-ctl)] flex-1 cursor-default items-center justify-center bg-[var(--s-inset)] text-[var(--s-txt)] shadow-[inset_0_0_0_1px_var(--s-edge)] hover:bg-[var(--s-inset-hover)] hover:text-[var(--s-bright)]"
            @click="alignLayer(align.id)"
          >
            <svg viewBox="0 0 14 14" class="size-3">
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
      <template v-for="row in transformRows" :key="`universal-${row.key}`">
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
          <span v-if="row.label" class="select-none text-[var(--s-dim)]">
            {{ row.label }}
          </span>
          <div
            class="grid gap-1.5"
            :class="
              row.fields.length === 3
                ? 'grid-cols-3'
                : row.fields.length > 1
                  ? 'grid-cols-2'
                  : 'grid-cols-1'
            "
          >
            <UiContextMenu v-for="field in row.fields" :key="field.def.name">
              <div @pointerup="draggingLfoId && emit('assign-lfo', field.def.name)">
                <UiSliderField
                  :model-value="getFloat(field.def, layer.values)"
                  :label="field.label"
                  :min="field.def.min"
                  :max="field.def.max"
                  :step="field.def.step ?? 0.01"
                  :mod-color="getModInfo(field.def)?.color"
                  :mod-depth="getModInfo(field.def)?.depth"
                  :mod-live-value="getLiveValue(field.def)"
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
                <UiContextMenuItem @click="emit('expose-prop', field.def.name, field.label || field.def.label)">Expose as prop</UiContextMenuItem>
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
    </EditorInspectorSection>

    <EditorInspectorSection v-if="!isAudio && layer.type !== 'pointer'" title="Appearance">
      <template #actions>
        <UiButton
          variant="ghost"
          size="sm"
          class="!size-6"
          :icon-left="layer.enabled ? EyeIcon : EyeSlashIcon"
          :title="layer.enabled ? 'Hide layer' : 'Show layer'"
          @click="toggleLayerEnabled"
        />
      </template>
      <template v-for="row in appearanceRows" :key="`universal-${row.key}`">
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
          <div class="grid gap-1.5 grid-cols-1">
            <UiContextMenu v-for="field in row.fields" :key="field.def.name">
              <div @pointerup="draggingLfoId && emit('assign-lfo', field.def.name)">
                <UiSliderField
                  :model-value="getFloat(field.def, layer.values)"
                  :label="field.def.label"
                  :min="field.def.min"
                  :max="field.def.max"
                  :step="field.def.step ?? 0.01"
                  :mod-color="getModInfo(field.def)?.color"
                  :mod-depth="getModInfo(field.def)?.depth"
                  :mod-live-value="getLiveValue(field.def)"
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
                <UiContextMenuItem @click="emit('expose-prop', field.def.name, field.label || field.def.label)">Expose as prop</UiContextMenuItem>
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
    </EditorInspectorSection>

    <EditorCompPropsFields v-if="layer.type === 'composition'" :layer="layer" />

    <EditorInspectorSection :title="template.label">
      <template v-for="def in template.uniforms" :key="def.name">
        <template v-if="isUniformVisible(def)">
          <EditorLayerRefsField
            v-if="def.type === 'layerRefs'"
            :model-value="Array.isArray(layer.values[def.name]) ? (layer.values[def.name] as string[]) : []"
            :label="def.label"
            :owner-id="layer.id"
            @update:model-value="layer.values[def.name] = $event"
          />
          <StudioRefField
            v-else-if="layer.type === 'component' && def.name === 'pointer'"
            kind="layer"
            :model-value="(layer.values.pointer as string) || ''"
            :options="pointerOptions"
            :label="def.label"
            @update:model-value="setText(def, layer.values, $event)"
          />
          <StudioRefField
            v-else-if="layer.type === 'component' && def.name === 'componentName'"
            kind="component"
            :model-value="getText(def, layer.values)"
            :options="componentRefOptions"
            :label="def.label"
            :clearable="false"
            placeholder="Pick a component…"
            @update:model-value="setText(def, layer.values, $event)"
          />
          <div
            v-else-if="layer.type === 'composition' && def.name === 'compRefId'"
            class="flex items-center gap-1.5"
          >
            <StudioRefField
              class="min-w-0 flex-1"
              kind="comp"
              :model-value="(getSelect(def, layer.values) as string) || ''"
              :options="compRefFieldOptions"
              :label="def.label"
              :clearable="false"
              placeholder="Pick a composition…"
              @update:model-value="setSelect(def, layer.values, $event)"
            />
            <UiButton
              v-if="layer.values.compRefId"
              variant="ghost"
              size="sm"
              class="!size-7 shrink-0"
              :icon-left="ArrowRightCircleIcon"
              title="Open composition"
              @click="openReferencedComposition"
            />
          </div>
          <UiSelect
            v-else-if="isBuiltInCursor && def.name === 'src'"
            :model-value="cursorPickerValue"
            :options="CURSOR_OPTIONS"
            label="Cursor"
            @update:model-value="pickCursor(String($event))"
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
              :accept="`${mediaKind}/*`"
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
              {{ mediaUploading ? "Uploading…" : `Upload ${mediaKind}` }}
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
                :mod-color="getModInfo(def)?.color"
                :mod-depth="getModInfo(def)?.depth"
                :mod-live-value="getLiveValue(def)"
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
              <UiContextMenuItem @click="emit('expose-prop', def.name, def.label)">Expose as prop</UiContextMenuItem>
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
            :label="def.label === template.label ? undefined : def.label"
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
    </EditorInspectorSection>
  </div>
</template>
