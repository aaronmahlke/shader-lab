import type { LayerInstance, RenderPass } from "../types/editor";
import LAYER_TEMPLATES from "./layer-templates";
import { expandMeshUniforms } from "./mesh-uniforms";

export type ModulationFn = (
  layerId: string,
  paramName: string,
  baseValue: number,
) => number;

const COMPOSITE_LAYER_TYPES = new Set<LayerInstance["type"]>(["waveFill", "bandFill"]);

/** Build shader uniforms from a layer's current values (and optional LFO modulation). */
export function buildLayerUniforms(
  layer: LayerInstance,
  modFn: ModulationFn | null,
): Record<string, unknown> {
  const template = LAYER_TEMPLATES[layer.type];
  if (!template) return {};

  const uniforms: Record<string, unknown> = {};
  for (const def of template.uniforms) {
    let value = layer.values[def.name] ?? def.default;
    if (modFn && typeof value === "number") {
      value = modFn(layer.id, def.name, value);
    }
    uniforms[def.name] = value;
  }

  if (layer.type === "mesh") {
    return expandMeshUniforms(uniforms, modFn, layer.id);
  }

  return uniforms;
}

function compositeUniforms(
  layer: LayerInstance,
  modFn: ModulationFn | null,
): Record<string, unknown> {
  return buildLayerUniforms(layer, modFn);
}

/** Exclusive end index of a contiguous distortion run starting at `start`. */
function distortionRunEnd(enabled: LayerInstance[], start: number): number {
  let i = start;
  while (i < enabled.length && enabled[i]!.type === "distortion") i++;
  return i;
}

function effectiveAmplitude(layer: LayerInstance, modFn: ModulationFn | null): number {
  const base = (layer.values.amplitude as number) ?? 0.5;
  if (!modFn) return base;
  return modFn(layer.id, "amplitude", base);
}

/** True when every layer in the run has ~zero amplitude (skip distort + resolve). */
function isDistortionRunInert(
  run: LayerInstance[],
  modFn: ModulationFn | null,
): boolean {
  return run.every((layer) => Math.abs(effectiveAmplitude(layer, modFn)) < 1e-6);
}

/** Every pass renders to an RT; blit the final accumulator to the screen. */
function finishWithScreenBlit(
  passes: RenderPass[],
  sourceLayerId: string | null,
): RenderPass[] {
  if (!sourceLayerId || passes.length === 0) return passes;

  return [
    ...passes.map((p) => ({ ...p, isOutput: false as const })),
    {
      layerId: "blit-out",
      layerType: "blit" as const,
      uniforms: {},
      inputLayerId: sourceLayerId,
      isOutput: true,
    },
  ];
}

/**
 * Compile layers (UI order top → bottom) into render passes (bottom → top).
 * Contiguous distortion layers form one run: accumulate displacement, then resolve.
 */
export function compilePasses(
  layers: LayerInstance[],
  modFn: ModulationFn | null = null,
): RenderPass[] {
  const enabled = [...layers].reverse().filter((l) => l.enabled);
  if (enabled.length === 0) return [];

  const result: RenderPass[] = [];
  let previousLayerId: string | null = null;

  for (let i = 0; i < enabled.length; ) {
    const layer = enabled[i]!;
    const template = LAYER_TEMPLATES[layer.type];
    if (!template) {
      i++;
      continue;
    }

    if (COMPOSITE_LAYER_TYPES.has(layer.type)) {
      result.push({
        layerId: layer.id,
        layerType: layer.type,
        uniforms: compositeUniforms(layer, modFn),
        inputLayerId: previousLayerId,
        isOutput: false,
      });
      previousLayerId = layer.id;
      i++;
      continue;
    }

    if (layer.type === "distortion") {
      const runEnd = distortionRunEnd(enabled, i);
      const runLayers = enabled.slice(i, runEnd);

      if (isDistortionRunInert(runLayers, modFn)) {
        if (runEnd === enabled.length && previousLayerId) {
          result.push({
            layerId: `blit-${previousLayerId}`,
            layerType: "blit",
            uniforms: {},
            inputLayerId: previousLayerId,
            isOutput: false,
          });
          previousLayerId = `blit-${previousLayerId}`;
        }
        i = runEnd;
        continue;
      }

      const colorSourceLayerId = previousLayerId;
      if (!colorSourceLayerId) {
        i = runEnd;
        continue;
      }

      let prevDisplacementLayerId: string | null = null;

      for (let g = i; g < runEnd; g++) {
        const gLayer = enabled[g]!;
        result.push({
          layerId: gLayer.id,
          layerType: gLayer.type,
          uniforms: buildLayerUniforms(gLayer, modFn),
          inputLayerId: g === i ? null : prevDisplacementLayerId,
          isOutput: false,
        });
        prevDisplacementLayerId = gLayer.id;
      }

      const resolveId = `resolve-${enabled[i]!.id}`;
      result.push({
        layerId: resolveId,
        layerType: "resolve",
        uniforms: {},
        inputLayerId: prevDisplacementLayerId,
        colorSourceLayerId,
        isOutput: false,
      });

      previousLayerId = resolveId;
      i = runEnd;
      continue;
    }

    const isGenerator = template.category === "generator";
    result.push({
      layerId: layer.id,
      layerType: layer.type,
      uniforms: buildLayerUniforms(layer, modFn),
      inputLayerId: isGenerator ? null : previousLayerId,
      isOutput: false,
    });

    previousLayerId = layer.id;
    i++;
  }

  return finishWithScreenBlit(result, previousLayerId);
}
