import type { CloneInfo, LayerInstance } from "../types/editor";

/**
 * Cloners: one layer that lays out copies of its source layers (MoGraph-style).
 *
 * Expansion is virtual: copies are synthesized `LayerInstance`s (id
 * `${clonerId}~${index}`) that share their source's `values` object, so
 * content edits and source keyframes show up live. A copy's transform comes
 * from the cloner (its animated transform + the layout offset for that
 * index), evaluated in the modulation fn — never from the source.
 *
 * Copies are always 3D and replace the cloner at its spot in the stack, so
 * effectors, depth sorting and lights treat them like any other 3D layer.
 * Source layers used by an enabled cloner don't render on their own.
 */

export const CLONE_SEP = "~";

export const CLONER_LAYOUT_GRID = 0;
export const CLONER_LAYOUT_RADIAL = 1;

export const STAGGER_IN_ORDER = 0;
export const STAGGER_REVERSE = 1;
export const STAGGER_FROM_CENTER = 2;
export const STAGGER_FROM_EDGES = 3;
export const STAGGER_RANDOM = 4;

/** Upper bound on copies per cloner (each is a composite pass). */
export const MAX_CLONES = 400;

/** Transform params a copy takes from its cloner (+ layout), not its source. */
export const CLONE_TRANSFORM_PARAMS = new Set([
  "layerPositionX",
  "layerPositionY",
  "layerPositionZ",
  "layerRotationX",
  "layerRotationY",
  "layerRotation",
  "layerScale",
  "layerOpacity",
]);

export function cloneId(clonerId: string, index: number): string {
  return `${clonerId}${CLONE_SEP}${index}`;
}

/** Shared content pass id for every copy of `sourceId` in a cloner. */
export function cloneContentPassId(clonerId: string, sourceId: string): string {
  return `${clonerId}${CLONE_SEP}src${CLONE_SEP}${sourceId}`;
}

function num(values: Record<string, unknown>, name: string, fallback: number): number {
  const raw = values[name];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

/** Source layer ids a cloner references (existing, non-control layers only). */
export function clonerSourceIds(cloner: LayerInstance, byId: Map<string, LayerInstance>): string[] {
  const raw = cloner.values.sources;
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => {
    if (typeof id !== "string" || id === cloner.id) return false;
    const layer = byId.get(id);
    return !!layer && layer.type !== "cloner" && layer.type !== "effector" && layer.type !== "camera";
  });
}

