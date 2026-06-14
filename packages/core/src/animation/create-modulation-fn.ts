import type { ModulationFn } from "../compiler/compile-passes";
import type { ModulationEngine } from "../modulation/engine";
import type { PropertyTrack } from "../types/animation";
import { evaluatePropertyTrack, findPropertyTrack } from "./property-tracks";

/** Build a modulation fn: keyframed params override LFO when stopwatch is on. */
export function createAnimatedModulationFn(
  time: number,
  tracks: PropertyTrack[],
  lfoEngine: ModulationEngine,
): ModulationFn {
  return (layerId, paramName, baseValue) => {
    const track = findPropertyTrack(tracks, layerId, paramName);
    if (track?.enabled) {
      return evaluatePropertyTrack(track, time, baseValue);
    }
    return lfoEngine.getModulatedValue(layerId, paramName, baseValue);
  };
}
