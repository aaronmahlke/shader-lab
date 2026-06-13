export type LayerCategory = "generator" | "distortion" | "effect";

export type LayerType =
  | "gradient"
  | "mesh"
  | "solid"
  | "noise"
  | "waveFill"
  | "bandFill"
  | "distortion"
  | "dither"
  | "grain"
  | "seam"
  | "hybridDissolve"
  | "vignette"
  | "chromaticAberration";

export type LayerUniformDef = {
  name: string;
  type: "float" | "int" | "color" | "vec2" | "gradient" | "meshPoints" | "bool" | "select";
  label: string;
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: { label: string; value: string | number }[];
};

export type LayerTemplate = {
  type: LayerType;
  label: string;
  category: LayerCategory;
  description: string;
  uniforms: LayerUniformDef[];
};

export type LayerInstance = {
  id: string;
  type: LayerType;
  name?: string;
  enabled: boolean;
  values: Record<string, unknown>;
};

export type RenderPass = {
  layerId: string;
  layerType: LayerType | "resolve" | "blit";
  uniforms: Record<string, unknown>;
  inputLayerId: string | null;
  /** Stipple accumulator input (dual-buffer composite pipeline). */
  stippleInputLayerId?: string | null;
  colorSourceLayerId?: string | null;  // for resolve pass: which layer has the color texture
  isOutput: boolean;
};

// --- LFO Modulation System ---

export type WavePoint = {
  x: number;       // 0-1, position in cycle
  y: number;       // 0-1, value (0 = min, 1 = max)
  curve: number;   // -1 to 1, quadratic bezier curve control for segment after this point
};

export type LFOPlaybackMode = "loop" | "pingpong";

export type LFOSource = {
  id: string;
  label: string;
  color: string;
  points: WavePoint[];
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
