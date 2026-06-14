import type { LayerUniformDef } from "../types/editor";

export function isKeyframeableUniform(def: LayerUniformDef): boolean {
  if (def.keyframeable === false) return false;
  return def.type === "float" || def.type === "int";
}
