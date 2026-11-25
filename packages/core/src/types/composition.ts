import type { CompositionSettings, PropertyTrack } from "./animation";
import type { EnvelopeSource, LayerInstance, LFOSource, ModulationAssignment } from "./editor";

export type CompositionConfig = {
  version: 1;
  layers: LayerInstance[];
  lfos: LFOSource[];
  /** ADSR modulators. Links reference them by id, same as LFOs. */
  envelopes?: EnvelopeSource[];
  assignments: ModulationAssignment[];
  settings?: CompositionSettings;
  tracks?: PropertyTrack[];
};
