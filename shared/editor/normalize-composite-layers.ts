import type { LayerInstance } from "../types/editor";
import type { GradientStop } from "../types";
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