/** Deterministic 0..1 hash for random source order. */
function hash01(index: number, seed: number): number {
  let h = (index * 374761393 + seed * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Layout slots (index → grid cell or ring angle) for a cloner. */
function layoutSlots(cloner: LayerInstance): Omit<CloneInfo, "clonerId" | "sourceId" | "index">[] {
  const v = cloner.values;
  if (num(v, "layout", CLONER_LAYOUT_GRID) === CLONER_LAYOUT_RADIAL) {
    const count = Math.max(1, Math.min(MAX_CLONES, Math.round(num(v, "radialCount", 8))));
    return Array.from({ length: count }, (_, i) => ({ grid: [0, 0, 0] as [number, number, number], angle: (i / count) * Math.PI * 2 }));
  }
  const cx = Math.max(1, Math.round(num(v, "countX", 3)));
  const cy = Math.max(1, Math.round(num(v, "countY", 3)));
  const cz = Math.max(1, Math.round(num(v, "countZ", 1)));
  const slots: Omit<CloneInfo, "clonerId" | "sourceId" | "index">[] = [];
  // Centered cell coordinates; Y top → bottom, X left → right, Z back → front.
  for (let z = 0; z < cz; z++) {
    for (let y = 0; y < cy; y++) {
      for (let x = 0; x < cx; x++) {
        if (slots.length >= MAX_CLONES) return slots;
        slots.push({
          grid: [x - (cx - 1) / 2, (cy - 1) / 2 - y, z - (cz - 1) / 2],
          angle: null,
        });
      }
    }
  }
  return slots;
}

/**
 * Stagger rank per copy (0 plays first; copy n plays the keys rank × stagger
 * seconds later). Center/edge distances are in layout cells (ring: steps
 * from the first copy), so neighbours stay one stagger step apart.
 */
function staggerRanks(slots: Omit<CloneInfo, "clonerId" | "sourceId" | "index">[], order: number, seed: number): number[] {
  const n = slots.length;
  const dist = (i: number) => {
    const s = slots[i]!;
    if (s.angle !== null) return Math.min(i, n - i);
    return Math.hypot(s.grid[0], s.grid[1], s.grid[2]);
  };
  switch (order) {
    case STAGGER_REVERSE:
      return slots.map((_, i) => n - 1 - i);
    case STAGGER_FROM_CENTER: {
      const d = slots.map((_, i) => dist(i));
      const min = Math.min(...d);
      return d.map((v) => v - min);
    }
    case STAGGER_FROM_EDGES: {
      const d = slots.map((_, i) => dist(i));
      const max = Math.max(...d);
      return d.map((v) => max - v);
    }
    case STAGGER_RANDOM:
      return slots.map((_, i) => hash01(i, seed + 7919) * (n - 1));
    default:
      return slots.map((_, i) => i);
  }
}

export type ClonerExpansion = {
  /** Stack to render: cloners replaced by their copies, used sources removed. */
  renderLayers: LayerInstance[];
  /** Every layer (originals + copies) by id. */
  byId: Map<string, LayerInstance>;
};

function structureKey(layers: readonly LayerInstance[]): string {
  let key = "";
  for (const l of layers) {
    key += `${l.id}:${l.type}:${l.enabled ? 1 : 0}|`;
    if (l.type === "cloner") {
      const v = l.values;
      key += `[${JSON.stringify(v.sources ?? [])},${v.layout},${v.countX},${v.countY},${v.countZ},${v.radialCount},${v.order},${v.seed},${v.staggerOrder},${l.timing?.in},${l.timing?.out}]`;
    }
  }
  return key;
}

const cache = new WeakMap<readonly LayerInstance[], { key: string; expansion: ClonerExpansion }>();

/**
 * Expand cloners. Cached per layers array + structure (ids, cloner layout
 * settings), so it's cheap to call every frame; copies share source `values`
 * so value edits never need a re-expansion.
 */
export function expandCloners(layers: readonly LayerInstance[]): ClonerExpansion {
  const key = structureKey(layers);
  const hit = cache.get(layers);
  if (hit && hit.key === key) return hit.expansion;

  const byId = new Map<string, LayerInstance>(layers.map((l) => [l.id, l]));
  const hasCloner = layers.some((l) => l.type === "cloner");
  if (!hasCloner) {
    const expansion = { renderLayers: [...layers], byId };
    cache.set(layers, { key, expansion });
    return expansion;
  }

  const usedSources = new Set<string>();
  for (const layer of layers) {
    if (layer.type === "cloner" && layer.enabled) {
      for (const id of clonerSourceIds(layer, byId)) usedSources.add(id);
    }
  }

  const renderLayers: LayerInstance[] = [];
  for (const layer of layers) {
    if (usedSources.has(layer.id)) continue;
    if (layer.type !== "cloner") {
      renderLayers.push(layer);
      continue;
    }
    const sources = clonerSourceIds(layer, byId);
    if (sources.length === 0) continue;
    const random = num(layer.values, "order", 0) === 1;
    const seed = Math.round(num(layer.values, "seed", 1));
    const slots = layoutSlots(layer);
    const ranks = staggerRanks(slots, Math.round(num(layer.values, "staggerOrder", STAGGER_IN_ORDER)), seed);
    slots.forEach((slot, index) => {
      const pick = random ? Math.floor(hash01(index, seed) * sources.length) : index % sources.length;
      const source = byId.get(sources[pick]!)!;
      const copy: LayerInstance = {
        id: cloneId(layer.id, index),
        type: source.type,
        name: `${layer.name ?? "Cloner"} ${index + 1}`,
        enabled: layer.enabled,
        is3D: true,
        values: source.values,
        timing: layer.timing,
        clone: { clonerId: layer.id, sourceId: source.id, index, ...slot, staggerRank: ranks[index] },
      };
      renderLayers.push(copy);
      byId.set(copy.id, copy);
    });
  }

  const expansion = { renderLayers, byId };
  cache.set(layers, { key, expansion });
  return expansion;
}

/** Find any layer (including cloner copies) by id. */
export function resolveLayerById(layers: readonly LayerInstance[], id: string): LayerInstance | undefined {
  if (!id.includes(CLONE_SEP)) {
    for (const l of layers) if (l.id === id) return l;
    return undefined;
  }
  return expandCloners(layers).byId.get(id);
}

/** Reads a cloner param after keyframes + links. */
export type ClonerParamReader = (paramName: string) => number;

/**
 * A copy's transform param: the cloner's animated value plus the layout
 * offset for this copy (spacing/radius animate too). X offsets are in
 * frame-height units, converted to the layer's width-fraction X by `aspect`.
 */
export function cloneTransformValue(
  paramName: string,
  clone: CloneInfo,
  readCloner: ClonerParamReader,
  aspect: number,
): number {
  const base = readCloner(paramName);
  let offset = 0;
  if (clone.angle !== null) {
    const radius = readCloner("radialRadius");
    const plane = readCloner("radialPlane");
    if (paramName === "layerPositionX") offset = (Math.cos(clone.angle) * radius) / aspect;
    else if (paramName === "layerPositionY" && plane !== 1) offset = Math.sin(clone.angle) * radius;
    else if (paramName === "layerPositionZ" && plane === 1) offset = Math.sin(clone.angle) * radius;
  } else {
    if (paramName === "layerPositionX") offset = (clone.grid[0] * readCloner("spacingX")) / aspect;
    else if (paramName === "layerPositionY") offset = clone.grid[1] * readCloner("spacingY");
    else if (paramName === "layerPositionZ") offset = clone.grid[2] * readCloner("spacingZ");
  }
  if (paramName === "layerRotationX") offset = readCloner("cloneRotateX");
  else if (paramName === "layerRotationY") offset = readCloner("cloneRotateY");
  else if (paramName === "layerRotation") offset = readCloner("cloneRotateZ");
  return base + offset;
}
