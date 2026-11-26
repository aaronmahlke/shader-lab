import {
  LAYER_TEMPLATES,
  UNIVERSAL_LAYER_UNIFORMS,
  type LayerInstance,
  type LayerUniformDef,
} from "@shader-lab/core";

/** Settings of a layer that can become a comp prop (no gradients / point lists / layer lists). */
const PROPABLE = new Set<LayerUniformDef["type"]>(["float", "int", "color", "select", "bool", "text"]);
const UNIVERSAL_PROPS = new Set(["layerOpacity", "layerPositionX", "layerPositionY", "layerScale", "layerRotation"]);

export function propParamDefs(layer: LayerInstance): LayerUniformDef[] {
  const own = (LAYER_TEMPLATES[layer.type]?.uniforms ?? []).filter((d) => PROPABLE.has(d.type));
  const universal = UNIVERSAL_LAYER_UNIFORMS.filter((d) => UNIVERSAL_PROPS.has(d.name));
  return layer.type === "pointer" || layer.type === "audio" ? own : [...own, ...universal];
}

export function propParamDef(layer: LayerInstance | undefined, param: string): LayerUniformDef | undefined {
  return layer ? propParamDefs(layer).find((d) => d.name === param) : undefined;
}

/** How a prop is edited on the precomp layer. */
export type PropKind = "image" | "video" | "audio" | "component" | "pointer" | "text" | "number" | "color" | "select" | "bool";

export function propKind(layer: LayerInstance | undefined, def: LayerUniformDef | undefined): PropKind | null {
  if (!layer || !def) return null;
  if (def.name === "src" && (layer.type === "image" || layer.type === "video" || layer.type === "audio")) return layer.type;
  if (layer.type === "component" && def.name === "componentName") return "component";
  if (layer.type === "component" && def.name === "pointer") return "pointer";
  if (def.type === "text") return "text";
  if (def.type === "float" || def.type === "int") return "number";
  if (def.type === "color") return "color";
  if (def.type === "select") return "select";
  if (def.type === "bool") return "bool";
  return null;
}
