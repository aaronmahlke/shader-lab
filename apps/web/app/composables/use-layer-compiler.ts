import { compilePasses, type CompositionConfig, type LFOSource, type LayerInstance, type ModulationAssignment, type ModulationFn } from "@shader-lab/core";

function layerStructureKey(layers: LayerInstance[]): string {
  return layers
    .map((l) => `${l.id}:${l.type}:${l.enabled ? 1 : 0}:${l.is3D ? 1 : 0}:${l.values.drive3d === true ? 1 : 0}:${typeof l.values.compRefId === "string" ? l.values.compRefId : ""}`)
    .join("|");
}

export type LayerCompilerOptions = {
  /** Registry lookup for nested composition layers. */
  resolveComposition?: (compId: string) => CompositionConfig | null;
  /** Bumped when a referenced comp arrives/changes — forces a recompile. */
  registryVersion?: Ref<number>;
  /** Id of the composition being edited (core's direct self-nesting guard). */
  rootCompositionId?: Ref<string | null>;
};

export function useLayerCompiler(
  layers: Ref<LayerInstance[]>,
  getModulatedValue?: Ref<ModulationFn | null>,
  lfos?: Ref<LFOSource[]>,
  assignments?: Ref<ModulationAssignment[]>,
  options?: LayerCompilerOptions,
) {
  const compileGeneration = ref(0);
  /** Layer snapshot for pass graph only — uniform values are read live at render time. */
  const structuralLayers = shallowRef<LayerInstance[]>([]);

  watch(
    () => layerStructureKey(layers.value),
    () => {
      structuralLayers.value = layers.value;
      compileGeneration.value++;
    },
    { immediate: true },
  );
  if (lfos) watch(lfos, () => { compileGeneration.value++; }, { deep: true });
  if (assignments) watch(assignments, () => { compileGeneration.value++; }, { deep: true });
  if (options?.registryVersion) {
    watch(options.registryVersion, () => { compileGeneration.value++; });
  }

  const passes = computed(() => {
    compileGeneration.value;
    return compilePasses(structuralLayers.value, getModulatedValue?.value ?? null, {
      resolveComposition: options?.resolveComposition,
      rootCompositionId: options?.rootCompositionId?.value ?? undefined,
    });
  });

  return { passes };
}
