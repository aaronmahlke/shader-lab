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
  | "audio"
  | "pointer"
  | "camera"
  | "shape"
  | "waveFill"
  | "bandFill"
  | "object3d"
  | "light"
  | "effector"
  | "cloner"
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
  type: "float" | "int" | "color" | "vec2" | "gradient" | "meshPoints" | "bool" | "select" | "text" | "layerRefs";
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
  /** Parent layer id (AE parenting): this layer's transform is relative to it. */
  parent?: string;
  /** Attach to a named point on the parent instead of its anchor (e.g. "textEnd"). */
  parentPoint?: string;
  /** Set on virtual cloner copies only (never persisted). */
  clone?: CloneInfo;
  /**
   * Mixer effect chain (audio layers, precomp buses): see the editor's
   * audio-effects definitions. Params automate via `fx:<id>:<param>` tracks.
   */
  audioEffects?: { id: string; type: string; enabled?: boolean; params: Record<string, number>; source?: string }[];
  /** Mixer: silence this layer's sound (audio layers, precomp buses) without hiding it. */
  audioMuted?: boolean;
  /** Mixer: solo — when any layer is soloed, only soloed sounds (and their groups) play. */
  audioSolo?: boolean;
  /** Motion blur for this layer (comp switch on): unset = on, false = off. */
  motionBlur?: boolean;
  /** Timeline track height in px (UI only; taller rows show waveforms bigger). */
  rowHeight?: number;
};

/** Where a virtual cloner copy sits in its cloner's layout. */
export type CloneInfo = {
  clonerId: string;
  sourceId: string;
  index: number;
  /** Grid layout: centered cell coordinates (x, y, z). */
  grid: [number, number, number];
  /** Radial layout: angle on the ring (radians), else null. */
  angle: number | null;
  /** Position in the cloner's stagger order (copy plays its keys rank × stagger later). */
  staggerRank?: number;
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

/**
 * ADSR envelope modulator. Each trigger opens a gate for `gate` seconds:
 * attack ramps to 1, decay falls to `sustain`, and once the gate closes the
 * level releases to 0. A retrigger starts its attack from the current level.
 */
export type EnvelopeSource = {
  id: string;
  label: string;
  color: string;
  attack: number;   // seconds
  decay: number;    // seconds
  sustain: number;  // 0-1 level held while the gate is open
  gate: number;     // seconds the gate stays open per trigger
  release: number;  // seconds
  /** Trigger times in the link's time base (seconds). Defaults to [0]. */
  triggers?: number[];
};

/**
 * Clock a link reads its modulator on. "layer" restarts at the target
 * layer's in-point (envelope triggers become relative to it).
 */
export type ModulationTimeBase = "comp" | "layer";

/**
 * Link from a modulator (LFO or envelope) to any numeric property. Links
 * stack on top of the property's base (static value or keyframes):
 * `value = base + Σ depth × signal`. `depth` and `enabled` can be keyframed
 * through `linkTrackLayerId(link)` tracks.
 */
export type ModulationAssignment = {
  /** Stable id for link tracks. Falls back to source/layer/param when missing. */
  id?: string;
  sourceId: string;
  layerId: string;
  paramName: string;
  depth: number;   // signed: positive = endpoint above base, negative = endpoint below base
  /** Off = link contributes nothing. Defaults to true. */
  enabled?: boolean;
  /** Defaults to "comp". */
  timeBase?: ModulationTimeBase;
};
