import type { LayerInstance, LFOSource, ModulationAssignment } from "./editor";

export type CompositionConfig = {
  version: 1;
  layers: LayerInstance[];
  lfos: LFOSource[];
  assignments: ModulationAssignment[];
};
