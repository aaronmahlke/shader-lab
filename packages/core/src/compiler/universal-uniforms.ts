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

/**
 * Extra transform properties a layer gains when its 3D switch is on.
 * Z is in canvas-height fractions (matches the scene's world scale where the
 * frame is 2 units tall); positive Z moves the layer toward the camera.
 */
export const THREED_TRANSFORM_UNIFORMS: LayerUniformDef[] = [
  { name: "layerPositionZ", type: "float", label: "Position Z", default: 0, min: -2, max: 2, step: 0.001 },
  { name: "layerRotationX", type: "float", label: "Rotation X", default: 0, min: -360, max: 360, step: 0.1 },
  { name: "layerRotationY", type: "float", label: "Rotation Y", default: 0, min: -360, max: 360, step: 0.1 },
];

/** Opacity applies to every layer (generators composite; effects crossfade; distortion scales displacement). */
export const OPACITY_UNIFORM: LayerUniformDef = {
  name: "layerOpacity", type: "float", label: "Opacity", default: 100, min: 0, max: 100, step: 0.1,
};

/**
 * AE-style material option for 3D layer quads: when on, the group's lights
 * shade the layer's content (diffuse + ambient). Emissive (unlit) when off
 * or when the group has no lights.
 */
export const ACCEPTS_LIGHTS_UNIFORM: LayerUniformDef = {
  name: "layerAcceptsLights",
  type: "select",
  label: "Accepts lights",
  default: 1,
  options: [
    { label: "On", value: 1 },
    { label: "Off", value: 0 },
  ],
  keyframeable: false,
};

/** How a generator's content blends onto the stack below (composite pass). */
export const BLEND_MODE_UNIFORM: LayerUniformDef = {
  name: "layerBlendMode",
  type: "select",
  label: "Blend",
  default: 0,
  // Values are stable persisted ids (shader switch cases); the array order is the
  // dropdown order, grouped Photoshop-style: darken, lighten, contrast, inversion, component.
  options: [
    { label: "Normal", value: 0 },
    { label: "Darken", value: 5 },
    { label: "Multiply", value: 1 },
    { label: "Color Burn", value: 8 },
    { label: "Lighten", value: 6 },
    { label: "Screen", value: 2 },
    { label: "Color Dodge", value: 7 },
    { label: "Add", value: 4 },
    { label: "Overlay", value: 3 },
    { label: "Soft Light", value: 10 },
    { label: "Hard Light", value: 9 },
    { label: "Difference", value: 11 },
    { label: "Exclusion", value: 12 },
    { label: "Hue", value: 13 },
    { label: "Saturation", value: 14 },
    { label: "Color", value: 15 },
    { label: "Luminosity", value: 16 },
  ],
};

export const UNIVERSAL_LAYER_UNIFORMS: LayerUniformDef[] = [
  ...TRANSFORM_UNIFORMS,
  ...THREED_TRANSFORM_UNIFORMS,
  OPACITY_UNIFORM,
  BLEND_MODE_UNIFORM,
  ACCEPTS_LIGHTS_UNIFORM,
];

const UNIVERSAL_NAMES = new Set(UNIVERSAL_LAYER_UNIFORMS.map((def) => def.name));

export function isUniversalParamName(name: string): boolean {
  return UNIVERSAL_NAMES.has(name);
}

/** Layer types that live in 3D space unconditionally (no switch shown). */
const ALWAYS_3D = new Set<LayerInstance["type"]>(["object3d", "light"]);

/** True when the layer type supports the 3D SWITCH (generators; always-3D types excluded). */
export function supports3D(layer: Pick<LayerInstance, "type">): boolean {
  return LAYER_TEMPLATES[layer.type]?.category === "generator" && !ALWAYS_3D.has(layer.type);
}

/** True when the layer renders as a 3D group member. */
export function isLayer3D(layer: Pick<LayerInstance, "type" | "is3D">): boolean {
  if (ALWAYS_3D.has(layer.type)) return true;
  return !!layer.is3D && supports3D(layer);
}

const findUniform = (name: string): LayerUniformDef =>
  UNIVERSAL_LAYER_UNIFORMS.find((def) => def.name === name)!;

/** AE-style display order when the 3D switch is on (Z position after X/Y, rotations grouped). */
const THREED_DISPLAY_ORDER: LayerUniformDef[] = [
  findUniform("layerPositionX"),
  findUniform("layerPositionY"),
  findUniform("layerPositionZ"),
  findUniform("layerScale"),
  findUniform("layerRotationX"),
  findUniform("layerRotationY"),
  { ...findUniform("layerRotation"), label: "Rotation Z" },
  findUniform("layerAnchorX"),
  findUniform("layerAnchorY"),
  OPACITY_UNIFORM,
  BLEND_MODE_UNIFORM,
  ACCEPTS_LIGHTS_UNIFORM,
];

/**
 * Universal uniform defs applicable to a layer: generators get transform + opacity
 * (plus Z/X/Y rotation and material options when the 3D switch is on), others
 * opacity only.
 */
export function universalUniformsFor(
  layer: Pick<LayerInstance, "type"> & Partial<Pick<LayerInstance, "is3D">>,
): LayerUniformDef[] {
  const template = LAYER_TEMPLATES[layer.type];
  if (template?.category !== "generator") return [OPACITY_UNIFORM];
  if (isLayer3D(layer)) return THREED_DISPLAY_ORDER;
  return [...TRANSFORM_UNIFORMS, OPACITY_UNIFORM, BLEND_MODE_UNIFORM];
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
