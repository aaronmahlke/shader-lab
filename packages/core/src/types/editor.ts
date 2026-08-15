export type LayerCategory = "generator" | "distortion" | "effect";

export type LayerType =
  | "gradient"
  | "mesh"
  | "solid"
  | "noise"
  | "text"
  | "component"
  | "image"
  | "video"
  | "camera"
  | "shape"
  | "waveFill"
  | "bandFill"
  | "object3d"
  | "light"
  | "composition"
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
  /**
   * AE-style 3D switch (generators only). Adds Z position and X/Y rotation to
   * the universal transform; contiguous 3D layers form a depth-sorted group.
   */
  is3D?: boolean;
  values: Record<string, unknown>;
  /** In/out points; layer contributes nothing outside this window. */
  timing?: LayerTiming;
};

/** Synthetic pass kinds the camera layer compiles into (plus the shared blit/resolve/composite ones). */
export type CameraPassType =
  | "cameraStage"
  | "cameraDof"
  | "bloomPrefilter"
  | "bloomDown"
  | "bloomUp"
  | "cameraComposite";

export type RenderPassType =
  | LayerType
  | "resolve"
  | "blit"
  | "layerComposite"
  | "layerComposite3d"
  | CameraPassType;

/**
 * A composite slot inside a 3D group. Slots have a stable id/FBO/topology;
 * WHICH member layer a slot composites is decided per frame by the renderer
 * (painter's sort by Z depth), so animated depth swaps never change the pass
 * graph signature.
 */
export type ThreeDGroupSlot = {
  /** Stable group key (first member's layer id). */
  key: string;
  /** Visual member layer ids in stack order (bottom → top); the tie-break order. */
  memberIds: string[];
  /** This pass's position in the depth-sorted composite chain. */
  slot: number;
  /** Light layers that illuminate this group (in-group lights, stack order). */
  lightIds?: string[];
};

export type RenderPass = {
  layerId: string;
  layerType: RenderPassType;
  uniforms: Record<string, unknown>;
  inputLayerId: string | null;
  colorSourceLayerId?: string | null;  // resolve: color texture; layerComposite: layer content texture; bloomUp/cameraComposite: second source
  /** Third texture source (cameraComposite: the unprocessed stack for the opacity crossfade). */
  auxSourceLayerId?: string | null;
  /** Layer that owns this pass when layerId is synthetic (e.g. composite passes). Used for live uniform lookup. */
  sourceLayerId?: string | null;
  /** Render target size relative to the frame (bloom mip chain). Default 1. */
  targetScale?: number;
  /** Render into a linear half-float target (camera/lens chain works in linear light). */
  floatTarget?: boolean;
  /** Set on layerComposite3d passes: depth-sorted composite slot of a 3D group. */
  threeDGroup?: ThreeDGroupSlot;
  /** Camera layer piloting this pass's 3D group (nearest drive-3D camera above). */
  cameraSourceLayerId?: string | null;
  /**
   * Composite passes inside NESTED comps accumulate coverage alpha instead of
   * flattening to 1, so a precomp keeps transparency where nothing rendered.
   */
  preserveAlpha?: boolean;
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
