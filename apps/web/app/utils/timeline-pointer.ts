import { isLayer3D, staticParamValue, type LayerInstance } from "@shader-lab/core";
import { compToLayerUv, transformCenter, type LayerTransformValues } from "../../shared/editor/layer-transform";
import { prepareStageStyles, stageHit, StagePointer } from "./stage-pointer";

/**
 * Pointer layers → component hover / pressed state at a timeline time.
 *
 * Each component layer names a Pointer layer (`values.pointer`, same comp).
 * The hotspot (the pointer's cursor graphic's anchor, or the pointer's own) (parents, keys, links included) is mapped into
 * the component's layer UV and hit-tested against its mounted DOM; the hit
 * path gets `data-stage-hover` / `data-stage-active` (authored `:hover` /
 * `:active` rules are rewritten to match those) and a `stagepointerstate`
 * event. Absolute state per time: scrubbing backwards just works.
 */
const pointers = new Map<string, StagePointer>();

type Sample = (id: string, name: string, base: number) => number;

export function seekTimelinePointers(
  layers: readonly LayerInstance[],
  time: number,
  frame: { width: number; height: number },
  getRoot: (id: string) => HTMLElement | null,
  sample: Sample,
): void {
  const read = (l: LayerInstance, name: string) => sample(l.id, name, staticParamValue(l, name));
  const live = (l: LayerInstance) =>
    l.enabled && time >= (l.timing?.in ?? -Infinity) && time < (l.timing?.out ?? Infinity);
  const transform = (l: LayerInstance): LayerTransformValues => ({
    positionX: read(l, "layerPositionX"),
    positionY: read(l, "layerPositionY"),
    anchorX: read(l, "layerAnchorX"),
    anchorY: read(l, "layerAnchorY"),
    rotation: read(l, "layerRotation"),
    scale: read(l, "layerScale"),
  });

  const byId = new Map(layers.map((l) => [l.id, l]));
  const seen = new Set<string>();
  let styled = false;

  for (const layer of layers) {
    if (layer.type !== "component") continue;
    const pointerId = typeof layer.values.pointer === "string" ? layer.values.pointer : "";
    if (!pointerId) continue;
    seen.add(layer.id);
    let state = pointers.get(layer.id);
    if (!state) pointers.set(layer.id, (state = new StagePointer()));

    const root = getRoot(layer.id);
    const pointer = byId.get(pointerId);
    if (!root || !pointer || pointer.type !== "pointer" || !live(pointer) || !live(layer) || isLayer3D(layer)) {
      state.update(null, null, false);
      continue;
    }
    if (!styled) {
      prepareStageStyles(); // only ever when some component follows a pointer
      styled = true;
    }
    // Hotspot: the cursor graphic's anchor when the pointer has one (that's
    // what you see and drag on the canvas), else the pointer itself. Child
    // transforms are world values (parent included), so animating either works.
    const graphic = layers.find((l) => l.parent === pointer.id && l.enabled && l.type !== "pointer");
    const tip = transformCenter(transform(graphic ?? pointer));
    const uv = compToLayerUv(tip, transform(layer), frame.width / frame.height);
    let hit: Element | null = null;
    if (uv.x >= 0 && uv.x <= 1 && uv.y >= 0 && uv.y <= 1) {
      const rect = root.getBoundingClientRect();
      hit = stageHit(root, rect.width / 2 + (uv.x - 0.5) * frame.width, rect.height / 2 + (0.5 - uv.y) * frame.height);
    }
    state.update(root, hit, !!hit && read(pointer, "press") >= 0.5);
  }

  // Components that stopped following a pointer: clear their state.
  for (const [id, state] of pointers) {
    if (seen.has(id)) continue;
    state.update(null, null, false);
    pointers.delete(id);
  }
}
