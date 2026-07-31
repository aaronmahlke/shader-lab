import type { LayerInstance, LayerUniformDef } from "../types/editor";
import type { ModulationFn } from "./compile-passes";
import LAYER_TEMPLATES from "./layer-templates";

/**
 * Universal layer properties — present on every layer regardless of type.
 * Stored in `layer.values` under reserved names so keyframes, LFO assignments,
 * and the inspector work through the existing (layerId, paramName) machinery.
 */

/** AE-style transform properties. Applied by the per-layer composite pass (generators only). */
export const TRANSFORM_UNIFORMS: LayerUniformDef[] = [
  { name: "layerPositionX", type: "float", label: "Position X", default: 0, min: -1, max: 1, step: 0.001 },
  { name: "layerPositionY", type: "float", label: "Position Y", default: 0, min: -1, max: 1, step: 0.001 },
  { name: "layerScale", type: "float", label: "Scale", default: 100, min: 0, max: 400, step: 0.1 },
  { name: "layerRotation", type: "float", label: "Rotation", default: 0, min: -360, max: 360, step: 0.1 },
  { name: "layerAnchorX", type: "float", label: "Anchor X", default: 0.5, min: 0, max: 1, step: 0.001 },
  { name: "layerAnchorY", type: "float", label: "Anchor Y", default: 0.5, min: 0, max: 1, step: 0.001 },
];

/** Opacity applies to every layer (generators composite; effects crossfade; distortion scales displacement). */
export const OPACITY_UNIFORM: LayerUniformDef = {
  name: "layerOpacity", type: "float", label: "Opacity", default: 100, min: 0, max: 100, step: 0.1,
};

export const UNIVERSAL_LAYER_UNIFORMS: LayerUniformDef[] = [
  ...TRANSFORM_UNIFORMS,
  OPACITY_UNIFORM,
];

const UNIVERSAL_NAMES = new Set(UNIVERSAL_LAYER_UNIFORMS.map((def) => def.name));

export function isUniversalParamName(name: string): boolean {
  return UNIVERSAL_NAMES.has(name);
}

/** Universal uniform defs applicable to a layer: generators get transform + opacity, others opacity only. */
export function universalUniformsFor(layer: Pick<LayerInstance, "type">): LayerUniformDef[] {
  const template = LAYER_TEMPLATES[layer.type];
  if (template?.category === "generator") return UNIVERSAL_LAYER_UNIFORMS;
  return [OPACITY_UNIFORM];
}

/** Find a param def by name across the layer's template uniforms and the universal set. */
export function findLayerParamDef(
  layer: Pick<LayerInstance, "type">,
  paramName: string,
): LayerUniformDef | undefined {
  const template = LAYER_TEMPLATES[layer.type];
  const own = template?.uniforms.find((def) => def.name === paramName);
  if (own) return own;
  return UNIVERSAL_LAYER_UNIFORMS.find((def) => def.name === paramName);
}

function readUniversalValue(
  layer: LayerInstance,
  def: LayerUniformDef,
  modFn: ModulationFn | null,
): number {
  const raw = layer.values[def.name];
  let value = typeof raw === "number" ? raw : (def.default as number);
  if (modFn) value = modFn(layer.id, def.name, value);
  return value;
}

/** Evaluate all universal transform/opacity uniforms for a layer (uniform names = param names). */
export function buildUniversalUniforms(
  layer: LayerInstance,
  modFn: ModulationFn | null,
): Record<string, number> {
  const uniforms: Record<string, number> = {};
  for (const def of UNIVERSAL_LAYER_UNIFORMS) {
    uniforms[def.name] = readUniversalValue(layer, def, modFn);
  }
  return uniforms;
}

/** Evaluate the layer's opacity (0–100) with modulation applied. */
export function layerOpacityValue(layer: LayerInstance, modFn: ModulationFn | null): number {
  return readUniversalValue(layer, OPACITY_UNIFORM, modFn);
}

/** 1 while `time` is inside the layer's in/out window, else 0. */
export function layerTimingFactor(layer: LayerInstance, time: number): number {
  const timing = layer.timing;
  if (!timing) return 1;
  const inPoint = timing.in ?? 0;
  const outPoint = timing.out ?? Number.POSITIVE_INFINITY;
  return time >= inPoint && time < outPoint ? 1 : 0;
}

/** True when the transform differs from identity (used to skip work / tests). */
export function isIdentityTransform(uniforms: Record<string, number>): boolean {
  return (
    uniforms.layerPositionX === 0 &&
    uniforms.layerPositionY === 0 &&
    uniforms.layerScale === 100 &&
    uniforms.layerRotation === 0
  );
}
