import type { LayerInstance, LayerTiming } from "../types/editor";
import type { CompositionConfig } from "../types/composition";
import { UNIVERSAL_LAYER_UNIFORMS } from "./universal-uniforms";
import type { GradientStop } from "../types";
import { DEFAULT_COMPOSITION_SETTINGS } from "../types/animation";
import { MESH_BLOOM_POINTS } from "./mesh-uniforms";
import {
  BAND_GRADIENT_ABOVE,
  BAND_GRADIENT_BELOW,
  DEFAULT_WAVE_GRADIENT,
  WAVE_GRADIENT_BLACK,
  WAVE_GRADIENT_BLACK2,
  WAVE_GRADIENT_BLUE,
  WAVE_GRADIENT_BLUE2,
  WAVE_GRADIENT_LIME,
  WAVE_GRADIENT_PALE,
} from "./composite-defaults";

const LEGACY_WAVE_GRADIENTS: GradientStop[][] = [
  WAVE_GRADIENT_BLUE,
  WAVE_GRADIENT_PALE,
  WAVE_GRADIENT_BLACK,
  WAVE_GRADIENT_LIME,
  WAVE_GRADIENT_BLUE2,
  WAVE_GRADIENT_BLACK2,
];

function cloneStops(stops: GradientStop[]): GradientStop[] {
  return stops.map((s) => ({ ...s }));
}

function ensureGradient(
  layer: LayerInstance,
  name: string,
  fallback: GradientStop[],
) {
  const current = layer.values[name];
  if (Array.isArray(current) && current.length > 0) return;
  layer.values[name] = cloneStops(fallback);
}

/** Backfill composite layer values after schema changes (colorStyle → gradients, etc.). */
export function normalizeCompositeLayer(layer: LayerInstance): void {
  if (layer.type === "waveFill") {
    const legacyStyle = layer.values.colorStyle;
    if (
      !Array.isArray(layer.values.u_gradient) &&
      typeof legacyStyle === "number"
    ) {
      const idx = Math.max(0, Math.min(LEGACY_WAVE_GRADIENTS.length - 1, legacyStyle));
      layer.values.u_gradient = cloneStops(LEGACY_WAVE_GRADIENTS[idx]!);
    }
    ensureGradient(layer, "u_gradient", DEFAULT_WAVE_GRADIENT);
    delete layer.values.colorStyle;
    delete layer.values.angle;
    delete layer.values.stippleSeed;
  }

  if (layer.type === "bandFill") {
    ensureGradient(layer, "u_gradientBelow", BAND_GRADIENT_BELOW);
    ensureGradient(layer, "u_gradientAbove", BAND_GRADIENT_ABOVE);
    delete layer.values.stippleSeed;
    delete layer.values.angle;
  }

  if (layer.type === "mesh") {
    const points = layer.values.u_meshPoints;
    if (!Array.isArray(points) || points.length === 0) {
      layer.values.u_meshPoints = MESH_BLOOM_POINTS.map((p) => ({ ...p }));
    }
  }

  if (layer.type === "diffuse") {
    migrateDiffuseValues(layer.values);
  }

  if (layer.type === "component") {
    if (typeof layer.values.componentName !== "string") {
      layer.values.componentName = "";
    }
    if (typeof layer.values.stageWidth !== "number") {
      layer.values.stageWidth = 640;
    }
  }

  if ((layer.type as string) === "hybridDissolve") {
    const legacy = layer.values;
    const speed = (legacy.dissolveSpeed as number) ?? 0.35;
    layer.type = "diffuse";
    layer.values = {
      amount: 14,
      grainHard: 1,
      direction: 50,
      animate: speed > 0.001,
    };
  }
}

/** Migrate legacy diffuse params (0–1 amount, spread, speed) to scatter-blur schema. */
export function migrateDiffuseValues(values: Record<string, unknown>): void {
  if (typeof values.amount === "number" && values.amount > 0 && values.amount <= 1) {
    values.amount = Math.min(200, Math.max(1, Math.round(values.amount * 100)));
  }

  if (typeof values.grainHard !== "number") {
    const grain = values.grain;
    values.grainHard =
      typeof grain === "number" && grain >= 0 && grain <= 1 ? grain : 1;
  }

  if (typeof values.direction === "number" && values.direction > 100) {
    values.direction = Math.round((values.direction / 360) * 100);
  }

  if (typeof values.animate !== "boolean") {
    const speed = values.speed;
    values.animate = typeof speed === "number" ? speed > 0.001 : false;
  }

  delete values.grain;
  delete values.blend;
  delete values.speed;
  delete values.seed;
}

/** Seed universal transform/opacity values and sanitize the in/out window. */
export function normalizeUniversalLayerProps(layer: LayerInstance, duration: number): void {
  for (const def of UNIVERSAL_LAYER_UNIFORMS) {
    if (typeof layer.values[def.name] !== "number") {
      layer.values[def.name] = def.default;
    }
  }

  if (!layer.timing) return;
  // Overhang past either composition edge is allowed (a bar dragged partly
  // outside keeps its length); we only guarantee the window still overlaps
  // the composition by a sliver so it can always be grabbed in the timeline.
  const OVERLAP_EPS = 0.001;
  let inPoint = typeof layer.timing.in === "number" ? layer.timing.in : undefined;
  let outPoint = typeof layer.timing.out === "number" ? layer.timing.out : undefined;
  if (inPoint !== undefined && outPoint !== undefined && outPoint < inPoint) {
    [inPoint, outPoint] = [outPoint, inPoint];
  }
  if (inPoint !== undefined) inPoint = Math.min(inPoint, duration - OVERLAP_EPS);
  if (outPoint !== undefined) outPoint = Math.max(outPoint, OVERLAP_EPS);
  const timing: LayerTiming = {};
  if (inPoint !== undefined && inPoint !== 0) timing.in = inPoint;
  if (outPoint !== undefined && outPoint !== duration) timing.out = outPoint;
  if (timing.in === undefined && timing.out === undefined) {
    delete layer.timing;
  } else {
    layer.timing = timing;
  }
}

export function normalizeComposition(config: CompositionConfig): void {
  normalizeCompositeLayers(config.layers);
  if (!config.settings) {
    config.settings = { ...DEFAULT_COMPOSITION_SETTINGS };
  } else {
    config.settings = {
      duration: config.settings.duration ?? DEFAULT_COMPOSITION_SETTINGS.duration,
      fps: config.settings.fps ?? DEFAULT_COMPOSITION_SETTINGS.fps,
      width: config.settings.width ?? DEFAULT_COMPOSITION_SETTINGS.width,
      height: config.settings.height ?? DEFAULT_COMPOSITION_SETTINGS.height,
    };
  }
  for (const layer of config.layers) {
    normalizeUniversalLayerProps(layer, config.settings.duration);
  }
  if (!config.tracks) {
    config.tracks = [];
  } else {
    config.tracks = config.tracks.filter((t) => t.enabled && t.keys.length > 0);
  }
}

export function normalizeCompositeLayers(layers: LayerInstance[]): void {
  for (const layer of layers) {
    normalizeCompositeLayer(layer);
  }
}

export function offsetDuplicatedWave(
  values: Record<string, unknown>,
  existingWaveCount: number,
) {
  values.cycleX = 0.15 + existingWaveCount * 0.35;
  values.centerY = 0.35 + (existingWaveCount % 4) * 0.12;
}
