import type { ModulationFn } from "../compiler/compile-passes";
import type { ModulationEngine } from "../modulation/engine";
import type { PropertyTrack } from "../types/animation";
import type { LayerInstance } from "../types/editor";
import { applyEffectorInfluence, EFFECTOR_PARAMS, staticParamValue } from "../modulation/effectors";
import { CLONE_TRANSFORM_PARAMS, cloneTransformValue } from "../modulation/cloners";
import { evaluatePropertyTrack, findPropertyTrack } from "./property-tracks";

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

  const direct: ModulationFn = (layerId, paramName, baseValue) => {
    const track = findPropertyTrack(tracks, layerId, paramName);
    const base = track?.enabled ? evaluatePropertyTrack(track, time, baseValue) : baseValue;
    return engine.getModulatedValue(layerId, paramName, base);
  };

  // Cloner copies: transform from the cloner (+ layout offset), content from
  // the source layer (its keyframes and links).
  const timed: ModulationFn = !engine.hasCloners()
    ? direct
    : (layerId, paramName, baseValue) => {
        const clone = engine.getLayer(layerId)?.clone;
        if (!clone) return direct(layerId, paramName, baseValue);
        if (!CLONE_TRANSFORM_PARAMS.has(paramName)) return direct(clone.sourceId, paramName, baseValue);
        const cloner = engine.getLayer(clone.clonerId);
        if (!cloner) return baseValue;
        const readCloner = (name: string) => direct(cloner.id, name, staticParamValue(cloner, name));
        return cloneTransformValue(paramName, clone, readCloner, engine.getAspect());
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
