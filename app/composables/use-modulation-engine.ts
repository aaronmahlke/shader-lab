import type { LFOSource, ModulationAssignment } from "#shared/types/editor";
import { applyModulation } from "#shared/editor/modulation";
import { evaluateLfoWave, getLfoWaveShape } from "#shared/editor/lfo-wave";

export { evaluateWavePoints } from "#shared/editor/lfo-wave";

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

/**
 * Flip curve for falling segments so the visual bow direction is consistent.
 * Positive curve always means "bows away from the straight line in the same visual direction"
 * regardless of whether the segment rises or falls.
 */
function effectiveCurve(p1y: number, p2y: number, curve: number): number {
  return p2y >= p1y ? curve : -curve;
}

/**
 * Get the on-curve y position at t=0.5 for a segment.
 * Since schlickBias(0.5, b) = b, this is simply p1y + dy * b.
 */
export function getOnCurveY(p1y: number, p2y: number, curve: number): number {
  const eff = effectiveCurve(p1y, p2y, curve);
  const b = curveToB(eff);
  // schlickBias(0.5, b) = b
  return p1y + (p2y - p1y) * b;
}

/**
 * Compute curve value from a desired on-curve y at t=0.5.
 * Since schlickBias(0.5, b) = b, we get b = ratio directly.
 */
export function curveFromOnCurveY(p1y: number, p2y: number, onCurveY: number): number {
  const dy = p2y - p1y;
  if (Math.abs(dy) < 0.0001) return 0;

  let b = (onCurveY - p1y) / dy;
  b = Math.max(0.001, Math.min(0.999, b));

  const eff = bToCurve(b);
  // Flip back for falling segments
  return p2y >= p1y ? eff : -eff;
}

export function useModulationEngine(
  lfos: Ref<LFOSource[]>,
  assignments: Ref<ModulationAssignment[]>,
) {
  const lfoValues = ref<Record<string, number>>({});
  const lfoPhases = ref<Record<string, number>>({});

  let animationId: number | null = null;
  let startTime = 0;

  function sampleLfosAtTime(clockSeconds: number) {
    const values: Record<string, number> = {};
    const phases: Record<string, number> = {};

    for (const lfo of lfos.value) {
      const phaseOffset = lfo.phase / 360;

      const rawT = lfo.mode === "pingpong"
        ? (clockSeconds * lfo.rate + phaseOffset) % 2
        : (clockSeconds * lfo.rate + phaseOffset) % 1;

      const t = lfo.mode === "pingpong" && rawT > 1 ? 2 - rawT : rawT;
      const clampedT = Math.max(0, Math.min(1, t));

      phases[lfo.id] = clampedT;
      values[lfo.id] = evaluateLfoWave(getLfoWaveShape(lfo), lfo.points, clampedT);
    }

    lfoValues.value = values;
    lfoPhases.value = phases;
  }

  function tick() {
    sampleLfosAtTime((performance.now() - startTime) / 1000);
    animationId = requestAnimationFrame(tick);
  }

  function getModulatedValue(layerId: string, paramName: string, baseValue: number): number {
    const assignment = assignments.value.find(
      (a) => a.layerId === layerId && a.paramName === paramName,
    );
    if (!assignment) return baseValue;

    const lfoValue = lfoValues.value[assignment.sourceId] ?? 0;
    return applyModulation(baseValue, paramName, lfoValue, assignment.depth);
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
