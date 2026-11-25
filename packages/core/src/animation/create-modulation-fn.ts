import type { ModulationFn } from "../compiler/compile-passes";
import type { ModulationEngine } from "../modulation/engine";
import type { PropertyTrack } from "../types/animation";
import { evaluatePropertyTrack, findPropertyTrack } from "./property-tracks";

/**
 * Build the per-frame modulation fn: the base is the keyframed value when the
 * stopwatch is on (else the static value), and modulator links stack on top.
 */
export function createAnimatedModulationFn(
  time: number,
  tracks: PropertyTrack[],
  engine: ModulationEngine,
): ModulationFn {
  engine.setTracks(tracks);
  engine.ensureSampled(time);
  return (layerId, paramName, baseValue) => {
    const track = findPropertyTrack(tracks, layerId, paramName);
    const base = track?.enabled ? evaluatePropertyTrack(track, time, baseValue) : baseValue;
    return engine.getModulatedValue(layerId, paramName, base);
  };
}
