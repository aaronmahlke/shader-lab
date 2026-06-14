import {
  ModulationEngine,
  evaluateWavePoints,
  type LFOSource,
  type ModulationAssignment,
} from "@shader-lab/core";

export { evaluateWavePoints };

/**
 * Schlick bias used by curve handle helpers:
 * bias(t, b) = t / ((1/b - 2) * (1 - t) + 1)
 */
function curveToB(curve: number): number {
  return 1 / (1 + Math.exp(curve * 3));
}

/** Inverse: map bias parameter b (0, 1) back to curve value. */
function bToCurve(b: number): number {
  b = Math.max(0.001, Math.min(0.999, b));
  return Math.log(1 / b - 1) / 3;
}

function effectiveCurve(p1y: number, p2y: number, curve: number): number {
  return p2y >= p1y ? curve : -curve;
}

export function getOnCurveY(p1y: number, p2y: number, curve: number): number {
  const eff = effectiveCurve(p1y, p2y, curve);
  const b = curveToB(eff);
  return p1y + (p2y - p1y) * b;
}

export function curveFromOnCurveY(p1y: number, p2y: number, onCurveY: number): number {
  const dy = p2y - p1y;
  if (Math.abs(dy) < 0.0001) return 0;

  let b = (onCurveY - p1y) / dy;
  b = Math.max(0.001, Math.min(0.999, b));

  const eff = bToCurve(b);
  return p2y >= p1y ? eff : -eff;
}

export function useModulationEngine(
  lfos: Ref<LFOSource[]>,
  assignments: Ref<ModulationAssignment[]>,
) {
  const engine = new ModulationEngine();
  const lfoValues = ref<Record<string, number>>({});
  const lfoPhases = ref<Record<string, number>>({});

  let animationId: number | null = null;
  let startTime = 0;

  watch(lfos, (v) => engine.setLfos(v), { deep: true, immediate: true });
  watch(assignments, (v) => engine.setAssignments(v), { deep: true, immediate: true });

  function sampleLfosAtTime(clockSeconds: number) {
    engine.sampleAt(clockSeconds);
    lfoValues.value = engine.getLfoValues();
  }

  function tick() {
    sampleLfosAtTime((performance.now() - startTime) / 1000);
    animationId = requestAnimationFrame(tick);
  }

  function getModulatedValue(layerId: string, paramName: string, baseValue: number): number {
    return engine.getModulatedValue(layerId, paramName, baseValue);
  }

  onMounted(() => {
    startTime = performance.now();
    animationId = requestAnimationFrame(tick);
  });

  onUnmounted(() => {
    if (animationId !== null) {
      cancelAnimationFrame(animationId);
    }
  });

  return {
    lfoValues,
    lfoPhases,
    getModulatedValue,
    sampleLfosAtTime,
  };
}
