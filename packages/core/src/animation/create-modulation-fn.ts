import type { ModulationFn } from "../compiler/compile-passes";
import type { ModulationEngine } from "../modulation/engine";
import type { PropertyTrack } from "../types/animation";
import type { LayerInstance } from "../types/editor";
import { applyEffectorInfluence, EFFECTOR_PARAMS, staticParamValue } from "../modulation/effectors";
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

  const timed: ModulationFn = (layerId, paramName, baseValue) => {
    const track = findPropertyTrack(tracks, layerId, paramName);
    const base = track?.enabled ? evaluatePropertyTrack(track, time, baseValue) : baseValue;
    return engine.getModulatedValue(layerId, paramName, base);
  };

  if (!engine.hasEffectors()) return timed;

  const read = (layer: LayerInstance, paramName: string) =>
    timed(layer.id, paramName, staticParamValue(layer, paramName));

  return (layerId, paramName, baseValue) => {
    const value = timed(layerId, paramName, baseValue);
    if (!EFFECTOR_PARAMS.has(paramName)) return value;
    const influence = engine.effectorInfluence(layerId, read);
    return influence ? applyEffectorInfluence(paramName, value, influence) : value;
  };
}
