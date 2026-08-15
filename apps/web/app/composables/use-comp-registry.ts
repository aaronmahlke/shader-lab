import type { CompositionConfig, LayerInstance } from "@shader-lab/core";

/** Composition row from GET /api/projects/:id/compositions/:compId. */
type CompositionDoc = { id: string; data: CompositionConfig };

/** Safety cap: never hold more than this many referenced comps. */
const MAX_REGISTRY_SIZE = 10;

/**
 * Registry of referenced compositions for nested composition layers.
 *
 * Watches the open comp's layers for `compRefId` values, fetches missing
 * comps (including comps referenced BY those comps, transitively) and exposes
 * `resolveComposition` for the compiler/renderer. `registryVersion` bumps
 * whenever a comp arrives so consumers can recompile.
 *
 * Fetch failures are silent: an unresolved ref simply renders nothing (the
 * core compiler already guards unresolved/cyclic refs).
 */
export function useCompRegistry(options: {
  projectId: Ref<string | null>;
  layers: Ref<LayerInstance[]>;
}) {
  const registry = ref<Record<string, CompositionConfig>>({});
  const registryVersion = ref(0);
  /** Ids currently being fetched (dedupe) or that failed (no retry loops). */
  const inFlight = new Set<string>();
  const failed = new Set<string>();

  function compRefIdsIn(layers: LayerInstance[]): string[] {
    const ids: string[] = [];
    for (const layer of layers) {
      if (layer.type !== "composition") continue;
      const id = layer.values.compRefId;
      if (typeof id === "string" && id) ids.push(id);
    }
    return ids;
  }

  /** Every comp id referenced by the open comp or any comp already loaded. */
  function wantedIds(): string[] {
    const wanted = new Set<string>(compRefIdsIn(options.layers.value));
    for (const config of Object.values(registry.value)) {
      for (const id of compRefIdsIn(config.layers)) wanted.add(id);
    }
    return [...wanted];
  }

  async function fetchComp(compId: string): Promise<void> {
    const projectId = options.projectId.value;
    if (!projectId) return;
    inFlight.add(compId);
    try {
      const doc = await $fetch<CompositionDoc>(
        `/api/projects/${projectId}/compositions/${compId}`,
      );
      if (!doc?.data) throw new Error("empty composition");
      registry.value[compId] = doc.data;
      registryVersion.value++;
    } catch {
      // Silent: the layer renders nothing until the ref resolves.
      failed.add(compId);
    } finally {
      inFlight.delete(compId);
    }
  }

  let syncing = false;
  let syncQueued = false;

  /** Fetch missing refs, then re-scan (nested-of-nested) until stable. */
  async function syncRegistry(): Promise<void> {
    if (import.meta.server) return;
    if (syncing) {
      // A ref changed mid-sync: run one more pass when this one finishes.
      syncQueued = true;
      return;
    }
    syncing = true;
    try {
      // Bounded: each round adds at least one comp or stops.
      for (let round = 0; round < MAX_REGISTRY_SIZE; round++) {
        if (Object.keys(registry.value).length >= MAX_REGISTRY_SIZE) return;
        const missing = wantedIds().filter(
          (id) => !registry.value[id] && !inFlight.has(id) && !failed.has(id),
        );
        if (missing.length === 0) return;
        await Promise.all(
          missing
            .slice(0, MAX_REGISTRY_SIZE - Object.keys(registry.value).length)
            .map((id) => fetchComp(id)),
        );
      }
    } finally {
      syncing = false;
      if (syncQueued) {
        syncQueued = false;
        void syncRegistry();
      }
    }
  }

  // Re-sync whenever the set of referenced comp ids changes (layer added,
  // removed, or its compRefId select changed).
  watch(
    () => compRefIdsIn(options.layers.value).join("|"),
    () => {
      void syncRegistry();
    },
    { immediate: true },
  );
  // projectId can arrive after the layers do (async page load).
  watch(options.projectId, () => {
    void syncRegistry();
  });

  const resolveComposition = (id: string): CompositionConfig | null =>
    registry.value[id] ?? null;

  return { registry, registryVersion, resolveComposition };
}
