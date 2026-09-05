import type { CompositionConfig } from "../types/composition";
import type { Keyframe, PropertyTrack } from "../types/animation";
import type { LayerInstance, ModulationAssignment } from "../types/editor";
import type { MeshPoint } from "../types/mesh";
import { DEFAULT_COMPOSITION_SETTINGS } from "../types/animation";
import { ModulationEngine } from "../modulation/engine";
import { findLayerParamDef } from "../compiler/universal-uniforms";

export type BakeLfoOptions = {
  /** Sample rate in Hz. Defaults to the composition fps. */
  fps?: number;
  /** Seconds of timeline to bake. Defaults to the composition duration. */
  duration?: number;
  /**
   * Max deviation of the baked track from the sampled curve, as a fraction of
   * that parameter's peak-to-peak swing. 0 keeps every sample that carries
   * information (collinear ones are always redundant).
   */
  tolerance?: number;
  /** Bake over a parameter that already has an enabled track. Off by default. */
  overwrite?: boolean;
  /** Bake only the assignments this returns true for. Defaults to all of them. */
  filter?: (assignment: ModulationAssignment) => boolean;
};

export type BakedTrack = {
  layerId: string;
  paramName: string;
  /** Keyframes written after simplification. */
  keys: number;
  /** Samples taken before simplification. */
  samples: number;
};

export type SkipReason =
  | "missing-layer"
  | "missing-source"
  | "unknown-param"
  | "existing-keyframes";

export type SkippedAssignment = {
  layerId: string;
  paramName: string;
  reason: SkipReason;
};

export type BakeLfoResult = {
  /** Config with baked tracks written and the baked assignments removed. */
  config: CompositionConfig;
  baked: BakedTrack[];
  skipped: SkippedAssignment[];
};

const MESH_PARAM = /^mesh\.(\d+)\.(x|y|radius)$/;

/**
 * Base value the renderer would feed the modulation fn for this parameter.
 * Mirrors `buildLayerUniforms` / `expandMeshUniforms` / `buildUniversalUniforms`.
 */
function resolveBaseValue(layer: LayerInstance, paramName: string): number | null {
  const mesh = MESH_PARAM.exec(paramName);
  if (mesh) {
    const index = Number(mesh[1]);
    const field = mesh[2] as keyof MeshPoint;
    const points = (layer.values.u_meshPoints as MeshPoint[] | undefined) ?? [];
    const point = points[index];
    if (!point) return null;
    const value = point[field];
    if (typeof value === "number") return value;
    return field === "radius" ? 0.001 : 0;
  }

  const raw = layer.values[paramName];
  if (typeof raw === "number") return raw;

  const def = findLayerParamDef(layer, paramName);
  if (def && typeof def.default === "number") return def.default;
  return null;
}

/**
 * Drop samples a linear segment already reproduces within `epsilon`.
 * Vertical (not perpendicular) distance, because that is the error the
 * timeline's linear interpolation actually makes.
 */
