import type { LayerInstance, LayerType } from "../types/editor";
import LAYER_TEMPLATES from "./layer-templates";
import { buildLayerValues } from "./build-layer-values";

const PREVIEW_BASE_GRADIENT: LayerInstance = {
  id: "preview-base-gradient",
  type: "gradient",
  enabled: true,
  values: buildLayerValues("gradient"),
};

function previewLayer(type: LayerType, id = `preview-${type}`): LayerInstance {
  return {
    id,
    type,
    enabled: true,
    values: buildLayerValues(type),
  };
}

/** Layer stack used for catalog thumbnails (bottom → top render order). */
export function getLayerPreviewStack(type: LayerType): LayerInstance[] {
  const template = LAYER_TEMPLATES[type];
  if (!template) return [];

  const layer = previewLayer(type);

  if (template.category === "generator") {
    return [layer];
  }

  if (type === "hybridDissolve") {
    return [previewLayer("waveFill", "preview-waveFill"), layer];
  }

  return [PREVIEW_BASE_GRADIENT, layer];
}
