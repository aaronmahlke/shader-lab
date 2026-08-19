import type { CompositionConfig } from "../types/composition";
import type { LayerInstance, RenderPass } from "../types/editor";
import LAYER_TEMPLATES from "./layer-templates";
import { expandMeshUniforms } from "./mesh-uniforms";
import { buildUniversalUniforms, isLayer3D, layerOpacityValue } from "./universal-uniforms";

export type ModulationFn = (
  layerId: string,
  paramName: string,
  baseValue: number,
) => number;

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

  // Universal opacity: effects crossfade in-shader; distortion scales its displacement.
  if (template.category === "effect") {
    uniforms.layerOpacity = layerOpacityValue(layer, modFn);
  } else if (template.category === "distortion") {
    const opacity = layerOpacityValue(layer, modFn) / 100;
    uniforms.amplitude = ((uniforms.amplitude as number) ?? 0) * opacity;
  }

  if (layer.type === "mesh") {
    return expandMeshUniforms(uniforms, modFn, layer.id);
  }

  return uniforms;
}

/** Synthetic pass id for a generator layer's transform/opacity composite step. */
export function compositePassId(layerId: string): string {
  return `composite-${layerId}`;
}

/** Synthetic pass id for a 3D group's composite slot. */
export function threeDSlotPassId(groupKey: string, slot: number): string {
  return `3dslot-${groupKey}-${slot}`;
}

/** Separator between a host composition-layer id and nested pass ids. */
export const NESTED_SEP = "::";

export type CompileOptions = {
  /** Resolve a nested composition's config by id (the editor's registry). */
  resolveComposition?: (compId: string) => CompositionConfig | null | undefined;
  /** Id of the composition being compiled (guards direct self-nesting). */
  rootCompositionId?: string;
  /** Comp ids on the current descent path (cycle guard). @internal */
  _stack?: ReadonlySet<string>;
};

const MAX_NESTING_DEPTH = 4;

/** Prefix a nested pass so ids stay unique per host layer and resolvable. */
function prefixNestedPass(prefix: string, pass: RenderPass): RenderPass {
  const p = (id: string) => `${prefix}${id}`;
  return {
    ...pass,
    layerId: p(pass.layerId),
    inputLayerId: pass.inputLayerId != null ? p(pass.inputLayerId) : pass.inputLayerId,
    colorSourceLayerId:
      pass.colorSourceLayerId != null ? p(pass.colorSourceLayerId) : pass.colorSourceLayerId,
    auxSourceLayerId:
      pass.auxSourceLayerId != null ? p(pass.auxSourceLayerId) : pass.auxSourceLayerId,
    sourceLayerId: p(pass.sourceLayerId ?? pass.layerId),
    cameraSourceLayerId:
      pass.cameraSourceLayerId != null ? p(pass.cameraSourceLayerId) : pass.cameraSourceLayerId,
    threeDGroup: pass.threeDGroup
      ? {
          ...pass.threeDGroup,
          key: p(pass.threeDGroup.key),
          memberIds: pass.threeDGroup.memberIds.map(p),
          lightIds: pass.threeDGroup.lightIds?.map(p),
        }
      : pass.threeDGroup,
  };
}

/**
 * The nearest camera ABOVE a 3D group (index >= fromIndex in the bottom→top
 * array) with the drive-3D switch on. That camera's view pilots the group.
 */
function findDrivingCameraId(enabled: LayerInstance[], fromIndex: number): string | null {
  for (let i = fromIndex; i < enabled.length; i++) {
    const layer = enabled[i]!;
    if (layer.type !== "camera") continue;
    return layer.values.drive3d === true ? layer.id : null;
  }
  return null;
}

