import type { LayerInstance } from "../types/editor";

export const COMPOSITE_LAYER_TYPES = new Set<LayerInstance["type"]>([
  "waveFill",
  "bandFill",
]);

export type HybridContext = {
  dissolveReach: number;
  edgeWidth: number;
  dotSize: number;
  dissolveSpeed: number;
  dissolveSeed: number;
};

export function stippleLayerId(layerId: string): string {
  return `${layerId}:stipple`;
}

export function findHybridDissolveLayer(
  layers: LayerInstance[],
): LayerInstance | undefined {
  return layers.find((l) => l.enabled && l.type === "hybridDissolve");
}

export function getHybridContext(layers: LayerInstance[]): HybridContext {
  const hybrid = findHybridDissolveLayer(layers);
  return {
    dissolveReach: (hybrid?.values.dissolveReach as number) ?? 4,
    edgeWidth: (hybrid?.values.edgeWidth as number) ?? 0.37,
    dotSize: (hybrid?.values.dotSize as number) ?? 1.5,
    dissolveSpeed: (hybrid?.values.dissolveSpeed as number) ?? 0.35,
    dissolveSeed: (hybrid?.values.seed as number) ?? 0,
  };
}

/** Dual smooth/stipple buffers when composite + hybrid dissolve are both present. */
export function usesDualPipeline(layers: LayerInstance[]): boolean {
  const enabled = layers.filter((l) => l.enabled);
  const hasComposite = enabled.some((l) => COMPOSITE_LAYER_TYPES.has(l.type));
  const hasHybrid = enabled.some((l) => l.type === "hybridDissolve");
  return hasComposite && hasHybrid;
}
