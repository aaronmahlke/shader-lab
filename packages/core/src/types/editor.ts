export type LayerCategory = "generator" | "distortion" | "effect";

export type LayerType =
  | "gradient"
  | "mesh"
  | "solid"
  | "noise"
  | "text"
  | "component"
  | "waveFill"
  | "bandFill"
  | "distortion"
  | "dither"
  | "grain"
  | "seam"
  | "diffuse"
  | "vignette"
  | "chromaticAberration";

export type LayerUniformDef = {
  name: string;
  type: "float" | "int" | "color" | "vec2" | "gradient" | "meshPoints" | "bool" | "select" | "text";
  label: string;
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: { label: string; value: string | number }[];
  /** When false, no stopwatch / timeline track (gradients, mesh, etc.). */
  keyframeable?: boolean;
};

export type LayerTemplate = {
  type: LayerType;
  label: string;
  category: LayerCategory;
  description: string;
  uniforms: LayerUniformDef[];
};

/** Layer visibility window on the timeline, in seconds. Missing bounds fall back to the comp bounds. */
export type LayerTiming = {
  in?: number;
  out?: number;
};

export type LayerInstance = {
  id: string;
  type: LayerType;
  name?: string;
  enabled: boolean;
  values: Record<string, unknown>;
  /** In/out points; layer contributes nothing outside this window. */
  timing?: LayerTiming;
};

export type RenderPass = {
  layerId: string;
  layerType: LayerType | "resolve" | "blit" | "layerComposite";
  uniforms: Record<string, unknown>;
  inputLayerId: string | null;
  colorSourceLayerId?: string | null;  // resolve: color texture; layerComposite: layer content texture
  /** Layer that owns this pass when layerId is synthetic (e.g. composite passes). Used for live uniform lookup. */
  sourceLayerId?: string | null;
  isOutput: boolean;
};

// --- LFO Modulation System ---

export type WavePoint = {
  x: number;       // 0-1, position in cycle
  y: number;       // 0-1, value (0 = min, 1 = max)
  curve: number;   // -1 to 1, quadratic bezier curve control for segment after this point
};

export type LFOPlaybackMode = "loop" | "pingpong";

export type LFOWaveShape = "sine" | "custom";

export type LFOSource = {
  id: string;
  label: string;
  color: string;
  points: WavePoint[];
  waveShape?: LFOWaveShape;
  rate: number;     // Hz
  phase: number;    // 0-360 degrees
  mode: LFOPlaybackMode;
};

export type ModulationAssignment = {
  sourceId: string;
  layerId: string;
  paramName: string;
  depth: number;   // signed: positive = endpoint above base, negative = endpoint below base
};
