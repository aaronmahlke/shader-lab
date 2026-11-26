import {
  isLayer3D,
  staticParamValue,
  type LayerInstance,
} from "@shader-lab/core";
import {
  compToLayerUv,
  transformCenter,
  type LayerTransformValues,
} from "../../shared/editor/layer-transform";
import { prepareStageStyles, stageHit, StagePointer } from "./stage-pointer";

/** Sample the rendered anchor, not raw position keys: the renderer's reader
 * includes parent transforms, animation and links at the requested time. */
export function seekTimelinePointer(
  pointer: StagePointer,
  layers: LayerInstance[],
  time: number,
  frame: { width: number; height: number },
  getRoot: (id: string) => HTMLElement | null,
  sample: (id: string, name: string, base: number) => number,
) {
  const read = (l: LayerInstance, name: string) =>
    sample(l.id, name, staticParamValue(l, name));
  const visible = (l: LayerInstance) =>
    l.enabled &&
    !isLayer3D(l) &&
    time >= (l.timing?.in ?? -Infinity) &&
    time < (l.timing?.out ?? Infinity) &&
    read(l, "layerOpacity") > 0;
  const transform = (l: LayerInstance): LayerTransformValues => ({
    positionX: read(l, "layerPositionX"),
    positionY: read(l, "layerPositionY"),
    anchorX: read(l, "layerAnchorX"),
    anchorY: read(l, "layerAnchorY"),
    rotation: read(l, "layerRotation"),
    scale: read(l, "layerScale"),
  });
  const cursor = layers.find(
    (l) =>
      l.type === "image" && Number(l.values.timelineCursor) === 1 && visible(l),
  );
  if (cursor) {
    prepareStageStyles();
    const tip = transformCenter(transform(cursor));
    if (tip.x >= 0 && tip.x <= 1 && tip.y >= 0 && tip.y <= 1) {
      for (const layer of layers) {
        if (layer.type !== "component" || !visible(layer)) continue;
        const root = getRoot(layer.id);
        if (!root) continue;
        const uv = compToLayerUv(
          tip,
          transform(layer),
          frame.width / frame.height,
        );
        if (uv.x < 0 || uv.x > 1 || uv.y < 0 || uv.y > 1) continue;
        const rect = root.getBoundingClientRect();
        const hit = stageHit(
          root,
          rect.width / 2 + (uv.x - 0.5) * frame.width,
          rect.height / 2 + (0.5 - uv.y) * frame.height,
        );
        if (hit)
          return pointer.update(root, hit, read(cursor, "cursorPress") >= 0.5);
      }
    }
  }
  pointer.update(null, null, false);
}
