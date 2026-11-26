import { isLayer3D, staticParamValue, type LayerInstance } from "@shader-lab/core";
import { compToLayerUv, transformCenter, type LayerTransformValues } from "../../shared/editor/layer-transform";
import { prepareStageStyles, stageHit, StagePointer } from "./stage-pointer";

/**
 * Pointer layers → component hover / pressed state at a timeline time.
 *
 * Each component layer names a Pointer layer (`values.pointer`). Inside a
 * precomp that's a pointer of that comp, or — handed in through a Pointer
 * prop — one of the open comp. The hotspot (the pointer's cursor graphic's
 * anchor, else the pointer's own) is mapped through every precomp layer
 * between the pointer and the component (nested comps render in the root
 * frame, so each step is one compToLayerUv), into the component's layer UV,
 * and hit-tested against its mounted DOM. Hits get `data-stage-hover` /
 * `data-stage-active` (authored :hover / :active rules match those) and a
 * `stagepointerstate` event. Absolute state per time: scrubbing just works.
 */
const pointers = new Map<string, StagePointer>();

type Sample = (id: string, name: string, base: number) => number;
export type StagedComponent = { layer: LayerInstance; hosts: string[] };

const SEP = "::";
const prefixOf = (id: string) => (id.includes(SEP) ? id.slice(0, id.lastIndexOf(SEP) + SEP.length) : "");

export function seekTimelinePointers(opts: {
  components: readonly StagedComponent[];
  /** Layers of one comp by id prefix ("" = the open comp, "h1::" = inside host h1), ids unprefixed. */
  layersOf: (prefix: string) => readonly LayerInstance[];
  time: number;
  frame: { width: number; height: number };
  getRoot: (id: string) => HTMLElement | null;
  /** Nested-aware modulation fn (prefixed ids route into their comp's clock). */
  sample: Sample;
}): void {
  const { components, layersOf, time, frame, getRoot, sample } = opts;
  const aspect = frame.width / frame.height;
  const find = (id: string): LayerInstance | undefined => {
    const prefix = prefixOf(id);
    const local = id.slice(prefix.length);
    const l = layersOf(prefix).find((x) => x.id === local);
    return l && prefix ? { ...l, id } : l;
  };
  const read = (l: LayerInstance, name: string) => sample(l.id, name, staticParamValue(l, name));
  const transform = (l: LayerInstance): LayerTransformValues => ({
    positionX: read(l, "layerPositionX"),
    positionY: read(l, "layerPositionY"),
    anchorX: read(l, "layerAnchorX"),
    anchorY: read(l, "layerAnchorY"),
    rotation: read(l, "layerRotation"),
    scale: read(l, "layerScale"),
  });
  const live = (l: LayerInstance) => l.enabled && time >= (l.timing?.in ?? -Infinity) && time < (l.timing?.out ?? Infinity);

  let styled = false;
  const seen = new Set<string>();

  for (const { layer, hosts } of components) {
    const ref = typeof layer.values.pointer === "string" ? layer.values.pointer : "";
    if (!ref) continue;
    seen.add(layer.id);
    let state = pointers.get(layer.id);
    if (!state) pointers.set(layer.id, (state = new StagePointer()));

    // The pointer: in the component's own comp first, else in an outer comp
    // (handed in by a Pointer prop), innermost first.
    const ownPrefix = prefixOf(layer.id);
    const prefixes = [ownPrefix, ...hosts.slice(0, -1).reverse().map((h) => `${h}${SEP}`), ""];
    let pointer: LayerInstance | undefined;
    for (const p of [...new Set(prefixes)]) {
      const l = find(`${p}${ref}`);
      if (l?.type === "pointer") {
        pointer = l;
        break;
      }
    }

    const root = getRoot(layer.id);
    if (!root || !pointer || !live(pointer) || isLayer3D(layer)) {
      state.update(null, null, false);
      continue;
    }
    if (!styled) {
      prepareStageStyles(); // only ever when some component follows a pointer
      styled = true;
    }

    // Hotspot in the pointer's comp.
    const pPrefix = prefixOf(pointer.id);
    const localId = pointer.id.slice(pPrefix.length);
    const g = layersOf(pPrefix).find((l) => l.parent === localId && l.enabled && l.type !== "pointer");
    const graphic = g ? (pPrefix ? { ...g, id: `${pPrefix}${g.id}` } : g) : undefined;
    let tip = transformCenter(transform(graphic ?? pointer));

    // Down into the component's comp through each precomp layer below the pointer's comp.
    for (const hostId of hosts) {
      if (pPrefix.startsWith(`${hostId}${SEP}`)) continue; // the pointer is inside this host already
      const host = find(hostId);
      if (!host) break;
      tip = compToLayerUv(tip, transform(host), aspect);
    }

    const uv = compToLayerUv(tip, transform(layer), aspect);
    let hit: Element | null = null;
    if (uv.x >= 0 && uv.x <= 1 && uv.y >= 0 && uv.y <= 1) {
      const rect = root.getBoundingClientRect();
      hit = stageHit(root, rect.width / 2 + (uv.x - 0.5) * frame.width, rect.height / 2 + (0.5 - uv.y) * frame.height);
    }
    state.update(root, hit, !!hit && read(pointer, "press") >= 0.5);
  }

  for (const [id, state] of pointers) {
    if (seen.has(id)) continue;
    state.update(null, null, false);
    pointers.delete(id);
  }
}
