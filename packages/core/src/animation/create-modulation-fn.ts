import type { ModulationFn } from "../compiler/compile-passes";
import type { ModulationEngine } from "../modulation/engine";
import type { PropertyTrack } from "../types/animation";
import type { LayerInstance } from "../types/editor";
import { applyEffectorInfluence, EFFECTOR_PARAMS, staticParamValue } from "../modulation/effectors";
import { CLONE_TRANSFORM_PARAMS, cloneTransformValue } from "../modulation/cloners";
import { PARENT_PARAMS, worldParam } from "../modulation/parenting";
import { evaluatePropertyTrack } from "./property-tracks";

/**
 * Build the per-frame modulation fn. Per property:
 *   1. base = keyframes (stopwatch on) or the static value
 *   2. + modulator links (LFOs, envelopes)
 *   3. + effectors (transform/opacity only, from nearby effector layers)
 */
export function createAnimatedModulationFn(
  time: number,
  tracks: PropertyTrack[],
  engine: ModulationEngine,
): ModulationFn {
  engine.setTracks(tracks);
  engine.ensureSampled(time);

  // One lookup table per frame: scanning `tracks` per param read was the
  // renderer's hottest path on big comps (hundreds of layers × params).
  const index = new Map<string, PropertyTrack>();
  for (const t of tracks) {
    const k = `${t.layerId}\u0000${t.paramName}`;
    if (!index.has(k)) index.set(k, t);
  }

  // Per layer: local value (cloner copies route transform → cloner + layout,
  // content → source), then the parent chain for transform params.
  const needsRouting = engine.hasCloners() || engine.hasParenting();

  type Evaluator = {
    direct: ModulationFn;
    world: (layer: LayerInstance, paramName: string, baseValue: number) => number;
  };

  /** Keyframe evaluation at time `t` (staggered cloner copies read at an earlier t). */
  function evaluatorAt(t: number): Evaluator {
    const direct: ModulationFn = (layerId, paramName, baseValue) => {
      const track = index.get(`${layerId}\u0000${paramName}`);
      const base = track?.enabled ? evaluatePropertyTrack(track, t, baseValue) : baseValue;
      return engine.getModulatedValue(layerId, paramName, base);
    };

    const local = (layer: LayerInstance, paramName: string, baseValue: number): number => {
      const clone = layer.clone;
      if (!clone) return direct(layer.id, paramName, baseValue);
      // Stagger: the copy plays its keys (source content + cloner transform) later.
      const delay = t === time ? cloneDelay(clone) : 0;
      if (delay !== 0) return at(time - delay).world(layer, paramName, baseValue);
      if (!CLONE_TRANSFORM_PARAMS.has(paramName)) return direct(clone.sourceId, paramName, baseValue);
      const cloner = engine.getLayer(clone.clonerId);
      if (!cloner) return baseValue;
      const readCloner = (name: string) =>
        CLONE_TRANSFORM_PARAMS.has(name)
          ? world(cloner, name, staticParamValue(cloner, name))
          : direct(cloner.id, name, staticParamValue(cloner, name));
      return cloneTransformValue(paramName, clone, readCloner, engine.getAspect());
    };

    const readLocal = (layer: LayerInstance, paramName: string) =>
      local(layer, paramName, staticParamValue(layer, paramName));

    function world(layer: LayerInstance, paramName: string, baseValue: number): number {
      if (!layer.parent || !PARENT_PARAMS.has(paramName)) return local(layer, paramName, baseValue);
      return worldParam(engine.worldTransform(layer, readLocal), paramName, engine.getAspect());
    }

    return { direct, world };
  }

  const evaluators = new Map<number, Evaluator>();
  function at(t: number): Evaluator {
    let e = evaluators.get(t);
    if (!e) {
      e = evaluatorAt(t);
      evaluators.set(t, e);
    }
    return e;
  }

  function cloneDelay(clone: NonNullable<LayerInstance["clone"]>): number {
    const rank = clone.staggerRank ?? 0;
    if (rank === 0) return 0;
    const cloner = engine.getLayer(clone.clonerId);
    const stagger = cloner ? Number(cloner.values.stagger ?? 0) : 0;
    return Number.isFinite(stagger) && stagger > 0 ? rank * stagger : 0;
  }

  const now = at(time);
  const direct = now.direct;
  const world = now.world;

  const timed: ModulationFn = !needsRouting
    ? direct
    : (layerId, paramName, baseValue) => {
        const layer = engine.getLayer(layerId);
        return layer ? world(layer, paramName, baseValue) : direct(layerId, paramName, baseValue);
      };

  if (!engine.hasEffectors()) return timed;

  const read = (layer: LayerInstance, paramName: string) =>
    timed(layer.id, paramName, staticParamValue(layer, paramName));
  // (copies read through `timed`, so effectors see their laid-out positions)

  return (layerId, paramName, baseValue) => {
    const value = timed(layerId, paramName, baseValue);
    if (!EFFECTOR_PARAMS.has(paramName)) return value;
    const influence = engine.effectorInfluence(layerId, read);
    return influence ? applyEffectorInfluence(paramName, value, influence) : value;
  };
}
