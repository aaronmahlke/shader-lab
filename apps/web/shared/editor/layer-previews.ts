import type { LayerInstance, LayerType } from "@shader-lab/core";
import { LAYER_TEMPLATES, buildLayerValues } from "@shader-lab/core";

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

export function getLayerPreviewStack(type: LayerType): LayerInstance[] {
  const template = LAYER_TEMPLATES[type];
  if (!template) return [PREVIEW_BASE_GRADIENT];

  // Component content comes from a live DOM capture the preview renderer
  // cannot produce; an empty stack renders a plain card instead of a lie.
  if (type === "component") return [];

  if (template.category === "generator") {
    return [previewLayer(type)];
  }

  return [PREVIEW_BASE_GRADIENT, previewLayer(type)];
}
