import { compilePasses, type LFOSource, type LayerInstance, type ModulationAssignment, type ModulationFn } from "@shader-lab/core";

export function useLayerCompiler(
  layers: Ref<LayerInstance[]>,
  getModulatedValue?: Ref<ModulationFn | null>,
  lfos?: Ref<LFOSource[]>,
  assignments?: Ref<ModulationAssignment[]>,
) {
  const compileGeneration = ref(0);

  watch(layers, () => { compileGeneration.value++; }, { deep: true });
  if (lfos) watch(lfos, () => { compileGeneration.value++; }, { deep: true });
  if (assignments) watch(assignments, () => { compileGeneration.value++; }, { deep: true });

  const passes = computed(() => {
    compileGeneration.value;
    return compilePasses(layers.value, getModulatedValue?.value ?? null);
  });

  return { passes };
}