function simplify(times: number[], values: number[], epsilon: number): Keyframe[] {
  const keep = new Array<boolean>(times.length).fill(false);
  keep[0] = true;
  keep[times.length - 1] = true;

  const stack: Array<[number, number]> = [[0, times.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    if (end - start < 2) continue;

    const span = times[end]! - times[start]!;
    const rise = values[end]! - values[start]!;
    let worst = -1;
    let worstIndex = -1;

    for (let i = start + 1; i < end; i++) {
      const t = span <= 1e-12 ? 0 : (times[i]! - times[start]!) / span;
      const error = Math.abs(values[i]! - (values[start]! + rise * t));
      if (error > worst) {
        worst = error;
        worstIndex = i;
      }
    }

    if (worst > epsilon && worstIndex > 0) {
      keep[worstIndex] = true;
      stack.push([start, worstIndex], [worstIndex, end]);
    }
  }

  const keys: Keyframe[] = [];
  for (let i = 0; i < times.length; i++) {
    if (keep[i]) keys.push({ time: times[i]!, value: values[i]!, ease: "linear" });
  }
  return keys;
}

/**
 * Freeze LFO assignments into keyframes on the timeline.
 *
 * Samples each assignment through the same `ModulationEngine` the renderer
 * uses, so the baked track reproduces what playback showed, then thins the
 * samples down to the keys an editor can actually work with. Baked assignments
 * are removed from the config; their LFO sources are left in place because
 * other assignments (or the user) may still want them.
 */
export function bakeLfoAssignments(
  config: CompositionConfig,
  options: BakeLfoOptions = {},
): BakeLfoResult {
  const settings = config.settings ?? DEFAULT_COMPOSITION_SETTINGS;
  const duration = Math.max(0, options.duration ?? settings.duration);
  const fps = Math.max(1, options.fps ?? settings.fps);
  const tolerance = Math.max(0, options.tolerance ?? 0.01);
  const tracks = config.tracks ?? [];

  const baked: BakedTrack[] = [];
  const skipped: SkippedAssignment[] = [];
  const targets: Array<{ assignment: ModulationAssignment; base: number }> = [];

  for (const assignment of config.assignments) {
    if (options.filter && !options.filter(assignment)) continue;

    const where = { layerId: assignment.layerId, paramName: assignment.paramName };
    const layer = config.layers.find((l) => l.id === assignment.layerId);
    if (!layer) {
      skipped.push({ ...where, reason: "missing-layer" });
      continue;
    }
    if (!config.lfos.some((lfo) => lfo.id === assignment.sourceId)) {
      skipped.push({ ...where, reason: "missing-source" });
      continue;
    }
    const existing = tracks.find(
      (t) => t.layerId === assignment.layerId && t.paramName === assignment.paramName,
    );
    // An enabled track wins over the LFO even with no keys, so baking over one
    // would change what playback shows.
    if (existing?.enabled && !options.overwrite) {
      skipped.push({ ...where, reason: "existing-keyframes" });
      continue;
    }
    const base = resolveBaseValue(layer, assignment.paramName);
    if (base === null) {
      skipped.push({ ...where, reason: "unknown-param" });
      continue;
    }

    targets.push({ assignment, base });
  }

  if (targets.length === 0) {
    return { config, baked, skipped };
  }

  const engine = new ModulationEngine();
  engine.setLfos(config.lfos);
  engine.setAssignments(config.assignments);

  const frames = Math.max(2, Math.ceil(duration * fps) + 1);
  const times: number[] = [];
  const series = targets.map(() => [] as number[]);

  for (let frame = 0; frame < frames; frame++) {
    const time = duration === 0 ? 0 : Math.min(duration, frame / fps);
    times.push(time);
    engine.sampleAt(time);
    for (let i = 0; i < targets.length; i++) {
      const { assignment, base } = targets[i]!;
      series[i]!.push(
        engine.getModulatedValue(assignment.layerId, assignment.paramName, base),
      );
    }
  }

  let nextTracks = tracks.filter(
    (track) =>
      !targets.some(
        ({ assignment }) =>
          assignment.layerId === track.layerId && assignment.paramName === track.paramName,
      ),
  );

  for (let i = 0; i < targets.length; i++) {
    const { assignment } = targets[i]!;
    const values = series[i]!;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const swing = max - min;

    const keys: Keyframe[] =
      swing <= 1e-9
        ? [{ time: 0, value: values[0]!, ease: "linear" }]
        : simplify(times, values, tolerance * swing);

    const track: PropertyTrack = {
      layerId: assignment.layerId,
      paramName: assignment.paramName,
      enabled: true,
      keys,
    };
    nextTracks = [...nextTracks, track];
    baked.push({
      layerId: assignment.layerId,
      paramName: assignment.paramName,
      keys: keys.length,
      samples: values.length,
    });
  }

  const bakedSet = new Set(targets.map(({ assignment }) => assignment));

  return {
    config: {
      ...config,
      assignments: config.assignments.filter((a) => !bakedSet.has(a)),
      tracks: nextTracks,
    },
    baked,
    skipped,
  };
}
