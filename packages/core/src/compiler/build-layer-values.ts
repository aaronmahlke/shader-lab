import type { LayerType } from "../types/editor";
import type { GradientStop } from "../types";
import type { MeshPoint } from "../types/mesh";
import LAYER_TEMPLATES from "./layer-templates";
import { UNIVERSAL_LAYER_UNIFORMS } from "./universal-uniforms";

/** Default uniform values for a new layer instance. */
export function buildLayerValues(type: LayerType): Record<string, unknown> {
  const template = LAYER_TEMPLATES[type];
  if (!template) return {};

  const values: Record<string, unknown> = {};
  for (const def of UNIVERSAL_LAYER_UNIFORMS) {
    values[def.name] = def.default;
  }
  for (const def of template.uniforms) {
    if (def.type === "gradient" && Array.isArray(def.default)) {
      values[def.name] = (def.default as GradientStop[]).map((stop) => ({ ...stop }));
    } else if (def.type === "meshPoints" && Array.isArray(def.default)) {
      values[def.name] = (def.default as MeshPoint[]).map((point) => ({ ...point }));
    } else {
      values[def.name] = def.default;
    }
  }

  return values;
}
