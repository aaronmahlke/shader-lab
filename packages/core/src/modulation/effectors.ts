import type { LayerInstance } from "../types/editor";
import { findLayerParamDef, layerTimingFactor } from "../compiler/universal-uniforms";

/**
 * Effectors: spatial modulators (MoGraph / the AE "Effector" null rig).
 *
 * An effector layer is a point in the comp. Every other layer within its
 * radius gets pushed, rotated, scaled and faded, weighted by distance:
 * full strength inside `innerRadius`, fading to nothing at `radius`.
 * Several effectors stack: offsets/rotations add, scale/opacity multiply.
 *
 * Distances are in frame-height fractions: X is scaled by the comp aspect so
 * a radius is round on screen, Z uses the 3D transform's Z units.
 */

export type EffectorInfluence = {
  dx: number;
  dy: number;
  dz: number;
  rx: number;
  ry: number;
  rz: number;
  /** Multiplier (1 = unchanged). */
  scale: number;
  /** Multiplier (1 = unchanged). */
  opacity: number;
};

/** Transform params effectors act on. */
export const EFFECTOR_PARAMS = new Set([
  "layerPositionX",
  "layerPositionY",
  "layerPositionZ",
  "layerRotationX",
  "layerRotationY",
  "layerRotation",
  "layerScale",
  "layerOpacity",
]);

/** Layers effectors never touch. */
function isImmune(layer: Pick<LayerInstance, "type">): boolean {
  return layer.type === "effector" || layer.type === "camera" || layer.type === "audio" || layer.type === "pointer";
}

/** 1 inside `inner`, 0 beyond `outer`, linear or smoothstep in between. */
export function effectorFalloff(distance: number, outer: number, inner: number, smooth: boolean): number {
  const out = Math.max(0, outer);
  const inn = Math.max(0, Math.min(inner, out));
  if (distance >= out) return 0;
  if (distance <= inn) return 1;
  const t = (out - distance) / (out - inn);
  return smooth ? t * t * (3 - 2 * t) : t;
}

/** Reads a param after keyframes + modulator links (but before effectors). */
export type ParamReader = (layer: LayerInstance, paramName: string) => number;

/** Static value of a param: stored value, else the template/universal default. */
export function staticParamValue(layer: LayerInstance, paramName: string): number {
  const raw = layer.values[paramName];
  if (typeof raw === "number") return raw;
  const def = findLayerParamDef(layer, paramName);
  return typeof def?.default === "number" ? def.default : 0;
}

function layerPoint(layer: LayerInstance, read: ParamReader, aspect: number): [number, number, number] {
  return [
    (read(layer, "layerAnchorX") + read(layer, "layerPositionX")) * aspect,
    read(layer, "layerAnchorY") + read(layer, "layerPositionY"),
    read(layer, "layerPositionZ"),
  ];
}

/** Combined influence of all active effectors on `target`, or null when nothing reaches it. */
export function computeEffectorInfluence(
  target: LayerInstance,
  effectors: readonly LayerInstance[],
  read: ParamReader,
  aspect: number,
  time: number,
): EffectorInfluence | null {
  if (isImmune(target) || effectors.length === 0) return null;

  const p = layerPoint(target, read, aspect);
  let hit = false;
  const out: EffectorInfluence = { dx: 0, dy: 0, dz: 0, rx: 0, ry: 0, rz: 0, scale: 1, opacity: 1 };

  for (const effector of effectors) {
    if (!effector.enabled || layerTimingFactor(effector, time) === 0) continue;
    const e = layerPoint(effector, read, aspect);
    const distance = Math.hypot(p[0] - e[0], p[1] - e[1], p[2] - e[2]);
    const falloff = effectorFalloff(
      distance,
      read(effector, "radius"),
      read(effector, "innerRadius"),
      staticParamValue(effector, "falloff") === 1,
    );
    const w = falloff * Math.max(0, Math.min(1, read(effector, "strength") / 100));
    if (w <= 0) continue;

    hit = true;
    out.dx += read(effector, "offsetX") * w;
    out.dy += read(effector, "offsetY") * w;
    out.dz += read(effector, "offsetZ") * w;
    out.rx += read(effector, "rotateX") * w;
    out.ry += read(effector, "rotateY") * w;
    out.rz += read(effector, "rotateZ") * w;
    out.scale *= 1 + (read(effector, "scale") / 100 - 1) * w;
    out.opacity *= 1 + (read(effector, "opacity") / 100 - 1) * w;
  }

  return hit ? out : null;
}

/** Apply an influence to one transform param value. */
export function applyEffectorInfluence(paramName: string, value: number, inf: EffectorInfluence): number {
  switch (paramName) {
    case "layerPositionX":
      return value + inf.dx;
    case "layerPositionY":
      return value + inf.dy;
    case "layerPositionZ":
      return value + inf.dz;
    case "layerRotationX":
      return value + inf.rx;
    case "layerRotationY":
      return value + inf.ry;
    case "layerRotation":
      return value + inf.rz;
    case "layerScale":
      return value * inf.scale;
    case "layerOpacity":
      return value * inf.opacity;
    default:
      return value;
  }
}