/** Composite pass: blends a generator's content FBO onto the stack below with transform + opacity. */
function makeCompositePass(
  layer: LayerInstance,
  belowLayerId: string | null,
  modFn: ModulationFn | null,
): RenderPass {
  return {
    layerId: compositePassId(layer.id),
    layerType: "layerComposite",
    uniforms: buildUniversalUniforms(layer, modFn),
    inputLayerId: belowLayerId,
    colorSourceLayerId: layer.id,
    sourceLayerId: layer.id,
    isOutput: false,
  };
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
 * Emit a nested composition's pass stack (prefixed) plus a blit that lands the
 * result in an FBO keyed by the HOST layer id — so composite/slot passes can
 * treat the nested comp exactly like any generator's content.
 * Returns false when there is nothing to show (unresolved ref, cycle, empty).
 */
function emitNestedComposition(
  layer: LayerInstance,
  previous: RenderPass[],
  modFn: ModulationFn | null,
  opts: CompileOptions | undefined,
): boolean {
  const compId = typeof layer.values.compRefId === "string" ? layer.values.compRefId : "";
  if (!compId || !opts?.resolveComposition) return false;

  const stack = opts._stack ?? new Set<string>(opts.rootCompositionId ? [opts.rootCompositionId] : []);
  if (stack.has(compId) || stack.size >= MAX_NESTING_DEPTH) return false;

  const config = opts.resolveComposition(compId);
  if (!config) return false;

  const nested = compileStack(config.layers, modFn, {
    ...opts,
    _stack: new Set([...stack, compId]),
  });
  if (!nested.lastId) return false;

  const prefix = `${layer.id}${NESTED_SEP}`;
  for (const pass of nested.passes) previous.push(prefixNestedPass(prefix, pass));
  previous.push({
    layerId: layer.id,
    layerType: "blit",
    uniforms: {},
    inputLayerId: `${prefix}${nested.lastId}`,
    isOutput: false,
  });
  return true;
}

/**
 * Compile layers (UI order top → bottom) into render passes (bottom → top).
 * Contiguous distortion layers form one run: accumulate displacement, then resolve.
 */
export function compilePasses(
  layers: LayerInstance[],
  modFn: ModulationFn | null = null,
  opts?: CompileOptions,
): RenderPass[] {
  const { passes, lastId } = compileStack(layers, modFn, opts);
  return finishWithScreenBlit(passes, lastId);
}

/** Core walk shared by the top-level comp and nested comps (no screen blit). */
function compileStack(
  layers: LayerInstance[],
  modFn: ModulationFn | null,
  opts: CompileOptions | undefined,
): { passes: RenderPass[]; lastId: string | null } {
  const enabled = [...layers].reverse().filter((l) => l.enabled);
  if (enabled.length === 0) return { passes: [], lastId: null };

  const result: RenderPass[] = [];
  let previousLayerId: string | null = null;

  for (let i = 0; i < enabled.length; ) {
    const layer = enabled[i]!;
    const template = LAYER_TEMPLATES[layer.type];
    if (!template) {
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

    if (layer.type === "camera") {
      // The camera films the accumulated stack below it (the "plate").
      // Without a plate there is nothing to film — skip a bottom camera.
      if (!previousLayerId) {
        i++;
        continue;
      }

      const plateId = previousLayerId;
      const uniforms = buildLayerUniforms(layer, modFn);
      const stageId = `${layer.id}-stage`;
      const dofId = `${layer.id}-dof`;
      const preId = `${layer.id}-bloom-pre`;
      const downIds = [`${layer.id}-bloom-down-1`, `${layer.id}-bloom-down-2`, `${layer.id}-bloom-down-3`];
      const upIds = [`${layer.id}-bloom-up-2`, `${layer.id}-bloom-up-1`, `${layer.id}-bloom-up-0`];

      const cameraPass = (
        layerId: string,
        layerType: RenderPass["layerType"],
        inputLayerId: string | null,
        extra: Partial<RenderPass> = {},
      ): RenderPass => ({
        layerId,
        layerType,
        uniforms,
        inputLayerId,
        sourceLayerId: layer.id,
        isOutput: false,
        ...extra,
      });

      // Plate projection and DOF run at full resolution in linear light.
      result.push(cameraPass(stageId, "cameraStage", plateId, { floatTarget: true }));
      result.push(cameraPass(dofId, "cameraDof", stageId, { floatTarget: true }));
      // Bloom mip chain: half → 1/16 down, then an additive tent walk back up.
      result.push(cameraPass(preId, "bloomPrefilter", dofId, { floatTarget: true, targetScale: 0.5 }));
      result.push(cameraPass(downIds[0]!, "bloomDown", preId, { floatTarget: true, targetScale: 0.25 }));
      result.push(cameraPass(downIds[1]!, "bloomDown", downIds[0]!, { floatTarget: true, targetScale: 0.125 }));
      result.push(cameraPass(downIds[2]!, "bloomDown", downIds[1]!, { floatTarget: true, targetScale: 0.0625 }));
      result.push(cameraPass(upIds[0]!, "bloomUp", downIds[2]!, { floatTarget: true, targetScale: 0.125, colorSourceLayerId: downIds[1] }));
      result.push(cameraPass(upIds[1]!, "bloomUp", upIds[0]!, { floatTarget: true, targetScale: 0.25, colorSourceLayerId: downIds[0] }));
      result.push(cameraPass(upIds[2]!, "bloomUp", upIds[1]!, { floatTarget: true, targetScale: 0.5, colorSourceLayerId: preId }));
      // Composite back to sRGB; aux carries the unprocessed stack for the
      // universal-opacity crossfade (and the timing gate).
      result.push(cameraPass(layer.id, "cameraComposite", dofId, {
        colorSourceLayerId: upIds[2],
        auxSourceLayerId: plateId,
      }));

      previousLayerId = layer.id;
      i++;
      continue;
    }

    if (isLayer3D(layer)) {
      // Contiguous 3D layers form one depth-sorted group (AE model):
      // content passes render each visual member, then a chain of composite
      // SLOTS blends them onto the stack. Slot ids/topology are stable; the
      // renderer assigns members to slots per frame (painter's sort by Z).
      // Lights are non-rendering members; 3D objects ray-trace in their slot
      // (no content FBO). The nearest drive-3D camera above pilots the group.
      let runEnd = i;
      while (runEnd < enabled.length && isLayer3D(enabled[runEnd]!)) runEnd++;
      const run = enabled.slice(i, runEnd);
      const lights = run.filter((m) => m.type === "light");
      const visual = run.filter((m) => m.type !== "light");

      // Nested comps render their pass stack first (normalized into an FBO
      // keyed by the member id). Unresolved/cyclic refs drop out of the group.
      const members: LayerInstance[] = [];
      for (const member of visual) {
        if (member.type === "composition") {
          if (emitNestedComposition(member, result, modFn, opts)) members.push(member);
          continue;
        }
        members.push(member);
      }

      if (members.length === 0) {
        i = runEnd;
        continue;
      }

      const memberIds = members.map((m) => m.id);
      const lightIds = lights.map((m) => m.id);
      const groupKey = memberIds[0]!;
      const cameraSourceLayerId = findDrivingCameraId(enabled, runEnd);

      for (const member of members) {
        if (member.type === "object3d" || member.type === "composition") continue; // no content pass
        result.push({
          layerId: member.id,
          layerType: member.type,
          uniforms: buildLayerUniforms(member, modFn),
          inputLayerId: null,
          isOutput: false,
        });
      }

      for (let slot = 0; slot < members.length; slot++) {
        const slotId = threeDSlotPassId(groupKey, slot);
        // Default member assignment is stack order; the renderer re-sorts.
        const member = members[slot]!;
        result.push({
          layerId: slotId,
          layerType: "layerComposite3d",
          uniforms: buildUniversalUniforms(member, modFn),
          inputLayerId: slot === 0 ? previousLayerId : threeDSlotPassId(groupKey, slot - 1),
          colorSourceLayerId: member.type === "object3d" ? null : member.id,
          sourceLayerId: member.id,
          threeDGroup: { key: groupKey, memberIds, slot, lightIds },
          cameraSourceLayerId,
          isOutput: false,
        });
      }

      previousLayerId = threeDSlotPassId(groupKey, members.length - 1);
      i = runEnd;
      continue;
    }

    if (layer.type === "composition") {
      // Nested comp: its stack renders into an FBO keyed by this layer's id,
      // then the normal composite pass applies transform/opacity/blend.
      if (emitNestedComposition(layer, result, modFn, opts)) {
        result.push(makeCompositePass(layer, previousLayerId, modFn));
        previousLayerId = compositePassId(layer.id);
      }
      i++;
      continue;
    }

    if (layer.type === "light") {
      // A light outside any 3D group illuminates nothing and renders nothing.
      i++;
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

    if (isGenerator) {
      // Generators render pure content (alpha = coverage); the composite pass
      // applies universal transform + opacity and blends onto the stack below.
      result.push(makeCompositePass(layer, previousLayerId, modFn));
      previousLayerId = compositePassId(layer.id);
    } else {
      previousLayerId = layer.id;
    }
    i++;
  }

  return { passes: result, lastId: previousLayerId };
}
