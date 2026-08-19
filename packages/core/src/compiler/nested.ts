import type { CompositionConfig } from "../types/composition";
import type { LayerInstance, RenderPass } from "../types/editor";
import type { ModulationFn } from "./compile-passes";
import { NESTED_SEP } from "./compile-passes";
import { ModulationEngine } from "../modulation/engine";
import { createAnimatedModulationFn } from "../animation/create-modulation-fn";

/**
 * Per-frame resolvers that make nested composition passes work through the
 * existing findLayer / modulation machinery.
 *
 * Nested pass source ids look like `host1::host2::layerId` (hosts are
 * composition layers). Each nesting level runs on its own clock: local time =
 * parent time minus the host layer's in-point, so a trimmed precomp starts at
 * its own 0 (AE model). Keyframes and LFOs of the nested comp evaluate at
 * that local time via a per-instance modulation engine.
 */

export type NestedResolverOptions = {
  /** The open (root) composition's layers. */
  layers: LayerInstance[];
  /** Root comp's animated modulation fn for this frame (keyframes + LFOs). */
  parentModFn: ModulationFn | null;
  /** Registry lookup for referenced compositions. */
  resolveComposition: (compId: string) => CompositionConfig | null | undefined;
  /** Current time in the root composition, seconds. */
  time: number;
};

type Instance = {
  config: CompositionConfig;
  /** Sum of host in-points up to this instance (parent time − local time). */
  timeShift: number;
  layersById: Map<string, LayerInstance>;
  modFn: ModulationFn;
};

export function createNestedResolvers(opts: NestedResolverOptions): {
  findLayer: (pass: RenderPass) => LayerInstance | undefined;
  modFn: ModulationFn;
} {
  const rootById = new Map(opts.layers.map((l) => [l.id, l]));
  const instances = new Map<string, Instance | null>();

  /** Resolve (and cache) the instance for a host path like "h1::h2". */
  function instanceFor(hostPath: string[]): Instance | null {
    const key = hostPath.join(NESTED_SEP);
    if (instances.has(key)) return instances.get(key)!;

    let layersById = rootById;
    let timeShift = 0;
    let config: CompositionConfig | null = null;

    for (const hostId of hostPath) {
      const host = layersById.get(hostId);
      const compId = typeof host?.values.compRefId === "string" ? host.values.compRefId : "";
      const resolved = compId ? opts.resolveComposition(compId) : null;
      if (!host || !resolved) {
        instances.set(key, null);
        return null;
      }
      timeShift += host.timing?.in ?? 0;
      config = resolved;
      layersById = new Map(config.layers.map((l) => [l.id, l]));
    }

    if (!config) {
      instances.set(key, null);
      return null;
    }

    const localTime = opts.time - timeShift;
    const engine = new ModulationEngine();
    engine.setLfos(config.lfos ?? []);
    engine.setAssignments(config.assignments ?? []);
    engine.sampleAt(Math.max(localTime, 0));
    const modFn = createAnimatedModulationFn(Math.max(localTime, 0), config.tracks ?? [], engine);

    const instance: Instance = { config, timeShift, layersById, modFn };
    instances.set(key, instance);
    return instance;
  }

  function splitSourceId(id: string): { hostPath: string[]; layerId: string } | null {
    if (!id.includes(NESTED_SEP)) return null;
    const parts = id.split(NESTED_SEP);
    return { hostPath: parts.slice(0, -1), layerId: parts[parts.length - 1]! };
  }

  function findLayer(pass: RenderPass): LayerInstance | undefined {
    const id = pass.sourceLayerId ?? pass.layerId;
    const nested = splitSourceId(id);
    if (!nested) return rootById.get(id);

    const instance = instanceFor(nested.hostPath);
    const layer = instance?.layersById.get(nested.layerId);
    if (!instance || !layer) return undefined;

    // Report the layer under its prefixed id (so modFn can route back to the
    // right instance) with timing shifted into the ROOT time base — the
    // renderer gates in/out against root time.
    const timing = layer.timing
      ? {
          in: layer.timing.in != null ? layer.timing.in + instance.timeShift : undefined,
          out: layer.timing.out != null ? layer.timing.out + instance.timeShift : undefined,
        }
      : undefined;
    return { ...layer, id, timing };
  }

  const modFn: ModulationFn = (layerId, paramName, baseValue) => {
    const nested = splitSourceId(layerId);
    if (!nested) {
      return opts.parentModFn ? opts.parentModFn(layerId, paramName, baseValue) : baseValue;
    }
    const instance = instanceFor(nested.hostPath);
    if (!instance) return baseValue;
    return instance.modFn(nested.layerId, paramName, baseValue);
  };

  return { findLayer, modFn };
}