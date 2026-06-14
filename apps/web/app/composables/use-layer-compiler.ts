import { compilePasses, type LFOSource, type LayerInstance, type ModulationAssignment, type ModulationFn } from "@shader-lab/core";

function layerStructureKey(layers: LayerInstance[]): string {
  return layers.map((l) => `${l.id}:${l.type}:${l.enabled ? 1 : 0}`).join("|");
}

export function useLayerCompiler(
  layers: Ref<LayerInstance[]>,
  getModulatedValue?: Ref<ModulationFn | null>,
  lfos?: Ref<LFOSource[]>,
  assignments?: Ref<ModulationAssignment[]>,
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

  const passes = computed(() => {
    compileGeneration.value;
    return compilePasses(structuralLayers.value, getModulatedValue?.value ?? null);
  });

  return { passes };
}
