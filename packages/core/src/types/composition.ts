import type { CompositionSettings, PropertyTrack } from "./animation";
import type { LayerInstance, LFOSource, ModulationAssignment } from "./editor";

export type CompositionConfig = {
  version: 1;
  layers: LayerInstance[];
  lfos: LFOSource[];
  assignments: ModulationAssignment[];
  settings?: CompositionSettings;
  tracks?: PropertyTrack[];
};
